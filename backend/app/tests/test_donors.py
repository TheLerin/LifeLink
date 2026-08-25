"""Donors API validation, role matrix, ownership, and SQL-service behavior."""

import json
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.config.settings import Settings
from app.dependencies.auth import get_current_user
from app.dependencies.database import get_db_session
from app.main import create_app
from app.routes import donors as donor_routes
from app.schemas.auth import UserResponse, UserRole, UserStatus
from app.schemas.donors import (
    AddressResponse,
    BloodGroup,
    DonationRecordStatus,
    DonationType,
    DonorConditionListResponse,
    DonorConditionResponse,
    DonorConditionStatus,
    DonorCreateRequest,
    DonorDetailResponse,
    DonorDonationListResponse,
    DonorDonationResponse,
    DonorListResponse,
    DonorPhoneResponse,
    DonorSummaryResponse,
    DonorUpdateRequest,
    Gender,
)
from app.services import donor_service
from app.tests.conftest import FakeDatabaseManager


def _user(
    role: UserRole,
    *,
    user_id: int = 1,
    person_id: int | None = None,
) -> UserResponse:
    return UserResponse(
        user_id=user_id,
        username=f"{role.value.lower()}.test",
        role=role,
        status=UserStatus.ACTIVE,
        person_id=person_id,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def _summary(donor_id: int = 1) -> DonorSummaryResponse:
    return DonorSummaryResponse(
        donor_id=donor_id,
        full_name="Ananya Nair",
        date_of_birth=date(1996, 2, 14),
        age_years=30,
        gender=Gender.FEMALE,
        blood_group=BloodGroup.O_POSITIVE,
        weight_kg=Decimal("58.50"),
        is_active=True,
        city="Mavelikara",
        district="Alappuzha",
        last_blood_donation_date=date.today() - timedelta(days=100),
        active_condition_count=0,
        is_eligible_demo=True,
    )


def _detail(donor_id: int = 1) -> DonorDetailResponse:
    return DonorDetailResponse(
        **_summary(donor_id).model_dump(),
        address=AddressResponse(
            address_id=12,
            line1="Rose Villa",
            line2="Temple Road",
            city="Mavelikara",
            district="Alappuzha",
            state="Kerala",
            pincode="690101",
        ),
        phones=[
            DonorPhoneResponse(
                phone_id=1,
                phone_number="+91 90000 20001",
                is_primary=True,
            )
        ],
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def _donations() -> DonorDonationListResponse:
    return DonorDonationListResponse(
        items=[
            DonorDonationResponse(
                donation_id=2,
                donation_date=date.today() - timedelta(days=30),
                donation_type=DonationType.BLOOD,
                record_status=DonationRecordStatus.ACTIVE,
                collection_bank_id=1,
                collection_bank_name="Central Life Blood Bank",
                quantity_collected_ml=450,
                unit_id=2,
                unit_type="O+",
                unit_status="AVAILABLE",
                expiry_date=date.today() + timedelta(days=10),
            )
        ],
        page=1,
        page_size=20,
        total=1,
        total_pages=1,
    )


def _conditions() -> DonorConditionListResponse:
    return DonorConditionListResponse(
        items=[
            DonorConditionResponse(
                condition_id=1,
                condition_name="Fictional monitored condition",
                diagnosed_date=date.today() - timedelta(days=500),
                condition_status=DonorConditionStatus.MONITORED,
            )
        ],
        total=1,
    )


VALID_CREATE = {
    "full_name": "New Fictional Donor",
    "date_of_birth": "1995-06-10",
    "gender": "FEMALE",
    "address": {
        "line1": "10 Test Road",
        "city": "Kochi",
        "district": "Ernakulam",
        "state": "Kerala",
        "pincode": "682001",
    },
    "weight_kg": "60.50",
    "blood_group": "O+",
    "phones": [
        {"phone_number": "+91 90000 30001", "is_primary": True},
    ],
}


@pytest.fixture
def donor_application(
    settings: Settings,
    fake_database: FakeDatabaseManager,
) -> FastAPI:
    application = create_app(settings=settings, database=fake_database)  # type: ignore[arg-type]

    async def override_db_session() -> AsyncIterator[object]:
        yield object()

    async def override_admin() -> UserResponse:
        return _user(UserRole.ADMIN)

    application.dependency_overrides[get_db_session] = override_db_session
    application.dependency_overrides[get_current_user] = override_admin
    return application


@pytest.fixture
def donor_client(donor_application: FastAPI) -> Iterator[TestClient]:
    with TestClient(donor_application) as client:
        yield client


def _use_role(
    application: FastAPI,
    role: UserRole,
    *,
    person_id: int | None = None,
) -> None:
    user = _user(role, user_id=99, person_id=person_id)

    async def override_user() -> UserResponse:
        return user

    application.dependency_overrides[get_current_user] = override_user


@pytest.fixture(autouse=True)
def stub_donor_services(monkeypatch: pytest.MonkeyPatch) -> None:
    async def list_stub(*_: Any, **__: Any) -> DonorListResponse:
        return DonorListResponse(
            items=[_summary()],
            page=1,
            page_size=20,
            total=1,
            total_pages=1,
        )

    async def detail_stub(*_: Any, **__: Any) -> DonorDetailResponse:
        return _detail()

    async def donation_stub(*_: Any, **__: Any) -> DonorDonationListResponse:
        return _donations()

    async def condition_stub(*_: Any, **__: Any) -> DonorConditionListResponse:
        return _conditions()

    monkeypatch.setattr(donor_routes, "list_donors", list_stub)
    monkeypatch.setattr(donor_routes, "create_donor", detail_stub)
    monkeypatch.setattr(donor_routes, "get_donor", detail_stub)
    monkeypatch.setattr(donor_routes, "update_donor", detail_stub)
    monkeypatch.setattr(donor_routes, "list_donor_donations", donation_stub)
    monkeypatch.setattr(donor_routes, "list_donor_conditions", condition_stub)


@pytest.mark.parametrize(
    "role",
    [UserRole.ADMIN, UserRole.BLOOD_BANK_STAFF, UserRole.ORGAN_BANK_STAFF],
)
def test_donor_list_allows_operational_roles(
    donor_client: TestClient,
    donor_application: FastAPI,
    role: UserRole,
) -> None:
    _use_role(donor_application, role)

    response = donor_client.get("/api/donors")

    assert response.status_code == 200
    assert response.json()["items"][0]["donor_id"] == 1


@pytest.mark.parametrize(
    "role",
    [UserRole.DOCTOR, UserRole.DONOR, UserRole.RECIPIENT],
)
def test_donor_list_denies_unapproved_roles(
    donor_client: TestClient,
    donor_application: FastAPI,
    role: UserRole,
) -> None:
    _use_role(donor_application, role, person_id=1)

    response = donor_client.get("/api/donors")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "insufficient_role"


def test_donor_list_passes_validated_filters_as_bound_service_values(
    donor_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def capture(_: object, **kwargs: Any) -> DonorListResponse:
        captured.update(kwargs)
        return DonorListResponse(items=[], page=2, page_size=10, total=0, total_pages=0)

    monkeypatch.setattr(donor_routes, "list_donors", capture)

    response = donor_client.get(
        "/api/donors",
        params={
            "page": 2,
            "page_size": 10,
            "blood_group": "AB-",
            "is_active": "true",
            "eligible_only": "true",
            "search": "Nair",
        },
    )

    assert response.status_code == 200
    assert captured == {
        "page": 2,
        "page_size": 10,
        "blood_group": "AB-",
        "is_active": True,
        "eligible_only": True,
        "search": "Nair",
    }


@pytest.mark.parametrize(
    "parameters",
    [
        {"page": 0},
        {"page_size": 101},
        {"blood_group": "X+"},
        {"search": "   "},
    ],
)
def test_donor_list_rejects_invalid_filters(
    donor_client: TestClient,
    parameters: dict[str, Any],
) -> None:
    response = donor_client.get("/api/donors", params=parameters)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request_validation_error"


def test_create_and_patch_are_admin_only(
    donor_client: TestClient,
    donor_application: FastAPI,
) -> None:
    _use_role(donor_application, UserRole.BLOOD_BANK_STAFF)

    create = donor_client.post("/api/donors", json=VALID_CREATE)
    patch = donor_client.patch("/api/donors/1", json={"weight_kg": "65.00"})

    assert create.status_code == 403
    assert patch.status_code == 403
    assert create.json()["error"]["code"] == "insufficient_role"
    assert patch.json()["error"]["code"] == "insufficient_role"


def test_admin_can_create_and_patch_donor(donor_client: TestClient) -> None:
    create = donor_client.post("/api/donors", json=VALID_CREATE)
    patch = donor_client.patch(
        "/api/donors/1",
        json={"weight_kg": "65.00", "address": {"city": "Alappuzha"}},
    )

    assert create.status_code == 201
    assert patch.status_code == 200
    assert "password_hash" not in json.dumps(create.json())


@pytest.mark.parametrize(
    "payload",
    [
        {**VALID_CREATE, "date_of_birth": str(date.today() + timedelta(days=1))},
        {**VALID_CREATE, "weight_kg": 0},
        {**VALID_CREATE, "blood_group": "X+"},
        {
            **VALID_CREATE,
            "address": {**VALID_CREATE["address"], "pincode": "!"},
        },
        {
            **VALID_CREATE,
            "phones": [
                {"phone_number": "123", "is_primary": True},
            ],
        },
        {
            **VALID_CREATE,
            "phones": [
                {"phone_number": "+91 90000 30001", "is_primary": False},
            ],
        },
        {
            **VALID_CREATE,
            "phones": [
                {"phone_number": "+91 90000 30001", "is_primary": True},
                {"phone_number": "+91 90000 30001", "is_primary": False},
            ],
        },
    ],
)
def test_create_rejects_invalid_normalized_profile(
    donor_client: TestClient,
    payload: dict[str, Any],
) -> None:
    response = donor_client.post("/api/donors", json=payload)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request_validation_error"


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"full_name": None},
        {"blood_group": None},
        {"phones": None},
        {"address": None},
    ],
)
def test_patch_rejects_empty_or_null_updates(
    donor_client: TestClient,
    payload: dict[str, Any],
) -> None:
    response = donor_client.patch("/api/donors/1", json=payload)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request_validation_error"


