"""Database-backed authentication, JWT, and role-guard behavior."""

import json
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config.security import (
    AccessTokenInvalidError,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.config.settings import Settings
from app.dependencies.auth import require_roles
from app.dependencies.database import get_db_session
from app.main import create_app
from app.schemas.auth import UserResponse, UserRole
from app.tests.conftest import FakeDatabaseManager

DEMO_PASSWORD_HASH = "$2b$12$L/U6RlnuP6mcJ7TtM9bYn.I8JG/qVFU6it2PXkCcXJaV50SRY6SdW"


class FakeResult:
    def __init__(self, *, row: dict[str, Any] | None = None, scalar: Any = None):
        self._row = row
        self._scalar = scalar

    def mappings(self) -> "FakeResult":
        return self

    def one_or_none(self) -> dict[str, Any] | None:
        return self._row.copy() if self._row else None

    def scalar_one(self) -> Any:
        return self._scalar


class FakeAuthSession:
    """Execute the module's three statements against an in-memory account map."""

    def __init__(self, users: list[dict[str, Any]]) -> None:
        self.users_by_id = {user["user_id"]: user for user in users}
        self.users_by_username = {user["username"]: user for user in users}
        self.executions: list[tuple[str, dict[str, Any]]] = []
        self.commit_calls = 0

    async def execute(
        self,
        statement: Any,
        parameters: dict[str, Any],
    ) -> FakeResult:
        sql = " ".join(str(statement).split())
        self.executions.append((sql, parameters.copy()))

        if "WHERE ua.username = :username" in sql:
            user = self.users_by_username.get(parameters["username"])
            return FakeResult(row=user)

        if sql.startswith("UPDATE lifelink.user_account"):
            user = self.users_by_id[parameters["user_id"]]
            login_time = datetime.now(UTC)
            user["last_login_at"] = login_time
            return FakeResult(scalar=login_time)

        if "WHERE ua.user_id = :user_id" in sql:
            user = self.users_by_id.get(parameters["user_id"])
            public_user = user.copy() if user else None
            if public_user:
                public_user.pop("password_hash", None)
            return FakeResult(row=public_user)

        raise AssertionError(f"Unexpected SQL in auth test: {sql}")

    async def commit(self) -> None:
        self.commit_calls += 1


def _account(
    *,
    user_id: int,
    username: str,
    role: str,
    password_hash: str,
    status: str = "ACTIVE",
    person_id: int | None = None,
) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "username": username,
        "password_hash": password_hash,
        "role": role,
        "status": status,
        "person_id": person_id,
        "full_name": "Fictional Demo User" if person_id else None,
        "blood_bank_id": None,
        "blood_bank_name": None,
        "organ_bank_id": None,
        "organ_bank_name": None,
        "created_at": datetime(2026, 1, 1, tzinfo=UTC),
        "last_login_at": None,
    }


@pytest.fixture
def auth_session() -> FakeAuthSession:
    test_hash = hash_password("Demo@123", rounds=4)
    return FakeAuthSession(
        [
            _account(
                user_id=1,
                username="admin.demo",
                role="ADMIN",
                password_hash=test_hash,
            ),
            _account(
                user_id=5,
                username="donor.ananya",
                role="DONOR",
                password_hash=test_hash,
                person_id=1,
            ),
        ]
    )


@pytest.fixture
def auth_application(
    settings: Settings,
    fake_database: FakeDatabaseManager,
    auth_session: FakeAuthSession,
) -> FastAPI:
    application = create_app(settings=settings, database=fake_database)  # type: ignore[arg-type]

    async def override_db_session() -> AsyncIterator[FakeAuthSession]:
        yield auth_session

    application.dependency_overrides[get_db_session] = override_db_session

    @application.get("/_test/admin-only")
    async def admin_only(
        current_user: Annotated[
            UserResponse,
            Depends(require_roles(UserRole.ADMIN)),
        ],
    ) -> dict[str, int]:
        return {"user_id": current_user.user_id}

    return application


@pytest.fixture
def auth_client(auth_application: FastAPI) -> Iterator[TestClient]:
    with TestClient(auth_application) as test_client:
        yield test_client


def _login(
    client: TestClient,
    *,
    username: str = "admin.demo",
    password: str = "Demo@123",
):
    return client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )


def test_seeded_demo_password_matches_documented_credential() -> None:
    assert verify_password("Demo@123", DEMO_PASSWORD_HASH)
    assert not verify_password("wrong-password", DEMO_PASSWORD_HASH)


def test_login_returns_jwt_and_safe_database_user(
    auth_client: TestClient,
    auth_session: FakeAuthSession,
) -> None:
    response = _login(auth_client, username="  ADMIN.DEMO  ")

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 7200
    assert body["access_token"].count(".") == 2
    assert body["user"]["username"] == "admin.demo"
    assert body["user"]["role"] == "ADMIN"
    assert body["user"]["last_login_at"] is not None
    assert "password_hash" not in json.dumps(body)
    assert auth_session.commit_calls == 1


