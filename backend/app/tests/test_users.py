"""ADMIN-only user-account API behavior, SQL safety, and lockout guards."""

import json
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.config.security import hash_password, verify_password
from app.config.settings import Settings
from app.dependencies.auth import get_current_user
from app.dependencies.database import get_db_session
from app.main import create_app
from app.schemas.auth import UserResponse
from app.services import users_service
from app.services.auth_service import user_from_row
from app.tests.conftest import FakeDatabaseManager

DEMO_PASSWORD_HASH = "$2b$12$L/U6RlnuP6mcJ7TtM9bYn.I8JG/qVFU6it2PXkCcXJaV50SRY6SdW"


class FakeResult:
    def __init__(
        self,
        *,
        row: dict[str, Any] | None = None,
        rows: list[dict[str, Any]] | None = None,
        scalar: Any = None,
    ) -> None:
        self._row = row
        self._rows = rows or []
        self._scalar = scalar

    def mappings(self) -> "FakeResult":
        return self

    def one_or_none(self) -> dict[str, Any] | None:
        return self._row.copy() if self._row else None

    def all(self) -> list[dict[str, Any]]:
        return [row.copy() for row in self._rows]

    def scalar_one(self) -> Any:
        return self._scalar


class FakeDiagnostic:
    def __init__(self, constraint_name: str | None) -> None:
        self.constraint_name = constraint_name


class FakePostgresError(Exception):
    def __init__(self, *, constraint: str | None, sqlstate: str) -> None:
        super().__init__("fictional PostgreSQL integrity error")
        self.diag = FakeDiagnostic(constraint)
        self.sqlstate = sqlstate


def _account(
    *,
    user_id: int,
    username: str,
    role: str,
    status: str = "ACTIVE",
    person_id: int | None = None,
    blood_bank_id: int | None = None,
    organ_bank_id: int | None = None,
    full_name: str | None = None,
) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "person_id": person_id,
        "blood_bank_id": blood_bank_id,
        "organ_bank_id": organ_bank_id,
        "username": username,
        "password_hash": DEMO_PASSWORD_HASH,
        "role": role,
        "status": status,
        "created_at": datetime(2026, 1, 1, tzinfo=UTC),
        "last_login_at": None,
        "full_name": full_name,
        "blood_bank_name": "Central Life Blood Bank" if blood_bank_id else None,
        "organ_bank_name": "HopeBridge Organ Bank" if organ_bank_id else None,
    }


def _unescape_like(pattern: str) -> str:
    value = pattern[1:-1]
    output: list[str] = []
    index = 0
    while index < len(value):
        if value[index] == "\\" and index + 1 < len(value):
            output.append(value[index + 1])
            index += 2
        else:
            output.append(value[index])
            index += 1
    return "".join(output).lower()


