"""Complete operational API contract, RBAC, validation, and SQL orchestration tests."""

import json
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config.settings import Settings
from app.dependencies.auth import get_current_user
from app.dependencies.database import get_db_session
from app.main import create_app
from app.schemas.auth import UserResponse, UserRole, UserStatus
from app.schemas.operations import (
    BloodDonationCreateRequest,
    BloodUnitStatusUpdateRequest,
    EmergencyRequestCreateRequest,
    OrganMatchCalculateRequest,
    OrganMatchResponse,
    RecipientUpdateRequest,
)
from app.services import operations_service
from app.tests.conftest import FakeDatabaseManager


def _user(
    role: UserRole,
    *,
    person_id: int | None = None,
    blood_bank_id: int | None = None,
    organ_bank_id: int | None = None,
) -> UserResponse:
    return UserResponse(
        user_id=90,
        username=f"{role.value.lower()}.operations",
        role=role,
        status=UserStatus.ACTIVE,
        person_id=person_id,
        blood_bank_id=blood_bank_id,
        organ_bank_id=organ_bank_id,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


@pytest.fixture
def operations_application(
    settings: Settings,
    fake_database: FakeDatabaseManager,
) -> FastAPI:
    application = create_app(settings=settings, database=fake_database)  # type: ignore[arg-type]

    async def override_session() -> AsyncIterator[object]:
        yield object()

    async def override_user() -> UserResponse:
        return _user(UserRole.ADMIN)

    application.dependency_overrides[get_db_session] = override_session
    application.dependency_overrides[get_current_user] = override_user
    return application


@pytest.fixture
def operations_client(operations_application: FastAPI) -> Iterator[TestClient]:
    with TestClient(operations_application) as client:
        yield client


def _use_role(
    application: FastAPI,
    role: UserRole,
    *,
    person_id: int | None = None,
    blood_bank_id: int | None = None,
    organ_bank_id: int | None = None,
) -> None:
    caller = _user(
        role,
        person_id=person_id,
        blood_bank_id=blood_bank_id,
        organ_bank_id=organ_bank_id,
    )

    async def override_user() -> UserResponse:
        return caller

    application.dependency_overrides[get_current_user] = override_user


REMAINING_OPERATIONS = {
    ("/api/recipients", "get"),
    ("/api/recipients", "post"),
    ("/api/recipients/{recipient_id}", "get"),
    ("/api/recipients/{recipient_id}", "patch"),
    ("/api/recipients/{recipient_id}/requests", "get"),
    ("/api/doctors", "get"),
    ("/api/doctors", "post"),
    ("/api/doctors/{doctor_id}", "get"),
    ("/api/doctors/{doctor_id}", "patch"),
    ("/api/hospitals", "get"),
    ("/api/hospitals", "post"),
    ("/api/hospitals/{hospital_id}", "get"),
    ("/api/blood-banks", "get"),
    ("/api/blood-banks", "post"),
    ("/api/blood-banks/{blood_bank_id}", "get"),
    ("/api/organ-banks", "get"),
    ("/api/organ-banks", "post"),
    ("/api/organ-banks/{organ_bank_id}", "get"),
    ("/api/donations/blood", "post"),
    ("/api/donations/organ", "post"),
    ("/api/donations", "get"),
    ("/api/donations/{donation_id}", "get"),
    ("/api/blood-units", "get"),
    ("/api/blood-units/{blood_unit_id}", "get"),
    ("/api/blood-units/{blood_unit_id}/status", "patch"),
    ("/api/blood-units/{blood_unit_id}/timeline", "get"),
    ("/api/donations/{donation_id}/tests", "post"),
    ("/api/donations/{donation_id}/tests", "get"),
    ("/api/emergency-requests", "get"),
    ("/api/emergency-requests", "post"),
    ("/api/emergency-requests/{request_id}", "get"),
    ("/api/emergency-requests/{request_id}", "patch"),
    ("/api/emergency-requests/{request_id}/reserve", "post"),
    ("/api/reservations", "get"),
    ("/api/reservations/{reservation_id}", "get"),
    ("/api/reservations/{reservation_id}/cancel", "post"),
    ("/api/reservations/{reservation_id}/issue", "post"),
    ("/api/organs", "get"),
    ("/api/organs", "post"),
    ("/api/organs/{organ_unit_id}", "get"),
    ("/api/organs/{organ_unit_id}/calculate-matches", "post"),
    ("/api/organs/{organ_unit_id}/matches", "get"),
    ("/api/organ-matches/{match_id}/status", "patch"),
    ("/api/camps", "get"),
    ("/api/camps", "post"),
    ("/api/camps/{camp_id}", "get"),
    ("/api/camps/{camp_id}/register", "post"),
    ("/api/reports/blood-inventory", "get"),
    ("/api/reports/expiring-units", "get"),
    ("/api/reports/emergency-summary", "get"),
    ("/api/reports/donation-trends", "get"),
    ("/api/reports/reservations", "get"),
    ("/api/reports/organ-matches", "get"),
    ("/api/reports/hospital-response-time", "get"),
    ("/api/audit", "get"),
}


def test_openapi_contains_all_remaining_protected_operations(
    operations_application: FastAPI,
) -> None:
    schema = operations_application.openapi()
    actual = {
        (path, method)
        for path, item in schema["paths"].items()
        for method in item
        if (path, method) in REMAINING_OPERATIONS
    }

    assert actual == REMAINING_OPERATIONS
    assert len(REMAINING_OPERATIONS) == 55
    assert all(
        schema["paths"][path][method]["security"] == [{"LifeLinkBearer": []}]
        for path, method in REMAINING_OPERATIONS
    )
    serialized = json.dumps(schema)
    assert "password_hash" not in serialized
    assert "Academic Priority Score" in serialized
    assert "not clinical transplant guidance" in serialized
    assert schema["info"]["version"] == "1.0.0"


@pytest.mark.parametrize(
    ("role", "method", "path", "payload"),
    [
        (UserRole.DOCTOR, "post", "/api/donations/blood", {}),
        (UserRole.BLOOD_BANK_STAFF, "post", "/api/donations/organ", {}),
        (UserRole.ORGAN_BANK_STAFF, "post", "/api/emergency-requests/1/reserve", {}),
        (UserRole.RECIPIENT, "get", "/api/audit", None),
        (UserRole.DONOR, "get", "/api/recipients", None),
        (UserRole.DOCTOR, "patch", "/api/blood-units/1/status", {}),
        (UserRole.DOCTOR, "get", "/api/reports/blood-inventory", None),
        (UserRole.BLOOD_BANK_STAFF, "post", "/api/organs/1/calculate-matches", {}),
        (UserRole.DONOR, "post", "/api/camps", {}),
    ],
)
def test_role_matrix_blocks_cross_domain_operations_before_database_access(
    operations_client: TestClient,
    operations_application: FastAPI,
    role: UserRole,
    method: str,
    path: str,
    payload: dict[str, Any] | None,
) -> None:
    _use_role(
        operations_application,
        role,
        person_id=30,
        blood_bank_id=1 if role is UserRole.BLOOD_BANK_STAFF else None,
        organ_bank_id=1 if role is UserRole.ORGAN_BANK_STAFF else None,
    )

    response = operations_client.request(method, path, json=payload)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "insufficient_role"


def test_recipient_account_is_limited_to_own_profile(
    operations_client: TestClient,
    operations_application: FastAPI,
) -> None:
    _use_role(operations_application, UserRole.RECIPIENT, person_id=20)

    response = operations_client.get("/api/recipients/21")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "recipient_record_forbidden"


def test_doctor_account_is_limited_to_own_doctor_profile(
    operations_client: TestClient,
    operations_application: FastAPI,
) -> None:
    _use_role(operations_application, UserRole.DOCTOR, person_id=40)

    response = operations_client.get("/api/doctors/41")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "doctor_record_forbidden"


@pytest.mark.parametrize(
    "payload",
    [
        {"status": "RESERVED"},
        {"status": "NOT_A_STATUS"},
    ],
)
def test_direct_blood_reservation_status_is_rejected(payload: dict[str, str]) -> None:
    with pytest.raises(ValueError):
        BloodUnitStatusUpdateRequest.model_validate(payload)


@pytest.mark.parametrize(
    "payload",
    [
        {
            "recipient_id": 1,
            "request_type": "BLOOD",
            "priority": "CRITICAL",
        },
        {
            "recipient_id": 1,
            "request_type": "ORGAN",
            "blood_group": "O+",
            "organ_type": "KIDNEY",
            "priority": "HIGH",
        },
    ],
)
def test_emergency_request_type_specific_fields_are_validated(
    payload: dict[str, Any],
) -> None:
    with pytest.raises(ValueError):
        EmergencyRequestCreateRequest.model_validate(payload)


def test_organ_match_scores_and_duplicate_requests_are_rejected() -> None:
    with pytest.raises(ValueError):
        OrganMatchCalculateRequest.model_validate(
            {"candidates": [{"request_id": 1, "compatibility_score": 101}]}
        )
    with pytest.raises(ValueError):
        OrganMatchCalculateRequest.model_validate(
            {
                "candidates": [
                    {"request_id": 1, "compatibility_score": 80},
                    {"request_id": 1, "compatibility_score": 90},
                ]
            }
        )


def test_recipient_patch_cannot_be_empty() -> None:
    with pytest.raises(ValueError):
        RecipientUpdateRequest.model_validate({})


def test_blood_donation_dates_are_validated() -> None:
    with pytest.raises(ValueError):
        BloodDonationCreateRequest.model_validate(
            {
                "donor_id": 1,
                "collection_bank_id": 1,
                "donation_date": str(date.today()),
                "quantity_collected_ml": 450,
                "expiry_date": str(date.today()),
            }
        )


class _Result:
    def __init__(
        self,
        *,
        row: dict[str, Any] | None = None,
        scalar: Any = None,
    ) -> None:
        self.row = row
        self.scalar = scalar

    def mappings(self) -> "_Result":
        return self

    def one(self) -> dict[str, Any]:
        assert self.row is not None
        return self.row.copy()

    def one_or_none(self) -> dict[str, Any] | None:
        return self.row.copy() if self.row else None

    def scalar_one(self) -> Any:
        return self.scalar


class _RoutineSession:
    def __init__(self) -> None:
        self.executions: list[tuple[str, dict[str, Any]]] = []
        self.commit_calls = 0
        self.rollback_calls = 0

    async def execute(
        self,
        statement: Any,
        parameters: dict[str, Any] | None = None,
    ) -> _Result:
        sql = " ".join(str(statement).split())
        bound = dict(parameters or {})
        self.executions.append((sql, bound))
        if "register_donation" in sql:
            return _Result(
                row={
                    "donation_id": 70,
                    "blood_unit_id": 80,
                    "organ_unit_id": None,
                    "unit_status": "COLLECTED",
                }
            )
        if "reserve_emergency_blood" in sql:
            return _Result(scalar=50)
        if "WHERE br.reservation_id = :reservation_id" in sql:
            return _Result(row=_reservation_row())
        raise AssertionError(f"Unexpected SQL: {sql}")

    async def commit(self) -> None:
        self.commit_calls += 1

    async def rollback(self) -> None:
        self.rollback_calls += 1


def _reservation_row() -> dict[str, Any]:
    now = datetime.now(UTC)
    return {
        "reservation_id": 50,
        "request_id": 9,
        "blood_unit_id": 12,
        "blood_group": "AB-",
        "blood_bank_id": 2,
        "blood_bank_name": "Fictional Blood Bank",
        "hospital_id": 1,
        "hospital_name": "Fictional Hospital",
        "recipient_id": 20,
        "recipient_name": "Fictional Recipient",
        "reserved_at": now,
        "expires_at": now + timedelta(hours=2),
        "status": "ACTIVE",
        "created_by": 90,
        "created_by_username": "blood.operations",
    }


@pytest.mark.asyncio
async def test_blood_registration_calls_postgresql_routine_with_bound_values() -> None:
    session = _RoutineSession()
    actor = _user(UserRole.BLOOD_BANK_STAFF, blood_bank_id=2)
    payload = BloodDonationCreateRequest(
        donor_id=10,
        collection_bank_id=2,
        donation_date=date.today() - timedelta(days=1),
        quantity_collected_ml=450,
        expiry_date=date.today() + timedelta(days=34),
        notes="Fictional academic donation",
    )

    created = await operations_service.register_blood_donation(  # type: ignore[arg-type]
        session,
        actor=actor,
        payload=payload,
    )

    sql, bound = session.executions[0]
    assert "lifelink.register_donation" in sql
    assert bound["user_id"] == actor.user_id
    assert bound["collection_bank_id"] == 2
    assert bound["quantity_collected_ml"] == 450
    assert created.blood_unit_id == 80
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_reservation_calls_atomic_postgresql_function_then_commits() -> None:
    session = _RoutineSession()
    actor = _user(UserRole.BLOOD_BANK_STAFF, blood_bank_id=2)

    reserved = await operations_service.reserve_emergency_blood(  # type: ignore[arg-type]
        session,
        actor=actor,
        request_id=9,
        hold_minutes=120,
    )

    sql, bound = session.executions[0]
    assert "lifelink.reserve_emergency_blood" in sql
    assert bound == {"request_id": 9, "user_id": 90, "hold_minutes": 120}
    assert reserved.reservation_id == 50
    assert reserved.blood_unit_id == 12
    assert reserved.status.value == "ACTIVE"
    assert session.commit_calls == 1


def test_critical_service_contract_keeps_database_authoritative() -> None:
    source = open(operations_service.__file__, encoding="utf-8").read()

    assert "lifelink.register_donation" in source
    assert "lifelink.reserve_emergency_blood" in source
    assert "lifelink.calculate_organ_match" in source
    assert "FOR UPDATE OF br, bu, er" in source
    assert "set_config('lifelink.app_user_id'" in source
    assert "password_hash" not in source
    assert "Academic Priority Score; not clinical transplant guidance" in json.dumps(
        OrganMatchResponse.model_json_schema()
    )


def test_database_sql_contains_concurrency_and_integrity_guarantees() -> None:
    root = Path(operations_service.__file__).resolve().parents[3]
    routines = (root / "database/07_functions_procedures.sql").read_text(encoding="utf-8")
    constraints = (root / "database/02_constraints.sql").read_text(encoding="utf-8")
    triggers = (root / "database/05_trigger_functions.sql").read_text(encoding="utf-8")

    assert "FOR UPDATE OF bu" in routines
    assert "reserve_emergency_blood" in routines
    assert "calculate_organ_match" in routines
    assert "uq_blood_reservation_one_active_unit" in constraints
    assert "validate_blood_unit_status_transition" in triggers
    assert "All screening results must be PASS" in triggers