@pytest.mark.parametrize(
    ("username", "password"),
    [
        ("admin.demo", "wrong-password"),
        ("missing.user", "Demo@123"),
    ],
)
def test_wrong_password_and_unknown_user_share_one_error(
    auth_client: TestClient,
    username: str,
    password: str,
) -> None:
    response = _login(auth_client, username=username, password=password)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_credentials"
    assert response.json()["error"]["message"] == "Incorrect username or password."
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize(
    ("account_status", "error_code"),
    [("DISABLED", "account_disabled"), ("LOCKED", "account_locked")],
)
def test_non_active_account_cannot_login(
    auth_client: TestClient,
    auth_session: FakeAuthSession,
    account_status: str,
    error_code: str,
) -> None:
    auth_session.users_by_id[1]["status"] = account_status

    response = _login(auth_client)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == error_code
    assert auth_session.commit_calls == 0


def test_me_reloads_current_identity_from_database(
    auth_client: TestClient,
    auth_session: FakeAuthSession,
) -> None:
    token = _login(auth_client).json()["access_token"]

    response = auth_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["user_id"] == 1
    assert response.json()["role"] == "ADMIN"
    assert "password_hash" not in json.dumps(response.json())
    assert any(
        parameters == {"user_id": 1} for _, parameters in auth_session.executions
    )


def test_missing_and_tampered_tokens_are_rejected(auth_client: TestClient) -> None:
    missing = auth_client.get("/api/auth/me")
    valid_token = _login(auth_client).json()["access_token"]
    tampered = auth_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {valid_token}x"},
    )

    assert missing.status_code == 401
    assert missing.json()["error"]["code"] == "bearer_token_required"
    assert tampered.status_code == 401
    assert tampered.json()["error"]["code"] == "invalid_token"


def test_expired_token_is_distinguished(
    auth_client: TestClient,
    settings: Settings,
) -> None:
    token = create_access_token(
        user_id=1,
        role=UserRole.ADMIN,
        settings=settings,
        issued_at=datetime.now(UTC) - timedelta(hours=3),
    )

    response = auth_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "token_expired"


@pytest.mark.parametrize("role", list(UserRole))
def test_access_token_round_trips_every_application_role(
    settings: Settings,
    role: UserRole,
) -> None:
    token = create_access_token(user_id=42, role=role, settings=settings)

    decoded = decode_access_token(token, settings)

    assert decoded.user_id == 42
    assert decoded.role is role


@pytest.mark.parametrize(
    ("setting_name", "unexpected_value"),
    [
        ("jwt_issuer", "unexpected-issuer"),
        ("jwt_audience", "unexpected-audience"),
    ],
)
def test_access_token_rejects_wrong_issuer_or_audience(
    settings: Settings,
    setting_name: str,
    unexpected_value: str,
) -> None:
    token = create_access_token(
        user_id=1,
        role=UserRole.ADMIN,
        settings=settings,
    )
    rejecting_settings = settings.model_copy(
        update={setting_name: unexpected_value},
    )

    with pytest.raises(AccessTokenInvalidError):
        decode_access_token(token, rejecting_settings)


def test_database_role_change_invalidates_old_token(
    auth_client: TestClient,
    auth_session: FakeAuthSession,
) -> None:
    token = _login(auth_client).json()["access_token"]
    auth_session.users_by_id[1]["role"] = "DOCTOR"

    response = auth_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "stale_token_role"


def test_database_status_change_blocks_existing_token(
    auth_client: TestClient,
    auth_session: FakeAuthSession,
) -> None:
    token = _login(auth_client).json()["access_token"]
    auth_session.users_by_id[1]["status"] = "DISABLED"

    response = auth_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "account_disabled"


def test_deleted_database_account_invalidates_existing_token(
    auth_client: TestClient,
    auth_session: FakeAuthSession,
) -> None:
    token = _login(auth_client).json()["access_token"]
    del auth_session.users_by_id[1]

    response = auth_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_token_subject"


def test_role_guard_allows_admin_and_denies_donor(auth_client: TestClient) -> None:
    admin_token = _login(auth_client).json()["access_token"]
    admin_response = auth_client.get(
        "/_test/admin-only",
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    donor_token = _login(auth_client, username="donor.ananya").json()["access_token"]
    donor_response = auth_client.get(
        "/_test/admin-only",
        headers={"Authorization": f"Bearer {donor_token}"},
    )

    assert admin_response.status_code == 200
    assert donor_response.status_code == 403
    assert donor_response.json()["error"]["code"] == "insufficient_role"


def test_login_query_uses_bound_username_parameter(
    auth_client: TestClient,
    auth_session: FakeAuthSession,
) -> None:
    response = _login(auth_client)

    assert response.status_code == 200
    login_sql, parameters = auth_session.executions[0]
    assert ":username" in login_sql
    assert "admin.demo" not in login_sql
    assert parameters == {"username": "admin.demo"}


def test_login_rejects_password_beyond_bcrypt_limit(auth_client: TestClient) -> None:
    response = _login(auth_client, password="x" * 73)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request_validation_error"


def test_production_rejects_placeholder_jwt_secret() -> None:
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        Settings(
            _env_file=None,
            app_environment="production",
            jwt_secret="replace-with-at-least-32-random-characters",
        )


def test_openapi_exposes_bearer_auth_without_protecting_login(
    auth_application: FastAPI,
) -> None:
    schema = auth_application.openapi()

    assert schema["components"]["securitySchemes"]["LifeLinkBearer"] == {
        "type": "http",
        "description": "JWT access token returned by POST /api/auth/login",
        "scheme": "bearer",
    }
    assert "security" not in schema["paths"]["/api/auth/login"]["post"]
    assert schema["paths"]["/api/auth/me"]["get"]["security"] == [
        {"LifeLinkBearer": []}
    ]
    assert "password_hash" not in json.dumps(schema)