class FakeUsersSession:
    """Execute the Users module's SQL against fictional in-memory accounts."""

    def __init__(self) -> None:
        users = [
            _account(user_id=1, username="admin.demo", role="ADMIN"),
            _account(user_id=2, username="admin.second", role="ADMIN"),
            _account(
                user_id=3,
                username="blood.central",
                role="BLOOD_BANK_STAFF",
                blood_bank_id=1,
            ),
            _account(
                user_id=5,
                username="donor.ananya",
                role="DONOR",
                person_id=10,
                full_name="Ananya Nair",
            ),
            _account(
                user_id=6,
                username="recipient.isha",
                role="RECIPIENT",
                status="DISABLED",
                person_id=20,
                full_name="Isha Menon",
            ),
        ]
        self.users = {user["user_id"]: user for user in users}
        self.executions: list[tuple[str, dict[str, Any]]] = []
        self.audits: list[dict[str, Any]] = []
        self.commit_calls = 0
        self.next_integrity_error: tuple[str | None, str] | None = None

    def fail_next_write(
        self,
        *,
        constraint: str | None,
        sqlstate: str,
    ) -> None:
        self.next_integrity_error = (constraint, sqlstate)

    def _raise_planned_integrity_error(self) -> None:
        if self.next_integrity_error is None:
            return
        constraint, sqlstate = self.next_integrity_error
        self.next_integrity_error = None
        original = FakePostgresError(constraint=constraint, sqlstate=sqlstate)
        raise IntegrityError("fictional statement", {}, original)

    def _public_row(self, user: dict[str, Any]) -> dict[str, Any]:
        return user.copy()

    def _filtered_users(self, parameters: dict[str, Any]) -> list[dict[str, Any]]:
        users = list(self.users.values())
        if "role" in parameters:
            users = [user for user in users if user["role"] == parameters["role"]]
        if "status" in parameters:
            users = [user for user in users if user["status"] == parameters["status"]]
        if "search" in parameters:
            needle = _unescape_like(parameters["search"])
            users = [
                user
                for user in users
                if needle
                in " ".join(
                    str(user.get(field) or "").lower()
                    for field in (
                        "username",
                        "full_name",
                        "blood_bank_name",
                        "organ_bank_name",
                    )
                )
            ]
        return sorted(users, key=lambda user: (user["username"], user["user_id"]))

    async def execute(
        self,
        statement: Any,
        parameters: dict[str, Any] | None = None,
    ) -> FakeResult:
        sql = " ".join(str(statement).split())
        bound = dict(parameters or {})
        self.executions.append((sql, bound.copy()))

        if "pg_advisory_xact_lock" in sql:
            return FakeResult()

        if sql.startswith("SELECT role, status FROM lifelink.user_account"):
            user = self.users.get(bound["actor_user_id"])
            row = {"role": user["role"], "status": user["status"]} if user else None
            return FakeResult(row=row)

        if "WHERE role = 'ADMIN'" in sql and "FOR UPDATE" in sql:
            rows = [
                {"user_id": user["user_id"]}
                for user in sorted(
                    self.users.values(), key=lambda item: item["user_id"]
                )
                if user["role"] == "ADMIN" and user["status"] == "ACTIVE"
            ]
            return FakeResult(rows=rows)

        if "WHERE ua.user_id = :user_id" in sql and "FOR UPDATE OF ua" in sql:
            user = self.users.get(bound["user_id"])
            return FakeResult(row=self._public_row(user) if user else None)

        if sql.startswith("SELECT set_config"):
            return FakeResult()

        if sql.startswith("INSERT INTO lifelink.audit_log"):
            self.audits.append(bound.copy())
            return FakeResult()

        if sql.startswith("INSERT INTO lifelink.user_account"):
            self._raise_planned_integrity_error()
            user_id = max(self.users) + 1
            self.users[user_id] = {
                **bound,
                "user_id": user_id,
                "created_at": datetime.now(UTC),
                "last_login_at": None,
                "full_name": None,
                "blood_bank_name": (
                    "Central Life Blood Bank" if bound["blood_bank_id"] else None
                ),
                "organ_bank_name": (
                    "HopeBridge Organ Bank" if bound["organ_bank_id"] else None
                ),
            }
            return FakeResult(scalar=user_id)

        if sql.startswith("UPDATE lifelink.user_account SET status = :status"):
            self._raise_planned_integrity_error()
            self.users[bound["user_id"]]["status"] = bound["status"]
            return FakeResult(scalar=bound["user_id"])

        if sql.startswith("UPDATE lifelink.user_account SET"):
            self._raise_planned_integrity_error()
            user = self.users[bound["user_id"]]
            for key, value in bound.items():
                if key != "user_id":
                    user[key] = value
            return FakeResult(scalar=bound["user_id"])

        if "WHERE ua.user_id = :user_id" in sql:
            user = self.users.get(bound["user_id"])
            return FakeResult(row=self._public_row(user) if user else None)

        if sql.startswith("SELECT COUNT(*)"):
            return FakeResult(scalar=len(self._filtered_users(bound)))

        if "ORDER BY ua.username, ua.user_id" in sql:
            users = self._filtered_users(bound)
            offset = bound["offset"]
            page = users[offset : offset + bound["limit"]]
            return FakeResult(rows=[self._public_row(user) for user in page])

        raise AssertionError(f"Unexpected Users SQL: {sql}")

    async def commit(self) -> None:
        self.commit_calls += 1


@pytest.fixture
def users_session() -> FakeUsersSession:
    return FakeUsersSession()