def test_donor_can_read_only_own_full_profile(
    donor_client: TestClient,
    donor_application: FastAPI,
) -> None:
    _use_role(donor_application, UserRole.DONOR, person_id=1)

    own = donor_client.get("/api/donors/1")
    other = donor_client.get("/api/donors/2")

    assert own.status_code == 200
    assert own.json()["phones"][0]["is_primary"] is True
    assert other.status_code == 403
    assert other.json()["error"]["code"] == "donor_record_forbidden"


@pytest.mark.parametrize(
    "role",
    [
        UserRole.DOCTOR,
        UserRole.BLOOD_BANK_STAFF,
        UserRole.ORGAN_BANK_STAFF,
        UserRole.RECIPIENT,
    ],
)
def test_full_contact_profile_denies_non_admin_non_owner_roles(
    donor_client: TestClient,
    donor_application: FastAPI,
    role: UserRole,
) -> None:
    _use_role(donor_application, role, person_id=1)

    response = donor_client.get("/api/donors/1")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "insufficient_role"


@pytest.mark.parametrize(
    "role",
    [
        UserRole.ADMIN,
        UserRole.BLOOD_BANK_STAFF,
        UserRole.ORGAN_BANK_STAFF,
    ],
)
def test_donation_history_allows_operational_roles(
    donor_client: TestClient,
    donor_application: FastAPI,
    role: UserRole,
) -> None:
    _use_role(donor_application, role)

    response = donor_client.get("/api/donors/1/donations")

    assert response.status_code == 200
    assert response.json()["items"][0]["donation_type"] == "BLOOD"