@pytest.fixture
def users_application(
    settings: Settings,
    fake_database: FakeDatabaseManager,
    users_session: FakeUsersSession,
) -> FastAPI:
    application = create_app(settings=settings, database=fake_database)  # type: ignore[arg-type]

    async def override_db_session() -> AsyncIterator[FakeUsersSession]:
        yield users_session

    frozen_admin = user_from_row(users_session.users[1])

    async def override_current_admin() -> UserResponse:
        return frozen_admin

    application.dependency_overrides[get_db_session] = override_db_session
    application.dependency_overrides[get_current_user] = override_current_admin
    return application


@pytest.fixture
def users_client(users_application: FastAPI) -> Iterator[TestClient]:
    with TestClient(users_application) as test_client:
        yield test_client


def _use_actor(
    application: FastAPI,
    session: FakeUsersSession,
    user_id: int,
) -> None:
    actor = user_from_row(session.users[user_id])

    async def override_actor() -> UserResponse:
        return actor

    application.dependency_overrides[get_current_user] = override_actor


def test_list_users_is_paginated_and_never_exposes_hashes(
    users_client: TestClient,
) -> None:
    response = users_client.get("/api/users", params={"page": 2, "page_size": 2})

    assert response.status_code == 200
    body = response.json()
    assert body["page"] == 2
    assert body["page_size"] == 2
    assert body["total"] == 5
    assert body["total_pages"] == 3
    assert [item["username"] for item in body["items"]] == [
        "blood.central",
        "donor.ananya",
    ]
    assert "password_hash" not in json.dumps(body)


def test_list_filters_use_bound_values_and_literal_search_escaping(
    users_client: TestClient,
    users_session: FakeUsersSession,
) -> None:
    response = users_client.get(
        "/api/users",
        params={
            "role": "DONOR",
            "status": "ACTIVE",
            "search": "ann%_\\",
        },
    )

    assert response.status_code == 200
    count_sql, count_parameters = next(
        execution
        for execution in users_session.executions
        if execution[0].startswith("SELECT COUNT(*)")
    )
    assert count_parameters == {
        "role": "DONOR",
        "status": "ACTIVE",
        "search": "%ann\\%\\_\\\\%",
    }
    assert count_sql.count("ESCAPE E'\\\\'") == 4
    assert "ann%_" not in count_sql


@pytest.mark.parametrize(
    "parameters",
    [
        {"page": 0},
        {"page_size": 101},
        {"role": "SUPERUSER"},
        {"status": "DELETED"},
        {"search": "   "},
    ],
)
def test_list_rejects_invalid_query_values(
    users_client: TestClient,
    parameters: dict[str, Any],
) -> None:
    response = users_client.get("/api/users", params=parameters)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request_validation_error"


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("GET", "/api/users", None),
        (
            "POST",
            "/api/users",
            {
                "username": "new.donor",
                "password": "Password123",
                "role": "DONOR",
                "person_id": 30,
            },
        ),
        ("PATCH", "/api/users/5", {"username": "renamed.donor"}),
        ("PATCH", "/api/users/5/status", {"status": "LOCKED"}),
    ],
)
def test_every_users_endpoint_denies_non_admin_roles(
    users_client: TestClient,
    users_application: FastAPI,
    users_session: FakeUsersSession,
    method: str,
    path: str,
    payload: dict[str, Any] | None,
) -> None:
    _use_actor(users_application, users_session, 5)

    response = users_client.request(method, path, json=payload)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "insufficient_role"


def test_users_endpoint_requires_a_bearer_identity(
    users_client: TestClient,
    users_application: FastAPI,
) -> None:
    del users_application.dependency_overrides[get_current_user]

    response = users_client.get("/api/users")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "bearer_token_required"