def test_donor_donation_and_condition_history_enforce_ownership(
    donor_client: TestClient,
    donor_application: FastAPI,
) -> None:
    _use_role(donor_application, UserRole.DONOR, person_id=1)

    own_donations = donor_client.get("/api/donors/1/donations")
    other_donations = donor_client.get("/api/donors/2/donations")
    own_conditions = donor_client.get("/api/donors/1/conditions")
    other_conditions = donor_client.get("/api/donors/2/conditions")

    assert own_donations.status_code == 200
    assert own_conditions.status_code == 200
    assert other_donations.status_code == 403
    assert other_conditions.status_code == 403


def test_condition_history_allows_blood_staff_but_denies_organ_staff(
    donor_client: TestClient,
    donor_application: FastAPI,
) -> None:
    _use_role(donor_application, UserRole.BLOOD_BANK_STAFF)
    allowed = donor_client.get("/api/donors/1/conditions")

    _use_role(donor_application, UserRole.ORGAN_BANK_STAFF)
    denied = donor_client.get("/api/donors/1/conditions")

    assert allowed.status_code == 200
    assert denied.status_code == 403


@pytest.mark.parametrize(
    "path", ["/api/donors/1/donations", "/api/donors/1/conditions"]
)
def test_doctor_and_recipient_cannot_read_donor_history(
    donor_client: TestClient,
    donor_application: FastAPI,
    path: str,
) -> None:
    for role in (UserRole.DOCTOR, UserRole.RECIPIENT):
        _use_role(donor_application, role, person_id=1)
        response = donor_client.get(path)
        assert response.status_code == 403


def test_donor_history_filters_reach_service_as_enums(
    donor_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def capture(_: object, **kwargs: Any) -> DonorDonationListResponse:
        captured.update(kwargs)
        return _donations()

    monkeypatch.setattr(donor_routes, "list_donor_donations", capture)

    response = donor_client.get(
        "/api/donors/1/donations",
        params={"donation_type": "ORGAN", "record_status": "VOIDED"},
    )

    assert response.status_code == 200
    assert captured["donation_type"] is DonationType.ORGAN
    assert captured["record_status"] is DonationRecordStatus.VOIDED


def test_condition_filter_reaches_service_as_enum(
    donor_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def capture(_: object, **kwargs: Any) -> DonorConditionListResponse:
        captured.update(kwargs)
        return _conditions()

    monkeypatch.setattr(donor_routes, "list_donor_conditions", capture)

    response = donor_client.get(
        "/api/donors/1/conditions",
        params={"condition_status": "ACTIVE"},
    )

    assert response.status_code == 200
    assert captured["condition_status"] is DonorConditionStatus.ACTIVE


def test_donor_routes_require_bearer_authentication(
    donor_client: TestClient,
    donor_application: FastAPI,
) -> None:
    del donor_application.dependency_overrides[get_current_user]

    response = donor_client.get("/api/donors")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "bearer_token_required"


class FakeRows:
    def __init__(
        self,
        *,
        scalar: Any = None,
        row: dict[str, Any] | None = None,
        rows: list[dict[str, Any]] | None = None,
    ) -> None:
        self.scalar = scalar
        self.row = row
        self.rows = rows or []

    def scalar_one(self) -> Any:
        return self.scalar

    def mappings(self) -> "FakeRows":
        return self

    def one_or_none(self) -> dict[str, Any] | None:
        return self.row.copy() if self.row else None

    def all(self) -> list[dict[str, Any]]:
        return [row.copy() for row in self.rows]


class FakeListSession:
    def __init__(self) -> None:
        self.executions: list[tuple[str, dict[str, Any]]] = []

    async def execute(self, statement: Any, parameters: dict[str, Any]) -> FakeRows:
        sql = " ".join(str(statement).split())
        self.executions.append((sql, parameters.copy()))
        if sql.startswith("SELECT COUNT(*)"):
            return FakeRows(scalar=1)
        return FakeRows(rows=[_summary().model_dump()])


@pytest.mark.asyncio
async def test_list_service_uses_bound_filters_and_literal_search() -> None:
    session = FakeListSession()

    response = await donor_service.list_donors(  # type: ignore[arg-type]
        session,
        page=1,
        page_size=20,
        blood_group="O+",
        is_active=True,
        eligible_only=True,
        search="Na%_\\",
    )

    assert response.total == 1
    count_sql, parameters = session.executions[0]
    assert parameters == {
        "blood_group": "O+",
        "is_active": True,
        "search": "%Na\\%\\_\\\\%",
    }
    assert ":search" in count_sql
    assert "Na%_" not in count_sql
    assert "eligible.donor_id IS NOT NULL" in count_sql


def _detail_row(donor_id: int = 1) -> dict[str, Any]:
    detail = _detail(donor_id)
    return {
        **_summary(donor_id).model_dump(),
        "address_id": detail.address.address_id,
        "line1": detail.address.line1,
        "line2": detail.address.line2,
        "state": detail.address.state,
        "pincode": detail.address.pincode,
        "created_at": detail.created_at,
        "updated_at": detail.updated_at,
    }


class FakeDonorWriteSession:
    def __init__(self, *, donor_id: int = 1) -> None:
        self.row = _detail_row(donor_id)
        self.phones = [phone.model_dump() for phone in _detail(donor_id).phones]
        self.executions: list[tuple[str, dict[str, Any]]] = []
        self.commit_calls = 0
        self.created_donor_id = 50

    async def execute(
        self,
        statement: Any,
        parameters: dict[str, Any],
    ) -> FakeRows:
        sql = " ".join(str(statement).split())
        bound = parameters.copy()
        self.executions.append((sql, bound))

        if sql.startswith("SELECT set_config"):
            return FakeRows()
        if sql.startswith("INSERT INTO lifelink.address"):
            self.row.update(bound)
            self.row["address_id"] = 99
            return FakeRows(scalar=99)
        if sql.startswith("INSERT INTO lifelink.person"):
            self.row.update(bound)
            self.row["donor_id"] = self.created_donor_id
            self.row["age_years"] = 31
            self.row["created_at"] = datetime.now(UTC)
            self.row["updated_at"] = datetime.now(UTC)
            return FakeRows(scalar=self.created_donor_id)
        if sql.startswith("INSERT INTO lifelink.donor ("):
            self.row.update(bound)
            self.row.setdefault("last_blood_donation_date", None)
            self.row.setdefault("active_condition_count", 0)
            self.row.setdefault("is_eligible_demo", True)
            self.row.setdefault(
                "eligibility_note",
                "Simplified academic rule; not medical clearance",
            )
            return FakeRows()
        if sql.startswith("INSERT INTO lifelink.donor_phone"):
            phone = {
                "phone_id": len(self.phones) + 1,
                "phone_number": bound["phone_number"],
                "is_primary": bound["is_primary"],
            }
            self.phones.append(phone)
            return FakeRows()
        if sql.startswith("INSERT INTO lifelink.audit_log"):
            return FakeRows()
        if "FOR UPDATE OF d, p, a" in sql:
            return FakeRows(row=self.row)
        if sql.startswith("SELECT d.donor_id") and "WHERE d.donor_id" in sql:
            return FakeRows(row=self.row)
        if sql.startswith("SELECT phone_id, phone_number, is_primary"):
            return FakeRows(rows=self.phones)
        if sql.startswith("UPDATE lifelink.person SET"):
            self.row.update(
                {key: value for key, value in bound.items() if key != "donor_id"}
            )
            return FakeRows()
        if sql.startswith("UPDATE lifelink.donor SET"):
            self.row.update(
                {key: value for key, value in bound.items() if key != "donor_id"}
            )
            return FakeRows()
        if sql.startswith("UPDATE lifelink.address SET"):
            self.row.update(
                {key: value for key, value in bound.items() if key != "address_id"}
            )
            return FakeRows()
        if sql.startswith("DELETE FROM lifelink.donor_phone"):
            self.phones.clear()
            return FakeRows()
        raise AssertionError(f"Unexpected donor write SQL: {sql}")

    async def commit(self) -> None:
        self.commit_calls += 1


@pytest.mark.asyncio
async def test_create_service_writes_normalized_rows_and_safe_audit() -> None:
    session = FakeDonorWriteSession()
    session.phones.clear()
    payload = DonorCreateRequest.model_validate(VALID_CREATE)

    created = await donor_service.create_donor(  # type: ignore[arg-type]
        session,
        actor=_user(UserRole.ADMIN),
        payload=payload,
    )

    assert created.donor_id == 50
    assert created.address.address_id == 99
    assert session.commit_calls == 1
    sql_order = [sql for sql, _ in session.executions[:6]]
    assert sql_order[0].startswith("SELECT set_config")
    assert sql_order[1].startswith("INSERT INTO lifelink.address")
    assert sql_order[2].startswith("INSERT INTO lifelink.person")
    assert sql_order[3].startswith("INSERT INTO lifelink.donor")
    assert sql_order[4].startswith("INSERT INTO lifelink.donor_phone")
    assert sql_order[5].startswith("INSERT INTO lifelink.audit_log")
    audit_parameters = session.executions[5][1]
    assert json.loads(audit_parameters["details"]) == {
        "changed_fields": ["address", "donor", "person", "phones"]
    }
    assert "New Fictional Donor" not in audit_parameters["details"]
    assert "+91 90000 30001" not in audit_parameters["details"]


@pytest.mark.asyncio
async def test_update_service_noop_does_not_commit_or_audit() -> None:
    session = FakeDonorWriteSession()
    payload = DonorUpdateRequest.model_validate({"weight_kg": "58.50"})

    updated = await donor_service.update_donor(  # type: ignore[arg-type]
        session,
        actor=_user(UserRole.ADMIN),
        donor_id=1,
        payload=payload,
    )

    assert updated.weight_kg == Decimal("58.50")
    assert session.commit_calls == 0
    assert not any(
        sql.startswith("INSERT INTO lifelink.audit_log")
        for sql, _ in session.executions
    )


@pytest.mark.asyncio
async def test_update_service_locks_then_updates_normalized_tables() -> None:
    session = FakeDonorWriteSession()
    payload = DonorUpdateRequest.model_validate(
        {
            "full_name": "Ananya Renamed",
            "weight_kg": "61.25",
            "address": {"city": "Kochi"},
            "phones": [{"phone_number": "+91 90000 39999", "is_primary": True}],
        }
    )

    updated = await donor_service.update_donor(  # type: ignore[arg-type]
        session,
        actor=_user(UserRole.ADMIN),
        donor_id=1,
        payload=payload,
    )

    assert updated.full_name == "Ananya Renamed"
    assert updated.weight_kg == Decimal("61.25")
    assert updated.address.city == "Kochi"
    assert updated.phones[0].phone_number == "+91 90000 39999"
    assert session.commit_calls == 1
    sql_order = [sql for sql, _ in session.executions]
    assert "FOR UPDATE OF d, p, a" in sql_order[0]
    assert any(sql.startswith("UPDATE lifelink.person SET") for sql in sql_order)
    assert any(sql.startswith("UPDATE lifelink.donor SET") for sql in sql_order)
    assert any(sql.startswith("UPDATE lifelink.address SET") for sql in sql_order)
    assert any(sql.startswith("DELETE FROM lifelink.donor_phone") for sql in sql_order)
    audit = next(
        parameters
        for sql, parameters in session.executions
        if sql.startswith("INSERT INTO lifelink.audit_log")
    )
    assert json.loads(audit["details"]) == {
        "changed_fields": ["address.city", "full_name", "phones", "weight_kg"]
    }


def test_donor_openapi_exposes_six_protected_operations(
    donor_application: FastAPI,
) -> None:
    schema = donor_application.openapi()
    operations = [
        schema["paths"]["/api/donors"]["get"],
        schema["paths"]["/api/donors"]["post"],
        schema["paths"]["/api/donors/{donor_id}"]["get"],
        schema["paths"]["/api/donors/{donor_id}"]["patch"],
        schema["paths"]["/api/donors/{donor_id}/donations"]["get"],
        schema["paths"]["/api/donors/{donor_id}/conditions"]["get"],
    ]

    assert all(
        operation["security"] == [{"LifeLinkBearer": []}] for operation in operations
    )
    serialized = json.dumps(schema)
    assert "password_hash" not in serialized
    assert "not medical clearance" in serialized


def test_condition_history_casts_nullable_status_for_postgresql() -> None:
    query = str(donor_service.CONDITION_HISTORY_QUERY)

    assert "CAST(:condition_status AS VARCHAR) IS NULL" in query


class _FakeDiagnostic:
    def __init__(self, constraint_name: str | None) -> None:
        self.constraint_name = constraint_name


class _FakePostgresError(Exception):
    def __init__(self, constraint: str | None, sqlstate: str | None) -> None:
        super().__init__("fictional donor constraint error")
        self.diag = _FakeDiagnostic(constraint)
        self.sqlstate = sqlstate


@pytest.mark.parametrize(
    ("constraint", "sqlstate", "expected_code"),
    [
        ("uq_donor_phone_number", "23505", "duplicate_donor_phone"),
        ("uq_donor_phone_one_primary", "23505", "multiple_primary_phones"),
        (None, "23503", "invalid_donor_reference"),
        (None, "23505", "donor_unique_conflict"),
        (None, "23514", "donor_constraint_violation"),
        (None, "99999", "donor_write_failed"),
    ],
)
def test_donor_integrity_failures_map_to_stable_api_codes(
    constraint: str | None,
    sqlstate: str,
    expected_code: str,
) -> None:
    original = _FakePostgresError(constraint, sqlstate)
    exception = IntegrityError("fictional statement", {}, original)

    mapped = donor_service._integrity_error(exception)

    assert mapped.code == expected_code