def test_create_user_hashes_password_and_writes_safe_audit(
    users_client: TestClient,
    users_session: FakeUsersSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        users_service,
        "hash_password",
        lambda password: hash_password(password, rounds=4),
    )

    response = users_client.post(
        "/api/users",
        json={
            "username": "  NEW.DONOR  ",
            "password": "Password123",
            "role": "DONOR",
            "person_id": 30,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["username"] == "new.donor"
    assert body["role"] == "DONOR"
    assert "password" not in json.dumps(body)
    created = users_session.users[body["user_id"]]
    assert created["password_hash"] != "Password123"
    assert verify_password("Password123", created["password_hash"])
    assert users_session.commit_calls == 1
    assert len(users_session.audits) == 1
    audit = users_session.audits[0]
    assert audit["actor_user_id"] == 1
    assert audit["action"] == "CREATE"
    assert audit["new_status"] == "ACTIVE"
    assert json.loads(audit["details"]) == {
        "role": "DONOR",
        "username": "new.donor",
    }
    assert "Password123" not in json.dumps(users_session.executions)
    assert "pg_advisory_xact_lock" in users_session.executions[0][0]
    assert "SELECT role, status" in users_session.executions[1][0]


@pytest.mark.parametrize(
    ("constraint", "sqlstate", "expected_status", "expected_code"),
    [
        ("uq_user_account_username", "23505", 409, "username_already_exists"),
        ("uq_user_account_person_role", "23505", 409, "person_role_account_exists"),
        ("ck_user_account_affiliation", "23514", 422, "invalid_user_affiliation"),
        (None, "23503", 422, "invalid_user_reference"),
        (None, "23514", 422, "invalid_user_role_subject"),
    ],
)
def test_create_maps_postgresql_integrity_failures(
    users_client: TestClient,
    users_session: FakeUsersSession,
    monkeypatch: pytest.MonkeyPatch,
    constraint: str | None,
    sqlstate: str,
    expected_status: int,
    expected_code: str,
) -> None:
    monkeypatch.setattr(users_service, "hash_password", lambda _: "bcrypt-hash")
    users_session.fail_next_write(constraint=constraint, sqlstate=sqlstate)

    response = users_client.post(
        "/api/users",
        json={
            "username": "new.donor",
            "password": "Password123",
            "role": "DONOR",
            "person_id": 30,
        },
    )

    assert response.status_code == expected_status
    assert response.json()["error"]["code"] == expected_code
    assert users_session.commit_calls == 0
    assert users_session.audits == []


@pytest.mark.parametrize(
    "payload",
    [
        {"username": "bad space", "password": "Password123", "role": "ADMIN"},
        {"username": "new.admin", "password": "short", "role": "ADMIN"},
        {"username": "new.admin", "password": "x" * 73, "role": "ADMIN"},
        {"username": "new.admin", "password": "Password123", "role": "ROOT"},
        {
            "username": "new.admin",
            "password": "Password123",
            "role": "DONOR",
            "person_id": 0,
        },
    ],
)
def test_create_rejects_invalid_request_contracts(
    users_client: TestClient,
    payload: dict[str, Any],
) -> None:
    response = users_client.post("/api/users", json=payload)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request_validation_error"


def test_patch_updates_bound_fields_and_never_audits_password(
    users_client: TestClient,
    users_session: FakeUsersSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        users_service,
        "hash_password",
        lambda password: hash_password(password, rounds=4),
    )

    response = users_client.patch(
        "/api/users/5",
        json={"username": " DONOR.RENAMED ", "new_password": "NewPassword123"},
    )

    assert response.status_code == 200
    assert response.json()["username"] == "donor.renamed"
    assert verify_password(
        "NewPassword123",
        users_session.users[5]["password_hash"],
    )
    audit = users_session.audits[0]
    assert audit["action"] == "UPDATE"
    assert json.loads(audit["details"]) == {
        "changed_fields": ["password_reset", "username"]
    }
    assert "NewPassword123" not in json.dumps(users_session.executions)
    sql_order = [sql for sql, _ in users_session.executions[:3]]
    assert "pg_advisory_xact_lock" in sql_order[0]
    assert "SELECT role, status" in sql_order[1]
    assert "FOR UPDATE OF ua" in sql_order[2]


def test_patch_can_atomically_change_role_and_affiliation(
    users_client: TestClient,
    users_session: FakeUsersSession,
) -> None:
    response = users_client.patch(
        "/api/users/5",
        json={
            "role": "BLOOD_BANK_STAFF",
            "person_id": None,
            "blood_bank_id": 1,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "BLOOD_BANK_STAFF"
    assert body["person_id"] is None
    assert body["blood_bank_id"] == 1


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"username": None},
        {"role": None},
        {"new_password": None},
        {"new_password": "short"},
    ],
)
def test_patch_rejects_empty_null_or_invalid_updates(
    users_client: TestClient,
    payload: dict[str, Any],
) -> None:
    response = users_client.patch("/api/users/5", json=payload)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request_validation_error"


def test_patch_missing_user_returns_not_found(users_client: TestClient) -> None:
    response = users_client.patch("/api/users/999", json={"username": "missing.user"})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "user_not_found"


def test_patch_no_op_does_not_commit_or_audit(
    users_client: TestClient,
    users_session: FakeUsersSession,
) -> None:
    response = users_client.patch("/api/users/5", json={"username": "donor.ananya"})

    assert response.status_code == 200
    assert users_session.commit_calls == 0
    assert users_session.audits == []


def test_admin_cannot_demote_own_active_session(
    users_client: TestClient,
    users_session: FakeUsersSession,
) -> None:
    response = users_client.patch(
        "/api/users/1",
        json={"role": "DOCTOR", "person_id": 10},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "cannot_demote_self"
    assert users_session.commit_calls == 0


def test_status_change_is_audited_with_old_and_new_values(
    users_client: TestClient,
    users_session: FakeUsersSession,
) -> None:
    response = users_client.patch("/api/users/5/status", json={"status": "LOCKED"})

    assert response.status_code == 200
    assert response.json()["status"] == "LOCKED"
    assert users_session.commit_calls == 1
    audit = users_session.audits[0]
    assert audit["action"] == "STATUS_CHANGE"
    assert audit["old_status"] == "ACTIVE"
    assert audit["new_status"] == "LOCKED"


@pytest.mark.parametrize("new_status", ["DISABLED", "LOCKED"])
def test_admin_cannot_deactivate_own_session(
    users_client: TestClient,
    users_session: FakeUsersSession,
    new_status: str,
) -> None:
    response = users_client.patch(
        "/api/users/1/status",
        json={"status": new_status},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "cannot_deactivate_self"
    assert users_session.commit_calls == 0


def test_second_active_admin_can_be_disabled_safely(
    users_client: TestClient,
    users_session: FakeUsersSession,
) -> None:
    response = users_client.patch(
        "/api/users/2/status",
        json={"status": "DISABLED"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "DISABLED"
    active_lock_sql = next(
        sql for sql, _ in users_session.executions if "WHERE role = 'ADMIN'" in sql
    )
    assert "ORDER BY user_id FOR UPDATE" in active_lock_sql


def test_status_no_op_does_not_commit_or_audit(
    users_client: TestClient,
    users_session: FakeUsersSession,
) -> None:
    response = users_client.patch("/api/users/5/status", json={"status": "ACTIVE"})

    assert response.status_code == 200
    assert users_session.commit_calls == 0
    assert users_session.audits == []


@pytest.mark.parametrize(
    ("field", "value"),
    [("role", "DOCTOR"), ("status", "DISABLED")],
)
def test_mutation_rechecks_admin_authority_after_policy_lock(
    users_client: TestClient,
    users_session: FakeUsersSession,
    field: str,
    value: str,
) -> None:
    users_session.users[1][field] = value

    response = users_client.patch("/api/users/5/status", json={"status": "LOCKED"})

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "admin_authority_changed"
    assert users_session.commit_calls == 0
    assert users_session.audits == []


def test_users_openapi_has_four_bearer_protected_operations(
    users_application: FastAPI,
) -> None:
    schema = users_application.openapi()
    operations = [
        schema["paths"]["/api/users"]["get"],
        schema["paths"]["/api/users"]["post"],
        schema["paths"]["/api/users/{user_id}"]["patch"],
        schema["paths"]["/api/users/{user_id}/status"]["patch"],
    ]

    assert all(
        operation["security"] == [{"LifeLinkBearer": []}] for operation in operations
    )
    assert "password_hash" not in json.dumps(schema)
    assert "UserCreateRequest" in schema["components"]["schemas"]
    assert "UserUpdateRequest" in schema["components"]["schemas"]
