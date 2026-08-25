# ruff: noqa: E501
"""Parameterized PostgreSQL services for LifeLink's operational API modules."""

import json
from collections.abc import Mapping
from datetime import date
from typing import Any, TypeVar

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.auth import UserResponse, UserRole
from app.schemas.donors import AddressCreate
from app.schemas.operations import (
    AuditLogResponse,
    BloodBankResponse,
    BloodDonationCreateRequest,
    BloodInventoryReportRow,
    BloodUnitResponse,
    BloodUnitStatus,
    BloodUnitTimelineResponse,
    CampCreateRequest,
    CampRegistrationResponse,
    CampResponse,
    DoctorCreateRequest,
    DoctorDetailResponse,
    DoctorSummaryResponse,
    DoctorUpdateRequest,
    DonationRegistrationResponse,
    DonationResponse,
    DonationTrendRow,
    EmergencyRequestCreateRequest,
    EmergencyRequestResponse,
    EmergencyRequestUpdateRequest,
    EmergencySummaryRow,
    FacilityCreateRequest,
    HospitalResponse,
    HospitalResponseTimeRow,
    MedicalTestCreateRequest,
    MedicalTestResponse,
    OrganBankResponse,
    OrganDonationCreateRequest,
    OrganMatchCalculateRequest,
    OrganMatchResponse,
    OrganMatchStatus,
    OrganUnitResponse,
    PageResponse,
    RecipientCreateRequest,
    RecipientDetailResponse,
    RecipientSummaryResponse,
    RecipientUpdateRequest,
    ReservationResponse,
    ReservationSummaryRow,
    TimelineEventResponse,
)
from app.utils.errors import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    UnprocessableError,
)

ModelT = TypeVar("ModelT")

INSERT_ADDRESS = text(
    """
    INSERT INTO lifelink.address (line1, line2, city, district, state, pincode)
    VALUES (:line1, :line2, :city, :district, :state, :pincode)
    RETURNING address_id
    """
)

SET_ACTOR = text("SELECT set_config('lifelink.app_user_id', :actor_user_id, TRUE)")

INSERT_AUDIT = text(
    """
    INSERT INTO lifelink.audit_log (
        user_id, table_name, record_id, action, old_status, new_status, details
    ) VALUES (
        :user_id, :table_name, :record_id, :action,
        :old_status, :new_status, :details
    )
    """
)


def _model(model: type[ModelT], row: Mapping[str, Any]) -> ModelT:
    return model.model_validate(dict(row))  # type: ignore[attr-defined,no-any-return]


def _sqlstate(exc: DBAPIError) -> str | None:
    return getattr(exc.orig, "sqlstate", None) or getattr(
        getattr(exc.orig, "diag", None), "sqlstate", None
    )


def _database_error(exc: DBAPIError, domain: str) -> Exception:
    diagnostic = getattr(exc.orig, "diag", None)
    constraint = getattr(diagnostic, "constraint_name", None)
    sqlstate = _sqlstate(exc)
    message = str(exc.orig).lower()

    if sqlstate == "42501":
        return ForbiddenError(
            code=f"{domain}_operation_forbidden",
            message="The database rejected this operation for the current account.",
        )
    if sqlstate == "P0002" or "no reservable" in message:
        return ConflictError(
            code="no_blood_unit_available",
            message="No qualifying blood unit is currently available.",
        )
    if sqlstate == "40001":
        return ConflictError(
            code="concurrent_change_retry",
            message="The record changed concurrently; retry the operation.",
        )
    if sqlstate == "23505":
        suffix = f" ({constraint})" if constraint else ""
        return ConflictError(
            code=f"{domain}_unique_conflict",
            message=f"The change conflicts with an existing record{suffix}.",
        )
    if sqlstate == "23503":
        return UnprocessableError(
            code=f"invalid_{domain}_reference",
            message="A referenced LifeLink record does not exist.",
        )
    if sqlstate in {"22023", "23514", "P0001"}:
        return UnprocessableError(
            code=f"{domain}_rule_violation",
            message=str(exc.orig).split("\n", maxsplit=1)[0],
        )
    return UnprocessableError(
        code=f"{domain}_write_failed",
        message="The requested database change could not be accepted.",
    )


async def _rollback_and_raise(
    session: AsyncSession,
    exc: DBAPIError,
    domain: str,
) -> None:
    await session.rollback()
    raise _database_error(exc, domain) from exc


async def _create_address(session: AsyncSession, address: AddressCreate) -> int:
    result = await session.execute(INSERT_ADDRESS, address.model_dump())
    return int(result.scalar_one())


async def _set_actor(session: AsyncSession, user_id: int) -> None:
    await session.execute(SET_ACTOR, {"actor_user_id": str(user_id)})


async def _audit(
    session: AsyncSession,
    *,
    actor: UserResponse,
    table_name: str,
    record_id: int,
    action: str,
    old_status: str | None = None,
    new_status: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    await session.execute(
        INSERT_AUDIT,
        {
            "user_id": actor.user_id,
            "table_name": table_name,
            "record_id": str(record_id),
            "action": action,
            "old_status": old_status,
            "new_status": new_status,
            "details": (
                json.dumps(details, separators=(",", ":"), sort_keys=True)
                if details is not None
                else None
            ),
        },
    )


async def _paged(
    session: AsyncSession,
    *,
    count_sql: str,
    rows_sql: str,
    parameters: dict[str, Any],
    page: int,
    page_size: int,
    model: type[ModelT],
) -> PageResponse[ModelT]:
    total = int((await session.execute(text(count_sql), parameters)).scalar_one())
    result = await session.execute(
        text(rows_sql),
        {
            **parameters,
            "limit": page_size,
            "offset": (page - 1) * page_size,
        },
    )
    return PageResponse[model](  # type: ignore[valid-type]
        items=[_model(model, row) for row in result.mappings().all()],
        page=page,
        page_size=page_size,
        total=total,
    )


PERSON_ADDRESS_COLUMNS = """
    p.full_name, p.date_of_birth,
    EXTRACT(YEAR FROM AGE(CURRENT_DATE, p.date_of_birth))::INTEGER AS age_years,
    p.gender, p.created_at, p.updated_at,
    a.address_id, a.line1, a.line2, a.city, a.district, a.state, a.pincode
"""


def _nested_address(values: dict[str, Any]) -> dict[str, Any]:
    values["address"] = {
        key: values[key]
        for key in (
            "address_id",
            "line1",
            "line2",
            "city",
            "district",
            "state",
            "pincode",
        )
    }
    return values


# ---------------------------------------------------------------------------
# Recipients and doctors
# ---------------------------------------------------------------------------


async def list_recipients(
    session: AsyncSession,
    *,
    page: int,
    page_size: int,
    blood_group: str | None,
    status: str | None,
    search: str | None,
) -> PageResponse[RecipientSummaryResponse]:
    filters: list[str] = []
    params: dict[str, Any] = {}
    if blood_group:
        filters.append("r.blood_group = :blood_group")
        params["blood_group"] = blood_group
    if status:
        filters.append("r.status = :status")
        params["status"] = status
    if search:
        filters.append("p.full_name ILIKE :search ESCAPE E'\\\\'")
        escaped = (
            search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        )
        params["search"] = f"%{escaped}%"
    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    source = """
        FROM lifelink.recipient AS r
        JOIN lifelink.person AS p ON p.person_id = r.recipient_id
        JOIN lifelink.address AS a ON a.address_id = p.address_id
    """
    return await _paged(
        session,
        count_sql=f"SELECT COUNT(*) {source} {where}",
        rows_sql=f"""
            SELECT r.recipient_id, p.full_name, p.date_of_birth,
                EXTRACT(YEAR FROM AGE(CURRENT_DATE, p.date_of_birth))::INTEGER AS age_years,
                p.gender, r.blood_group, r.status, a.city, a.district
            {source} {where}
            ORDER BY p.full_name, r.recipient_id LIMIT :limit OFFSET :offset
        """,
        parameters=params,
        page=page,
        page_size=page_size,
        model=RecipientSummaryResponse,
    )


async def get_recipient(
    session: AsyncSession,
    recipient_id: int,
    *,
    for_update: bool = False,
) -> RecipientDetailResponse:
    lock = "FOR UPDATE OF r, p, a" if for_update else ""
    result = await session.execute(
        text(
            f"""
            SELECT r.recipient_id, r.blood_group, r.status, {PERSON_ADDRESS_COLUMNS}
            FROM lifelink.recipient AS r
            JOIN lifelink.person AS p ON p.person_id = r.recipient_id
            JOIN lifelink.address AS a ON a.address_id = p.address_id
            WHERE r.recipient_id = :recipient_id {lock}
            """
        ),
        {"recipient_id": recipient_id},
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise NotFoundError(code="recipient_not_found", message="Recipient not found.")
    return RecipientDetailResponse.model_validate(_nested_address(dict(row)))


async def create_recipient(
    session: AsyncSession,
    *,
    actor: UserResponse,
    payload: RecipientCreateRequest,
) -> RecipientDetailResponse:
    try:
        address_id = await _create_address(session, payload.address)
        person_result = await session.execute(
            text(
                """
                INSERT INTO lifelink.person (full_name, date_of_birth, gender, address_id)
                VALUES (:full_name, :date_of_birth, :gender, :address_id)
                RETURNING person_id
                """
            ),
            {
                "full_name": payload.full_name,
                "date_of_birth": payload.date_of_birth,
                "gender": payload.gender.value,
                "address_id": address_id,
            },
        )
        recipient_id = int(person_result.scalar_one())
        await session.execute(
            text(
                """
                INSERT INTO lifelink.recipient (recipient_id, blood_group, status)
                VALUES (:recipient_id, :blood_group, :status)
                """
            ),
            {
                "recipient_id": recipient_id,
                "blood_group": payload.blood_group.value,
                "status": payload.status.value,
            },
        )
        await _audit(
            session,
            actor=actor,
            table_name="recipient",
            record_id=recipient_id,
            action="RECIPIENT_CREATED",
            new_status=payload.status.value,
            details={"changed_fields": ["address", "blood_group", "person", "status"]},
        )
        await session.commit()
    except DBAPIError as exc:
        await _rollback_and_raise(session, exc, "recipient")
    return await get_recipient(session, recipient_id)


async def update_recipient(
    session: AsyncSession,
    *,
    actor: UserResponse,
    recipient_id: int,
    payload: RecipientUpdateRequest,
) -> RecipientDetailResponse:
    current = await get_recipient(session, recipient_id, for_update=True)
    changed: list[str] = []
    try:
        person_fields = {"full_name", "date_of_birth", "gender"}
        person_values = {
            name: getattr(payload, name).value
            if hasattr(getattr(payload, name), "value")
            else getattr(payload, name)
            for name in payload.model_fields_set & person_fields
            if getattr(current, name) != getattr(payload, name)
        }
        if person_values:
            assignments = ", ".join(f"{name} = :{name}" for name in person_values)
            await session.execute(
                text(
                    f"UPDATE lifelink.person SET {assignments} WHERE person_id = :recipient_id"
                ),
                {**person_values, "recipient_id": recipient_id},
            )
            changed.extend(person_values)

        recipient_values: dict[str, Any] = {}
        for name in payload.model_fields_set & {"blood_group", "status"}:
            incoming = getattr(payload, name)
            if getattr(current, name) != incoming:
                recipient_values[name] = incoming.value
        if recipient_values:
            assignments = ", ".join(f"{name} = :{name}" for name in recipient_values)
            await session.execute(
                text(
                    f"UPDATE lifelink.recipient SET {assignments} WHERE recipient_id = :recipient_id"
                ),
                {**recipient_values, "recipient_id": recipient_id},
            )
            changed.extend(recipient_values)

        if payload.address is not None:
            address_values = payload.address.model_dump(exclude_unset=True)
            effective = {
                name: value
                for name, value in address_values.items()
                if getattr(current.address, name) != value
            }
            if effective:
                assignments = ", ".join(f"{name} = :{name}" for name in effective)
                await session.execute(
                    text(
                        f"UPDATE lifelink.address SET {assignments} WHERE address_id = :address_id"
                    ),
                    {**effective, "address_id": current.address.address_id},
                )
                changed.extend(f"address.{name}" for name in effective)

        if changed:
            await _audit(
                session,
                actor=actor,
                table_name="recipient",
                record_id=recipient_id,
                action="RECIPIENT_UPDATED",
                old_status=current.status.value,
                new_status=(payload.status or current.status).value,
                details={"changed_fields": sorted(changed)},
            )
            await session.commit()
    except DBAPIError as exc:
        await _rollback_and_raise(session, exc, "recipient")
    return await get_recipient(session, recipient_id)


async def list_doctors(
    session: AsyncSession,
    *,
    page: int,
    page_size: int,
    hospital_id: int | None,
    search: str | None,
) -> PageResponse[DoctorSummaryResponse]:
    filters: list[str] = []
    params: dict[str, Any] = {}
    if hospital_id:
        filters.append("d.hospital_id = :hospital_id")
        params["hospital_id"] = hospital_id
    if search:
        filters.append("p.full_name ILIKE :search ESCAPE E'\\\\'")
        escaped = (
            search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        )
        params["search"] = f"%{escaped}%"
    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    source = """
        FROM lifelink.doctor AS d
        JOIN lifelink.person AS p ON p.person_id = d.doctor_id
        JOIN lifelink.hospital AS h ON h.hospital_id = d.hospital_id
    """
    return await _paged(
        session,
        count_sql=f"SELECT COUNT(*) {source} {where}",
        rows_sql=f"""
            SELECT d.doctor_id, p.full_name, d.specialization, d.license_no,
                d.hospital_id, h.name AS hospital_name
            {source} {where}
            ORDER BY p.full_name, d.doctor_id LIMIT :limit OFFSET :offset
        """,
        parameters=params,
        page=page,
        page_size=page_size,
        model=DoctorSummaryResponse,
    )


async def get_doctor(
    session: AsyncSession,
    doctor_id: int,
    *,
    for_update: bool = False,
) -> DoctorDetailResponse:
    lock = "FOR UPDATE OF d, p, a" if for_update else ""
    result = await session.execute(
        text(
            f"""
            SELECT d.doctor_id, d.hospital_id, h.name AS hospital_name,
                d.specialization, d.license_no, {PERSON_ADDRESS_COLUMNS}
            FROM lifelink.doctor AS d
            JOIN lifelink.person AS p ON p.person_id = d.doctor_id
            JOIN lifelink.address AS a ON a.address_id = p.address_id
            JOIN lifelink.hospital AS h ON h.hospital_id = d.hospital_id
            WHERE d.doctor_id = :doctor_id {lock}
            """
        ),
        {"doctor_id": doctor_id},
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise NotFoundError(code="doctor_not_found", message="Doctor not found.")
    return DoctorDetailResponse.model_validate(_nested_address(dict(row)))


async def create_doctor(
    session: AsyncSession,
    *,
    actor: UserResponse,
    payload: DoctorCreateRequest,
) -> DoctorDetailResponse:
    try:
        address_id = await _create_address(session, payload.address)
        person = await session.execute(
            text(
                """
                INSERT INTO lifelink.person (full_name, date_of_birth, gender, address_id)
                VALUES (:full_name, :date_of_birth, :gender, :address_id)
                RETURNING person_id
                """
            ),
            {
                "full_name": payload.full_name,
                "date_of_birth": payload.date_of_birth,
                "gender": payload.gender.value,
                "address_id": address_id,
            },
        )
        doctor_id = int(person.scalar_one())
        await session.execute(
            text(
                """
                INSERT INTO lifelink.doctor (
                    doctor_id, hospital_id, specialization, license_no
                ) VALUES (
                    :doctor_id, :hospital_id, :specialization, :license_no
                )
                """
            ),
            {
                "doctor_id": doctor_id,
                **payload.model_dump(
                    exclude={"address", "full_name", "date_of_birth", "gender"}
                ),
            },
        )
        await _audit(
            session,
            actor=actor,
            table_name="doctor",
            record_id=doctor_id,
            action="DOCTOR_CREATED",
            details={
                "changed_fields": [
                    "address",
                    "hospital_id",
                    "license_no",
                    "person",
                    "specialization",
                ]
            },
        )
        await session.commit()
    except DBAPIError as exc:
        await _rollback_and_raise(session, exc, "doctor")
    return await get_doctor(session, doctor_id)


async def update_doctor(
    session: AsyncSession,
    *,
    actor: UserResponse,
    doctor_id: int,
    payload: DoctorUpdateRequest,
) -> DoctorDetailResponse:
    current = await get_doctor(session, doctor_id, for_update=True)
    changed: list[str] = []
    try:
        person_values: dict[str, Any] = {}
        for name in payload.model_fields_set & {"full_name", "date_of_birth", "gender"}:
            incoming = getattr(payload, name)
            if getattr(current, name) != incoming:
                person_values[name] = (
                    incoming.value if hasattr(incoming, "value") else incoming
                )
        if person_values:
            assignments = ", ".join(f"{name} = :{name}" for name in person_values)
            await session.execute(
                text(
                    f"UPDATE lifelink.person SET {assignments} WHERE person_id = :doctor_id"
                ),
                {**person_values, "doctor_id": doctor_id},
            )
            changed.extend(person_values)
        doctor_values = {
            name: getattr(payload, name)
            for name in payload.model_fields_set
            & {"hospital_id", "specialization", "license_no"}
            if getattr(current, name) != getattr(payload, name)
        }
        if doctor_values:
            assignments = ", ".join(f"{name} = :{name}" for name in doctor_values)
            await session.execute(
                text(
                    f"UPDATE lifelink.doctor SET {assignments} WHERE doctor_id = :doctor_id"
                ),
                {**doctor_values, "doctor_id": doctor_id},
            )
            changed.extend(doctor_values)
        if payload.address is not None:
            effective = {
                name: value
                for name, value in payload.address.model_dump(
                    exclude_unset=True
                ).items()
                if getattr(current.address, name) != value
            }
            if effective:
                assignments = ", ".join(f"{name} = :{name}" for name in effective)
                await session.execute(
                    text(
                        f"UPDATE lifelink.address SET {assignments} WHERE address_id = :address_id"
                    ),
                    {**effective, "address_id": current.address.address_id},
                )
                changed.extend(f"address.{name}" for name in effective)
        if changed:
            await _audit(
                session,
                actor=actor,
                table_name="doctor",
                record_id=doctor_id,
                action="DOCTOR_UPDATED",
                details={"changed_fields": sorted(changed)},
            )
            await session.commit()
    except DBAPIError as exc:
        await _rollback_and_raise(session, exc, "doctor")
    return await get_doctor(session, doctor_id)


# ---------------------------------------------------------------------------
# Hospitals and banks
# ---------------------------------------------------------------------------

FACILITIES: dict[str, tuple[str, type[Any]]] = {
    "hospital": ("hospital_id", HospitalResponse),
    "blood_bank": ("blood_bank_id", BloodBankResponse),
    "organ_bank": ("organ_bank_id", OrganBankResponse),
}


async def list_facilities(
    session: AsyncSession,
    *,
    kind: str,
    status: str | None,
) -> list[Any]:
    id_column, response_model = FACILITIES[kind]
    where = "WHERE f.status = :status" if status else ""
    result = await session.execute(
        text(
            f"""
            SELECT f.{id_column}, f.name, f.contact_phone, f.email, f.status,
                f.created_at, a.address_id, a.line1, a.line2, a.city,
                a.district, a.state, a.pincode
            FROM lifelink.{kind} AS f
            JOIN lifelink.address AS a ON a.address_id = f.address_id
            {where}
            ORDER BY f.name, f.{id_column}
            """
        ),
        {"status": status} if status else {},
    )
    return [
        response_model.model_validate(_nested_address(dict(row)))
        for row in result.mappings().all()
    ]


async def get_facility(
    session: AsyncSession,
    *,
    kind: str,
    facility_id: int,
) -> Any:
    id_column, response_model = FACILITIES[kind]
    result = await session.execute(
        text(
            f"""
            SELECT f.{id_column}, f.name, f.contact_phone, f.email, f.status,
                f.created_at, a.address_id, a.line1, a.line2, a.city,
                a.district, a.state, a.pincode
            FROM lifelink.{kind} AS f
            JOIN lifelink.address AS a ON a.address_id = f.address_id
            WHERE f.{id_column} = :facility_id
            """
        ),
        {"facility_id": facility_id},
    )
    row = result.mappings().one_or_none()
    if row is None:
        label = kind.replace("_", " ")
        raise NotFoundError(
            code=f"{kind}_not_found", message=f"{label.title()} not found."
        )
    return response_model.model_validate(_nested_address(dict(row)))


async def create_facility(
    session: AsyncSession,
    *,
    actor: UserResponse,
    kind: str,
    payload: FacilityCreateRequest,
) -> Any:
    id_column, _ = FACILITIES[kind]
    try:
        address_id = await _create_address(session, payload.address)
        result = await session.execute(
            text(
                f"""
                INSERT INTO lifelink.{kind} (
                    name, address_id, contact_phone, email, status
                ) VALUES (
                    :name, :address_id, :contact_phone, :email, :status
                ) RETURNING {id_column}
                """
            ),
            {
                "name": payload.name,
                "address_id": address_id,
                "contact_phone": payload.contact_phone,
                "email": payload.email,
                "status": payload.status.value,
            },
        )
        facility_id = int(result.scalar_one())
        await _audit(
            session,
            actor=actor,
            table_name=kind,
            record_id=facility_id,
            action=f"{kind.upper()}_CREATED",
            new_status=payload.status.value,
            details={
                "changed_fields": [
                    "address",
                    "contact_phone",
                    "email",
                    "name",
                    "status",
                ]
            },
        )
        await session.commit()
    except DBAPIError as exc:
        await _rollback_and_raise(session, exc, kind)
    return await get_facility(session, kind=kind, facility_id=facility_id)


# ---------------------------------------------------------------------------
# Donations, units, and screening
# ---------------------------------------------------------------------------

DONATION_COLUMNS = """
    dn.donation_id, dn.donor_id, p.full_name AS donor_name,
    dn.donation_date, dn.donation_type, dn.record_status,
    dn.camp_id, camp.organizer AS camp_organizer,
    COALESCE(bd.collection_bank_id, od.collection_organ_bank_id) AS collection_bank_id,
    COALESCE(bb.name, ob.name) AS collection_bank_name,
    bd.quantity_collected_ml,
    COALESCE(bu.blood_unit_id, ou.organ_unit_id) AS unit_id,
    CASE WHEN dn.donation_type = 'BLOOD' THEN bu.blood_group ELSE ou.organ_type END AS unit_type,
    COALESCE(bu.status, ou.status) AS unit_status,
    bu.expiry_date, COALESCE(bd.notes, od.notes) AS notes, dn.created_at
"""

DONATION_FROM = """
    FROM lifelink.donation AS dn
    JOIN lifelink.person AS p ON p.person_id = dn.donor_id
    LEFT JOIN lifelink.donation_camp AS camp ON camp.camp_id = dn.camp_id
    LEFT JOIN lifelink.blood_donation AS bd ON bd.donation_id = dn.donation_id
    LEFT JOIN lifelink.blood_bank AS bb ON bb.blood_bank_id = bd.collection_bank_id
    LEFT JOIN lifelink.blood_unit AS bu ON bu.donation_id = dn.donation_id
    LEFT JOIN lifelink.organ_donation AS od ON od.donation_id = dn.donation_id
    LEFT JOIN lifelink.organ_bank AS ob ON ob.organ_bank_id = od.collection_organ_bank_id
    LEFT JOIN lifelink.organ_unit AS ou ON ou.donation_id = dn.donation_id
"""


async def register_blood_donation(
    session: AsyncSession,
    *,
    actor: UserResponse,
    payload: BloodDonationCreateRequest,
) -> DonationRegistrationResponse:
    try:
        result = await session.execute(
            text(
                """
                SELECT * FROM lifelink.register_donation(
                    :donor_id, 'BLOOD', :collection_bank_id, :user_id,
                    :donation_date, :camp_id, :quantity_collected_ml,
                    :expiry_date, CAST(NULL AS VARCHAR), :notes
                )
                """
            ),
            {**payload.model_dump(), "user_id": actor.user_id},
        )
        created = DonationRegistrationResponse.model_validate(result.mappings().one())
        await session.commit()
        return created
    except DBAPIError as exc:
        await _rollback_and_raise(session, exc, "donation")


async def register_organ_donation(
    session: AsyncSession,
    *,
    actor: UserResponse,
    payload: OrganDonationCreateRequest,
) -> DonationRegistrationResponse:
    try:
        result = await session.execute(
            text(
                """
                SELECT * FROM lifelink.register_donation(
                    :donor_id, 'ORGAN', :collection_organ_bank_id, :user_id,
                    :donation_date, :camp_id, CAST(NULL AS INTEGER),
                    CAST(NULL AS DATE), :organ_type, :notes
                )
                """
            ),
            {**payload.model_dump(), "user_id": actor.user_id},
        )
        created = DonationRegistrationResponse.model_validate(result.mappings().one())
        await session.commit()
        return created
    except DBAPIError as exc:
        await _rollback_and_raise(session, exc, "donation")


def _donation_scope(
    caller: UserResponse, filters: list[str], params: dict[str, Any]
) -> None:
    if caller.role is UserRole.BLOOD_BANK_STAFF:
        filters.extend(
            ["dn.donation_type = 'BLOOD'", "bd.collection_bank_id = :scope_bank_id"]
        )
        params["scope_bank_id"] = caller.blood_bank_id
    elif caller.role is UserRole.ORGAN_BANK_STAFF:
        filters.extend(
            [
                "dn.donation_type = 'ORGAN'",
                "od.collection_organ_bank_id = :scope_bank_id",
            ]
        )
        params["scope_bank_id"] = caller.organ_bank_id
    elif caller.role is UserRole.DONOR:
        filters.append("dn.donor_id = :scope_donor_id")
        params["scope_donor_id"] = caller.person_id


async def list_donations(
    session: AsyncSession,
    *,
    caller: UserResponse,
    page: int,
    page_size: int,
    donation_type: str | None,
    record_status: str | None,
) -> PageResponse[DonationResponse]:
    filters: list[str] = []
    params: dict[str, Any] = {}
    _donation_scope(caller, filters, params)
    if donation_type:
        filters.append("dn.donation_type = :donation_type")
        params["donation_type"] = donation_type
    if record_status:
        filters.append("dn.record_status = :record_status")
        params["record_status"] = record_status
    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    return await _paged(
        session,
        count_sql=f"SELECT COUNT(*) {DONATION_FROM} {where}",
        rows_sql=f"""
            SELECT {DONATION_COLUMNS} {DONATION_FROM} {where}
            ORDER BY dn.donation_date DESC, dn.donation_id DESC
            LIMIT :limit OFFSET :offset
        """,
        parameters=params,
        page=page,
        page_size=page_size,
        model=DonationResponse,
    )


async def get_donation(
    session: AsyncSession,
    *,
    caller: UserResponse,
    donation_id: int,
) -> DonationResponse:
    filters = ["dn.donation_id = :donation_id"]
    params: dict[str, Any] = {"donation_id": donation_id}
    _donation_scope(caller, filters, params)
    result = await session.execute(
        text(
            f"SELECT {DONATION_COLUMNS} {DONATION_FROM} WHERE {' AND '.join(filters)}"
        ),
        params,
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise NotFoundError(
            code="donation_not_found", message="Donation not found or not accessible."
        )
    return DonationResponse.model_validate(row)


BLOOD_UNIT_COLUMNS = """
    bu.blood_unit_id, bu.donation_id, dn.donor_id, p.full_name AS donor_name,
    bu.blood_group, bd.collection_bank_id, collection_bank.name AS collection_bank_name,
    bu.current_blood_bank_id, current_bank.name AS current_blood_bank_name,
    dn.donation_date AS collection_date, bu.expiry_date,
    (bu.expiry_date - CURRENT_DATE)::INTEGER AS days_to_expiry, bu.status,
    COALESCE(screening.test_count, 0)::INTEGER AS screening_test_count,
    screening.all_tests_passed, bu.created_at, bu.updated_at
"""

BLOOD_UNIT_FROM = """
    FROM lifelink.blood_unit AS bu
    JOIN lifelink.blood_donation AS bd ON bd.donation_id = bu.donation_id
    JOIN lifelink.donation AS dn ON dn.donation_id = bu.donation_id
    JOIN lifelink.person AS p ON p.person_id = dn.donor_id
    JOIN lifelink.blood_bank AS collection_bank
        ON collection_bank.blood_bank_id = bd.collection_bank_id
    JOIN lifelink.blood_bank AS current_bank
        ON current_bank.blood_bank_id = bu.current_blood_bank_id
    LEFT JOIN LATERAL (
        SELECT COUNT(*)::INTEGER AS test_count, BOOL_AND(mtr.result = 'PASS') AS all_tests_passed
        FROM lifelink.medical_test_result AS mtr
        WHERE mtr.donation_id = bu.donation_id
    ) AS screening ON TRUE
"""


def _blood_bank_scope(
    caller: UserResponse, filters: list[str], params: dict[str, Any]
) -> None:
    if caller.role is UserRole.BLOOD_BANK_STAFF:
        filters.append("bu.current_blood_bank_id = :scope_bank_id")
        params["scope_bank_id"] = caller.blood_bank_id


async def list_blood_units(
    session: AsyncSession,
    *,
    caller: UserResponse,
    page: int,
    page_size: int,
    blood_group: str | None,
    status: str | None,
    blood_bank_id: int | None,
) -> PageResponse[BloodUnitResponse]:
    filters: list[str] = []
    params: dict[str, Any] = {}
    _blood_bank_scope(caller, filters, params)
    if blood_group:
        filters.append("bu.blood_group = :blood_group")
        params["blood_group"] = blood_group
    if status:
        filters.append("bu.status = :status")
        params["status"] = status
    if blood_bank_id:
        filters.append("bu.current_blood_bank_id = :blood_bank_id")
        params["blood_bank_id"] = blood_bank_id
    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    return await _paged(
        session,
        count_sql=f"SELECT COUNT(*) {BLOOD_UNIT_FROM} {where}",
        rows_sql=f"""
            SELECT {BLOOD_UNIT_COLUMNS} {BLOOD_UNIT_FROM} {where}
            ORDER BY bu.expiry_date, bu.blood_unit_id LIMIT :limit OFFSET :offset
        """,
        parameters=params,
        page=page,
        page_size=page_size,
        model=BloodUnitResponse,
    )


async def get_blood_unit(
    session: AsyncSession,
    *,
    caller: UserResponse,
    blood_unit_id: int,
    for_update: bool = False,
) -> BloodUnitResponse:
    filters = ["bu.blood_unit_id = :blood_unit_id"]
    params: dict[str, Any] = {"blood_unit_id": blood_unit_id}
    _blood_bank_scope(caller, filters, params)
    lock = "FOR UPDATE OF bu" if for_update else ""
    result = await session.execute(
        text(
            f"SELECT {BLOOD_UNIT_COLUMNS} {BLOOD_UNIT_FROM} WHERE {' AND '.join(filters)} {lock}"
        ),
        params,
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise NotFoundError(
            code="blood_unit_not_found",
            message="Blood unit not found or not accessible.",
        )
    return BloodUnitResponse.model_validate(row)


async def update_blood_unit_status(
    session: AsyncSession,
    *,
    actor: UserResponse,
    blood_unit_id: int,
    new_status: BloodUnitStatus,
) -> BloodUnitResponse:
    current = await get_blood_unit(
        session, caller=actor, blood_unit_id=blood_unit_id, for_update=True
    )
    if current.status is new_status:
        return current
    try:
        await _set_actor(session, actor.user_id)
        await session.execute(
            text(
                "UPDATE lifelink.blood_unit SET status = :status WHERE blood_unit_id = :blood_unit_id"
            ),
            {"status": new_status.value, "blood_unit_id": blood_unit_id},
        )
        await session.commit()
    except DBAPIError as exc:
        await _rollback_and_raise(session, exc, "blood_unit")
    return await get_blood_unit(session, caller=actor, blood_unit_id=blood_unit_id)


async def get_blood_unit_timeline(
    session: AsyncSession,
    *,
    caller: UserResponse,
    blood_unit_id: int,
) -> BloodUnitTimelineResponse:
    unit = await get_blood_unit(session, caller=caller, blood_unit_id=blood_unit_id)
    result = await session.execute(
        text(
            """
            SELECT al.audit_id, al.action, al.old_status, al.new_status,
                al.action_time, al.user_id, ua.username, al.details
            FROM lifelink.audit_log AS al
            LEFT JOIN lifelink.user_account AS ua ON ua.user_id = al.user_id
            WHERE al.table_name = 'blood_unit' AND al.record_id = :record_id
            ORDER BY al.action_time, al.audit_id
            """
        ),
        {"record_id": str(blood_unit_id)},
    )
    return BloodUnitTimelineResponse(
        blood_unit_id=blood_unit_id,
        current_status=unit.status,
        events=[
            TimelineEventResponse.model_validate(row) for row in result.mappings().all()
        ],
    )


async def _authorize_test_donation(
    session: AsyncSession,
    *,
    actor: UserResponse,
    donation_id: int,
) -> None:
    result = await session.execute(
        text(
            """
            SELECT dn.donation_type, bd.collection_bank_id,
                od.collection_organ_bank_id
            FROM lifelink.donation AS dn
            LEFT JOIN lifelink.blood_donation AS bd ON bd.donation_id = dn.donation_id
            LEFT JOIN lifelink.organ_donation AS od ON od.donation_id = dn.donation_id
            WHERE dn.donation_id = :donation_id
            """
        ),
        {"donation_id": donation_id},
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise NotFoundError(code="donation_not_found", message="Donation not found.")
    if actor.role is UserRole.BLOOD_BANK_STAFF and (
        row["donation_type"] != "BLOOD"
        or row["collection_bank_id"] != actor.blood_bank_id
    ):
        raise ForbiddenError(
            code="donation_bank_forbidden",
            message="Donation belongs to another workflow or bank.",
        )
    if actor.role is UserRole.ORGAN_BANK_STAFF and (
        row["donation_type"] != "ORGAN"
        or row["collection_organ_bank_id"] != actor.organ_bank_id
    ):
        raise ForbiddenError(
            code="donation_bank_forbidden",
            message="Donation belongs to another workflow or bank.",
        )


async def add_medical_test(
    session: AsyncSession,
    *,
    actor: UserResponse,
    donation_id: int,
    payload: MedicalTestCreateRequest,
) -> MedicalTestResponse:
    await _authorize_test_donation(session, actor=actor, donation_id=donation_id)
    try:
        result = await session.execute(
            text(
                """
                INSERT INTO lifelink.medical_test_result (
                    donation_id, test_no, test_name, result, test_date, remarks
                ) VALUES (
                    :donation_id, :test_no, :test_name, :result, :test_date, :remarks
                ) RETURNING donation_id, test_no, test_name, result, test_date, remarks
                """
            ),
            {"donation_id": donation_id, **payload.model_dump()},
        )
        created = MedicalTestResponse.model_validate(result.mappings().one())
        await _audit(
            session,
            actor=actor,
            table_name="medical_test_result",
            record_id=donation_id,
            action="SCREENING_RESULT_ADDED",
            details={"test_no": payload.test_no},
        )
        await session.commit()
        return created
    except DBAPIError as exc:
        await _rollback_and_raise(session, exc, "medical_test")


async def list_medical_tests(
    session: AsyncSession,
    *,
    actor: UserResponse,
    donation_id: int,
) -> list[MedicalTestResponse]:
    await _authorize_test_donation(session, actor=actor, donation_id=donation_id)
    result = await session.execute(
        text(
            """
            SELECT donation_id, test_no, test_name, result, test_date, remarks
            FROM lifelink.medical_test_result
            WHERE donation_id = :donation_id
            ORDER BY test_no
            """
        ),
        {"donation_id": donation_id},
    )
    return [MedicalTestResponse.model_validate(row) for row in result.mappings().all()]


# ---------------------------------------------------------------------------
# Emergency requests and reservations
# ---------------------------------------------------------------------------

REQUEST_COLUMNS = """
    er.request_id, h.hospital_id, h.name AS hospital_name,
    er.recipient_id, rp.full_name AS recipient_name,
    r.blood_group AS recipient_blood_group,
    er.requested_by AS doctor_id, dp.full_name AS doctor_name,
    er.request_type, er.blood_group AS requested_blood_group,
    er.organ_type AS requested_organ_type, er.units_required, er.priority,
    er.requested_at, er.status,
    CASE WHEN er.request_type = 'BLOOD' THEN COALESCE(res.allocated_units, 0) END AS allocated_units,
    CASE WHEN er.request_type = 'BLOOD'
        THEN GREATEST(er.units_required - COALESCE(res.allocated_units, 0), 0) END AS units_remaining,
    res.first_reserved_at, selected.selected_organ_unit_id, er.notes
"""

REQUEST_FROM = """
    FROM lifelink.emergency_request AS er
    JOIN lifelink.recipient AS r ON r.recipient_id = er.recipient_id
    JOIN lifelink.person AS rp ON rp.person_id = r.recipient_id
    JOIN lifelink.doctor AS d ON d.doctor_id = er.requested_by
    JOIN lifelink.person AS dp ON dp.person_id = d.doctor_id
    JOIN lifelink.hospital AS h ON h.hospital_id = d.hospital_id
    LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE br.status IN ('ACTIVE', 'COMPLETED'))::INTEGER AS allocated_units,
            MIN(br.reserved_at) FILTER (WHERE br.status IN ('ACTIVE', 'COMPLETED')) AS first_reserved_at
        FROM lifelink.blood_reservation AS br WHERE br.request_id = er.request_id
    ) AS res ON TRUE
    LEFT JOIN LATERAL (
        SELECT MAX(om.organ_unit_id) AS selected_organ_unit_id
        FROM lifelink.organ_match AS om
        WHERE om.request_id = er.request_id AND om.match_status IN ('SELECTED', 'COMPLETED')
    ) AS selected ON TRUE
"""


def _request_scope(
    caller: UserResponse, filters: list[str], params: dict[str, Any]
) -> None:
    if caller.role is UserRole.DOCTOR:
        filters.append(
            "d.hospital_id = (SELECT hospital_id FROM lifelink.doctor WHERE doctor_id = :scope_person_id)"
        )
        params["scope_person_id"] = caller.person_id
    elif caller.role is UserRole.RECIPIENT:
        filters.append("er.recipient_id = :scope_person_id")
        params["scope_person_id"] = caller.person_id
    elif caller.role is UserRole.BLOOD_BANK_STAFF:
        filters.append("er.request_type = 'BLOOD'")
    elif caller.role is UserRole.ORGAN_BANK_STAFF:
        filters.append("er.request_type = 'ORGAN'")


async def list_emergency_requests(
    session: AsyncSession,
    *,
    caller: UserResponse,
    page: int,
    page_size: int,
    request_type: str | None = None,
    priority: str | None = None,
    status: str | None = None,
    recipient_id: int | None = None,
) -> PageResponse[EmergencyRequestResponse]:
    filters: list[str] = []
    params: dict[str, Any] = {}
    _request_scope(caller, filters, params)
    for column, value in (
        ("er.request_type", request_type),
        ("er.priority", priority),
        ("er.status", status),
        ("er.recipient_id", recipient_id),
    ):
        if value is not None:
            name = column.split(".")[1]
            filters.append(f"{column} = :{name}")
            params[name] = value
    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    return await _paged(
        session,
        count_sql=f"SELECT COUNT(*) {REQUEST_FROM} {where}",
        rows_sql=f"""
            SELECT {REQUEST_COLUMNS} {REQUEST_FROM} {where}
            ORDER BY er.requested_at DESC, er.request_id DESC
            LIMIT :limit OFFSET :offset
        """,
        parameters=params,
        page=page,
        page_size=page_size,
        model=EmergencyRequestResponse,
    )


async def get_emergency_request(
    session: AsyncSession,
    *,
    caller: UserResponse,
    request_id: int,
    for_update: bool = False,
) -> EmergencyRequestResponse:
    filters = ["er.request_id = :request_id"]
    params: dict[str, Any] = {"request_id": request_id}
    _request_scope(caller, filters, params)
    lock = "FOR UPDATE OF er" if for_update else ""
    result = await session.execute(
        text(
            f"SELECT {REQUEST_COLUMNS} {REQUEST_FROM} WHERE {' AND '.join(filters)} {lock}"
        ),
        params,
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise NotFoundError(
            code="emergency_request_not_found",
            message="Emergency request not found or not accessible.",
        )
    return EmergencyRequestResponse.model_validate(row)


async def create_emergency_request(
    session: AsyncSession,
    *,
    actor: UserResponse,
    payload: EmergencyRequestCreateRequest,
) -> EmergencyRequestResponse:
    doctor_id = (
        actor.person_id if actor.role is UserRole.DOCTOR else payload.requested_by
    )
    if doctor_id is None:
        raise UnprocessableError(
            code="requested_by_required",
            message="An administrator must supply requested_by.",
        )
    if actor.role is UserRole.DOCTOR and payload.requested_by not in {
        None,
        actor.person_id,
    }:
        raise ForbiddenError(
            code="doctor_identity_forbidden",
            message="A doctor can create requests only as itself.",
        )
    try:
        result = await session.execute(
            text(
                """
                INSERT INTO lifelink.emergency_request (
                    recipient_id, requested_by, request_type, blood_group,
                    organ_type, units_required, priority, notes
                ) VALUES (
                    :recipient_id, :requested_by, :request_type, :blood_group,
                    :organ_type, :units_required, :priority, :notes
                ) RETURNING request_id
                """
            ),
            {
                "recipient_id": payload.recipient_id,
                "requested_by": doctor_id,
                "request_type": payload.request_type.value,
                "blood_group": payload.blood_group.value
                if payload.blood_group
                else None,
                "organ_type": payload.organ_type,
                "units_required": payload.units_required,
                "priority": payload.priority.value,
                "notes": payload.notes,
            },
        )
        request_id = int(result.scalar_one())
        await _audit(
            session,
            actor=actor,
            table_name="emergency_request",
            record_id=request_id,
            action="EMERGENCY_REQUEST_CREATED",
            new_status="PENDING",
            details={"request_type": payload.request_type.value},
        )
        await session.commit()
    except DBAPIError as exc:
        await _rollback_and_raise(session, exc, "emergency_request")
    return await get_emergency_request(session, caller=actor, request_id=request_id)


async def update_emergency_request(
    session: AsyncSession,
    *,
    actor: UserResponse,
    request_id: int,
    payload: EmergencyRequestUpdateRequest,
) -> EmergencyRequestResponse:
    current = await get_emergency_request(
        session, caller=actor, request_id=request_id, for_update=True
    )
    if actor.role is UserRole.DOCTOR and current.doctor_id != actor.person_id:
        raise ForbiddenError(
            code="request_owner_forbidden",
            message="Only the requesting doctor may edit this request.",
        )
    if payload.status is not None and payload.status.value != "CANCELLED":
        raise UnprocessableError(
            code="request_status_workflow_required",
            message="Only cancellation is allowed here; allocation endpoints control other statuses.",
        )
    if payload.status is not None and current.status not in {
        current.status.PENDING,
        current.status.PARTIALLY_RESERVED,
    }:
        raise ConflictError(
            code="request_cannot_cancel",
            message="This request can no longer be cancelled directly.",
        )
    values: dict[str, Any] = {}
    for name in payload.model_fields_set:
        incoming = getattr(payload, name)
        current_value = getattr(current, name)
        if incoming != current_value:
            values[name] = incoming.value if hasattr(incoming, "value") else incoming
    if not values:
        return current
    try:
        assignments = ", ".join(f"{name} = :{name}" for name in values)
        await session.execute(
            text(
                f"UPDATE lifelink.emergency_request SET {assignments} WHERE request_id = :request_id"
            ),
            {**values, "request_id": request_id},
        )
        await _audit(
            session,
            actor=actor,
            table_name="emergency_request",
            record_id=request_id,
            action="EMERGENCY_REQUEST_UPDATED",
            old_status=current.status.value,
            new_status=values.get("status", current.status.value),
            details={"changed_fields": sorted(values)},
        )
        await session.commit()
    except DBAPIError as exc:
        await _rollback_and_raise(session, exc, "emergency_request")
    return await get_emergency_request(session, caller=actor, request_id=request_id)


RESERVATION_COLUMNS = """
    br.reservation_id, br.request_id, br.blood_unit_id, bu.blood_group,
    bu.current_blood_bank_id AS blood_bank_id, bb.name AS blood_bank_name,
    h.hospital_id, h.name AS hospital_name, er.recipient_id,
    rp.full_name AS recipient_name, br.reserved_at, br.expires_at,
    br.status, br.created_by, ua.username AS created_by_username
"""

RESERVATION_FROM = """
    FROM lifelink.blood_reservation AS br
    JOIN lifelink.blood_unit AS bu ON bu.blood_unit_id = br.blood_unit_id
    JOIN lifelink.blood_bank AS bb ON bb.blood_bank_id = bu.current_blood_bank_id
    JOIN lifelink.emergency_request AS er ON er.request_id = br.request_id
    JOIN lifelink.recipient AS r ON r.recipient_id = er.recipient_id
    JOIN lifelink.person AS rp ON rp.person_id = r.recipient_id
    JOIN lifelink.doctor AS d ON d.doctor_id = er.requested_by
    JOIN lifelink.hospital AS h ON h.hospital_id = d.hospital_id
    JOIN lifelink.user_account AS ua ON ua.user_id = br.created_by
"""


def _reservation_scope(
    caller: UserResponse, filters: list[str], params: dict[str, Any]
) -> None:
    if caller.role is UserRole.BLOOD_BANK_STAFF:
        filters.append("bu.current_blood_bank_id = :scope_bank_id")
        params["scope_bank_id"] = caller.blood_bank_id
    elif caller.role is UserRole.DOCTOR:
        filters.append(
            "d.hospital_id = (SELECT hospital_id FROM lifelink.doctor WHERE doctor_id = :scope_person_id)"
        )
        params["scope_person_id"] = caller.person_id
    elif caller.role is UserRole.RECIPIENT:
        filters.append("er.recipient_id = :scope_person_id")
        params["scope_person_id"] = caller.person_id


async def list_reservations(
    session: AsyncSession,
    *,
    caller: UserResponse,
    page: int,
    page_size: int,
    status: str | None,
) -> PageResponse[ReservationResponse]:
    filters: list[str] = []
    params: dict[str, Any] = {}
    _reservation_scope(caller, filters, params)
    if status:
        filters.append("br.status = :status")
        params["status"] = status
    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    return await _paged(
        session,
        count_sql=f"SELECT COUNT(*) {RESERVATION_FROM} {where}",
        rows_sql=f"""
            SELECT {RESERVATION_COLUMNS} {RESERVATION_FROM} {where}
            ORDER BY br.reserved_at DESC, br.reservation_id DESC
            LIMIT :limit OFFSET :offset
        """,
        parameters=params,
        page=page,
        page_size=page_size,
        model=ReservationResponse,
    )


async def get_reservation(
    session: AsyncSession,
    *,
    caller: UserResponse,
    reservation_id: int,
) -> ReservationResponse:
    filters = ["br.reservation_id = :reservation_id"]
    params: dict[str, Any] = {"reservation_id": reservation_id}
    _reservation_scope(caller, filters, params)
    result = await session.execute(
        text(
            f"SELECT {RESERVATION_COLUMNS} {RESERVATION_FROM} WHERE {' AND '.join(filters)}"
        ),
        params,
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise NotFoundError(
            code="reservation_not_found",
            message="Reservation not found or not accessible.",
        )
    return ReservationResponse.model_validate(row)


async def reserve_emergency_blood(
    session: AsyncSession,
    *,
    actor: UserResponse,
    request_id: int,
    hold_minutes: int,
) -> ReservationResponse:
    try:
        result = await session.execute(
            text(
                """
                SELECT reservation_id
                FROM lifelink.reserve_emergency_blood(
                    :request_id, :user_id, :hold_minutes
                )
                """
            ),
            {
                "request_id": request_id,
                "user_id": actor.user_id,
                "hold_minutes": hold_minutes,
            },
        )
        reservation_id = int(result.scalar_one())
        await session.commit()
    except DBAPIError as exc:
        await _rollback_and_raise(session, exc, "reservation")
    return await get_reservation(session, caller=actor, reservation_id=reservation_id)


async def _lock_reservation(
    session: AsyncSession,
    *,
    actor: UserResponse,
    reservation_id: int,
) -> Mapping[str, Any]:
    filters = ["br.reservation_id = :reservation_id"]
    params: dict[str, Any] = {"reservation_id": reservation_id}
    _reservation_scope(actor, filters, params)
    result = await session.execute(
        text(
            f"""
            SELECT br.reservation_id, br.request_id, br.blood_unit_id,
                br.status, bu.status AS unit_status, bu.expiry_date,
                er.status AS request_status, er.units_required
            FROM lifelink.blood_reservation AS br
            JOIN lifelink.blood_unit AS bu ON bu.blood_unit_id = br.blood_unit_id
            JOIN lifelink.emergency_request AS er ON er.request_id = br.request_id
            JOIN lifelink.doctor AS d ON d.doctor_id = er.requested_by
            WHERE {" AND ".join(filters)}
            FOR UPDATE OF br, bu, er
            """
        ),
        params,
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise NotFoundError(
            code="reservation_not_found",
            message="Reservation not found or not accessible.",
        )
    return row


async def _recalculate_blood_request(
    session: AsyncSession, request_id: int, units_required: int
) -> str:
    result = await session.execute(
        text(
            """
            SELECT
                COUNT(*) FILTER (WHERE status IN ('ACTIVE', 'COMPLETED'))::INTEGER AS allocated,
                COUNT(*) FILTER (WHERE status = 'COMPLETED')::INTEGER AS completed
            FROM lifelink.blood_reservation WHERE request_id = :request_id
            """
        ),
        {"request_id": request_id},
    )
    row = result.mappings().one()
    if row["completed"] >= units_required:
        return "COMPLETED"
    if row["allocated"] >= units_required:
        return "RESERVED"
    if row["allocated"] > 0:
        return "PARTIALLY_RESERVED"
    return "PENDING"


async def cancel_reservation(
    session: AsyncSession,
    *,
    actor: UserResponse,
    reservation_id: int,
) -> ReservationResponse:
    row = await _lock_reservation(session, actor=actor, reservation_id=reservation_id)
    if row["status"] != "ACTIVE":
        raise ConflictError(
            code="reservation_not_active",
            message="Only an ACTIVE reservation can be cancelled.",
        )
    try:
        await _set_actor(session, actor.user_id)
        await session.execute(
            text(
                "UPDATE lifelink.blood_reservation SET status = 'CANCELLED' WHERE reservation_id = :reservation_id"
            ),
            {"reservation_id": reservation_id},
        )
        if row["unit_status"] == "RESERVED":
            unit_status = (
                "EXPIRED" if row["expiry_date"] < date.today() else "AVAILABLE"
            )
            await session.execute(
                text(
                    "UPDATE lifelink.blood_unit SET status = :status WHERE blood_unit_id = :blood_unit_id"
                ),
                {"status": unit_status, "blood_unit_id": row["blood_unit_id"]},
            )
        new_request_status = await _recalculate_blood_request(
            session, row["request_id"], row["units_required"]
        )
        if row["request_status"] not in {"COMPLETED", "CANCELLED"}:
            await session.execute(
                text(
                    "UPDATE lifelink.emergency_request SET status = :status WHERE request_id = :request_id"
                ),
                {"status": new_request_status, "request_id": row["request_id"]},
            )
        await session.commit()
    except DBAPIError as exc:
        await _rollback_and_raise(session, exc, "reservation")
    return await get_reservation(session, caller=actor, reservation_id=reservation_id)


async def issue_reservation(
    session: AsyncSession,
    *,
    actor: UserResponse,
    reservation_id: int,
) -> ReservationResponse:
    row = await _lock_reservation(session, actor=actor, reservation_id=reservation_id)
    if row["status"] != "ACTIVE" or row["unit_status"] != "RESERVED":
        raise ConflictError(
            code="reservation_not_issuable",
            message="Only an ACTIVE reservation with a RESERVED unit can be issued.",
        )
    try:
        await _set_actor(session, actor.user_id)
        await session.execute(
            text(
                "UPDATE lifelink.blood_reservation SET status = 'COMPLETED' WHERE reservation_id = :reservation_id"
            ),
            {"reservation_id": reservation_id},
        )
        await session.execute(
            text(
                "UPDATE lifelink.blood_unit SET status = 'ISSUED' WHERE blood_unit_id = :blood_unit_id"
            ),
            {"blood_unit_id": row["blood_unit_id"]},
        )
        new_request_status = await _recalculate_blood_request(
            session, row["request_id"], row["units_required"]
        )
        await session.execute(
            text(
                "UPDATE lifelink.emergency_request SET status = :status WHERE request_id = :request_id"
            ),
            {"status": new_request_status, "request_id": row["request_id"]},
        )
        await session.commit()
    except DBAPIError as exc:
        await _rollback_and_raise(session, exc, "reservation")
    return await get_reservation(session, caller=actor, reservation_id=reservation_id)


# ---------------------------------------------------------------------------
# Organ units and transparent academic matching
# ---------------------------------------------------------------------------

ORGAN_COLUMNS = """
    ou.organ_unit_id, ou.donation_id, dn.donor_id, p.full_name AS donor_name,
    ou.organ_type, ou.current_organ_bank_id, ob.name AS current_organ_bank_name,
    ou.status, dn.donation_date, ou.created_at
"""

ORGAN_FROM = """
    FROM lifelink.organ_unit AS ou
    JOIN lifelink.organ_donation AS od ON od.donation_id = ou.donation_id
    JOIN lifelink.donation AS dn ON dn.donation_id = ou.donation_id
    JOIN lifelink.person AS p ON p.person_id = dn.donor_id
    JOIN lifelink.organ_bank AS ob ON ob.organ_bank_id = ou.current_organ_bank_id
"""


def _organ_scope(
    caller: UserResponse, filters: list[str], params: dict[str, Any]
) -> None:
    if caller.role is UserRole.ORGAN_BANK_STAFF:
        filters.append("ou.current_organ_bank_id = :scope_bank_id")
        params["scope_bank_id"] = caller.organ_bank_id


async def list_organs(
    session: AsyncSession,
    *,
    caller: UserResponse,
    page: int,
    page_size: int,
    organ_type: str | None,
    status: str | None,
) -> PageResponse[OrganUnitResponse]:
    filters: list[str] = []
    params: dict[str, Any] = {}
    _organ_scope(caller, filters, params)
    if organ_type:
        filters.append("ou.organ_type = :organ_type")
        params["organ_type"] = organ_type.strip().upper()
    if status:
        filters.append("ou.status = :status")
        params["status"] = status
    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    return await _paged(
        session,
        count_sql=f"SELECT COUNT(*) {ORGAN_FROM} {where}",
        rows_sql=f"""
            SELECT {ORGAN_COLUMNS} {ORGAN_FROM} {where}
            ORDER BY ou.created_at DESC, ou.organ_unit_id DESC
            LIMIT :limit OFFSET :offset
        """,
        parameters=params,
        page=page,
        page_size=page_size,
        model=OrganUnitResponse,
    )


async def get_organ(
    session: AsyncSession,
    *,
    caller: UserResponse,
    organ_unit_id: int,
) -> OrganUnitResponse:
    filters = ["ou.organ_unit_id = :organ_unit_id"]
    params: dict[str, Any] = {"organ_unit_id": organ_unit_id}
    _organ_scope(caller, filters, params)
    result = await session.execute(
        text(f"SELECT {ORGAN_COLUMNS} {ORGAN_FROM} WHERE {' AND '.join(filters)}"),
        params,
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise NotFoundError(
            code="organ_unit_not_found",
            message="Organ unit not found or not accessible.",
        )
    return OrganUnitResponse.model_validate(row)


async def calculate_organ_matches(
    session: AsyncSession,
    *,
    actor: UserResponse,
    organ_unit_id: int,
    payload: OrganMatchCalculateRequest,
) -> list[OrganMatchResponse]:
    await get_organ(session, caller=actor, organ_unit_id=organ_unit_id)
    created: list[OrganMatchResponse] = []
    try:
        for candidate in payload.candidates:
            result = await session.execute(
                text(
                    """
                    SELECT * FROM lifelink.calculate_organ_match(
                        :request_id, :organ_unit_id, :compatibility_score, :user_id
                    )
                    """
                ),
                {
                    "request_id": candidate.request_id,
                    "organ_unit_id": organ_unit_id,
                    "compatibility_score": candidate.compatibility_score,
                    "user_id": actor.user_id,
                },
            )
            created.append(OrganMatchResponse.model_validate(result.mappings().one()))
        await session.commit()
        return created
    except DBAPIError as exc:
        await _rollback_and_raise(session, exc, "organ_match")


async def list_organ_matches(
    session: AsyncSession,
    *,
    actor: UserResponse,
    organ_unit_id: int,
) -> list[OrganMatchResponse]:
    await get_organ(session, caller=actor, organ_unit_id=organ_unit_id)
    result = await session.execute(
        text(
            """
            SELECT match_id, request_id, organ_unit_id, organ_type,
                recipient_id, recipient_name, hospital_id, hospital_name,
                priority, compatibility_score, urgency_score, waiting_time_score,
                final_priority AS academic_priority_score, candidate_rank,
                match_status, calculated_at
            FROM lifelink.organ_match_priority_view
            WHERE organ_unit_id = :organ_unit_id
            ORDER BY candidate_rank
            """
        ),
        {"organ_unit_id": organ_unit_id},
    )
    return [OrganMatchResponse.model_validate(row) for row in result.mappings().all()]


async def update_organ_match_status(
    session: AsyncSession,
    *,
    actor: UserResponse,
    match_id: int,
    new_status: OrganMatchStatus,
) -> OrganMatchResponse:
    scope = ""
    params: dict[str, Any] = {"match_id": match_id}
    if actor.role is UserRole.ORGAN_BANK_STAFF:
        scope = "AND ou.current_organ_bank_id = :scope_bank_id"
        params["scope_bank_id"] = actor.organ_bank_id
    result = await session.execute(
        text(
            f"""
            SELECT om.match_id, om.request_id, om.organ_unit_id, om.match_status,
                ou.status AS unit_status, er.status AS request_status
            FROM lifelink.organ_match AS om
            JOIN lifelink.organ_unit AS ou ON ou.organ_unit_id = om.organ_unit_id
            JOIN lifelink.emergency_request AS er ON er.request_id = om.request_id
            WHERE om.match_id = :match_id {scope}
            FOR UPDATE OF om, ou, er
            """
        ),
        params,
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise NotFoundError(
            code="organ_match_not_found",
            message="Organ match not found or not accessible.",
        )
    old_status = OrganMatchStatus(row["match_status"])
    visible_matches = await list_organ_matches(
        session,
        actor=actor,
        organ_unit_id=row["organ_unit_id"],
    )
    visible_match = next(
        (match for match in visible_matches if match.match_id == match_id),
        None,
    )
    allowed = {
        OrganMatchStatus.CANDIDATE: {
            OrganMatchStatus.SELECTED,
            OrganMatchStatus.REJECTED,
        },
        OrganMatchStatus.SELECTED: {OrganMatchStatus.COMPLETED},
    }
    if new_status is old_status:
        if visible_match is None:
            raise ConflictError(
                code="organ_match_terminal",
                message="A rejected organ match is terminal.",
            )
        return visible_match
    elif new_status not in allowed.get(old_status, set()):
        raise ConflictError(
            code="invalid_organ_match_transition",
            message=f"Invalid organ-match transition: {old_status.value} -> {new_status.value}.",
        )
    else:
        try:
            await _set_actor(session, actor.user_id)
            await session.execute(
                text(
                    "UPDATE lifelink.organ_match SET match_status = :status WHERE match_id = :match_id"
                ),
                {"status": new_status.value, "match_id": match_id},
            )
            if new_status is OrganMatchStatus.SELECTED:
                await session.execute(
                    text(
                        "UPDATE lifelink.organ_unit SET status = 'ALLOCATED' WHERE organ_unit_id = :organ_unit_id"
                    ),
                    {"organ_unit_id": row["organ_unit_id"]},
                )
                await session.execute(
                    text(
                        "UPDATE lifelink.emergency_request SET status = 'MATCHED' WHERE request_id = :request_id"
                    ),
                    {"request_id": row["request_id"]},
                )
            elif new_status is OrganMatchStatus.COMPLETED:
                await session.execute(
                    text(
                        "UPDATE lifelink.emergency_request SET status = 'COMPLETED' WHERE request_id = :request_id"
                    ),
                    {"request_id": row["request_id"]},
                )
            await _audit(
                session,
                actor=actor,
                table_name="organ_match",
                record_id=match_id,
                action="ORGAN_MATCH_STATUS_CHANGED",
                old_status=old_status.value,
                new_status=new_status.value,
                details={
                    "organ_unit_id": row["organ_unit_id"],
                    "request_id": row["request_id"],
                },
            )
            await session.commit()
        except DBAPIError as exc:
            await _rollback_and_raise(session, exc, "organ_match")
    if new_status is OrganMatchStatus.REJECTED:
        if visible_match is None:
            raise ConflictError(
                code="organ_match_not_ranked",
                message="The organ match is not present in the academic ranking.",
            )
        return visible_match.model_copy(update={"match_status": new_status})
    matches = await list_organ_matches(
        session, actor=actor, organ_unit_id=row["organ_unit_id"]
    )
    return next(match for match in matches if match.match_id == match_id)


# ---------------------------------------------------------------------------
# Camps, reports, and audit
# ---------------------------------------------------------------------------


async def list_camps(
    session: AsyncSession, *, status: str | None
) -> list[CampResponse]:
    where = "WHERE dc.status = :status" if status else ""
    result = await session.execute(
        text(
            f"""
            SELECT dc.camp_id, dc.camp_date, dc.organizer, dc.contact_phone,
                dc.status, a.address_id, a.line1, a.line2, a.city, a.district,
                a.state, a.pincode, COUNT(dr.registration_id)::INTEGER AS registration_count
            FROM lifelink.donation_camp AS dc
            JOIN lifelink.address AS a ON a.address_id = dc.address_id
            LEFT JOIN lifelink.donation_registration AS dr ON dr.camp_id = dc.camp_id
            {where}
            GROUP BY dc.camp_id, a.address_id
            ORDER BY dc.camp_date DESC, dc.camp_id DESC
            """
        ),
        {"status": status} if status else {},
    )
    return [
        CampResponse.model_validate(_nested_address(dict(row)))
        for row in result.mappings().all()
    ]


async def get_camp(session: AsyncSession, camp_id: int) -> CampResponse:
    result = await session.execute(
        text(
            """
            SELECT dc.camp_id, dc.camp_date, dc.organizer, dc.contact_phone,
                dc.status, a.address_id, a.line1, a.line2, a.city, a.district,
                a.state, a.pincode, COUNT(dr.registration_id)::INTEGER AS registration_count
            FROM lifelink.donation_camp AS dc
            JOIN lifelink.address AS a ON a.address_id = dc.address_id
            LEFT JOIN lifelink.donation_registration AS dr ON dr.camp_id = dc.camp_id
            WHERE dc.camp_id = :camp_id
            GROUP BY dc.camp_id, a.address_id
            """
        ),
        {"camp_id": camp_id},
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise NotFoundError(code="camp_not_found", message="Donation camp not found.")
    return CampResponse.model_validate(_nested_address(dict(row)))


async def create_camp(
    session: AsyncSession,
    *,
    actor: UserResponse,
    payload: CampCreateRequest,
) -> CampResponse:
    try:
        address_id = await _create_address(session, payload.address)
        result = await session.execute(
            text(
                """
                INSERT INTO lifelink.donation_camp (
                    address_id, camp_date, organizer, contact_phone, status
                ) VALUES (
                    :address_id, :camp_date, :organizer, :contact_phone, :status
                ) RETURNING camp_id
                """
            ),
            {"address_id": address_id, **payload.model_dump(exclude={"address"})},
        )
        camp_id = int(result.scalar_one())
        await _audit(
            session,
            actor=actor,
            table_name="donation_camp",
            record_id=camp_id,
            action="CAMP_CREATED",
            new_status=payload.status.value,
            details={
                "changed_fields": [
                    "address",
                    "camp_date",
                    "contact_phone",
                    "organizer",
                    "status",
                ]
            },
        )
        await session.commit()
    except DBAPIError as exc:
        await _rollback_and_raise(session, exc, "camp")
    return await get_camp(session, camp_id)


async def register_for_camp(
    session: AsyncSession,
    *,
    actor: UserResponse,
    camp_id: int,
    donor_id: int | None,
) -> CampRegistrationResponse:
    effective_donor_id = actor.person_id if actor.role is UserRole.DONOR else donor_id
    if effective_donor_id is None:
        raise UnprocessableError(
            code="donor_id_required", message="donor_id is required for this role."
        )
    if actor.role is UserRole.DONOR and donor_id not in {None, actor.person_id}:
        raise ForbiddenError(
            code="camp_registration_forbidden",
            message="A donor can register only itself.",
        )
    try:
        result = await session.execute(
            text(
                """
                INSERT INTO lifelink.donation_registration (
                    camp_id, donor_id, registration_status
                ) VALUES (
                    :camp_id, :donor_id, 'REGISTERED'
                ) RETURNING registration_id, camp_id, donor_id,
                    registration_status, registered_at
                """
            ),
            {"camp_id": camp_id, "donor_id": effective_donor_id},
        )
        created = CampRegistrationResponse.model_validate(result.mappings().one())
        await _audit(
            session,
            actor=actor,
            table_name="donation_registration",
            record_id=created.registration_id,
            action="CAMP_REGISTRATION_CREATED",
            new_status="REGISTERED",
            details={"camp_id": camp_id, "donor_id": effective_donor_id},
        )
        await session.commit()
        return created
    except DBAPIError as exc:
        await _rollback_and_raise(session, exc, "camp_registration")


async def blood_inventory_report(
    session: AsyncSession,
    *,
    actor: UserResponse,
    blood_bank_id: int | None,
    blood_group: str | None,
    status: str | None,
) -> list[BloodInventoryReportRow]:
    effective_bank = (
        actor.blood_bank_id
        if actor.role is UserRole.BLOOD_BANK_STAFF
        else blood_bank_id
    )
    result = await session.execute(
        text(
            "SELECT * FROM lifelink.generate_inventory_report(:bank_id, :blood_group, :status)"
        ),
        {"bank_id": effective_bank, "blood_group": blood_group, "status": status},
    )
    return [
        BloodInventoryReportRow.model_validate(row) for row in result.mappings().all()
    ]


async def expiring_units_report(
    session: AsyncSession,
    *,
    actor: UserResponse,
) -> list[BloodUnitResponse]:
    where = ""
    params: dict[str, Any] = {}
    if actor.role is UserRole.BLOOD_BANK_STAFF:
        where = "WHERE v.current_blood_bank_id = :bank_id"
        params["bank_id"] = actor.blood_bank_id
    result = await session.execute(
        text(
            f"""
            SELECT v.*, bu.status, bu.created_at, bu.updated_at
            FROM lifelink.expiring_blood_units_view AS v
            JOIN lifelink.blood_unit AS bu ON bu.blood_unit_id = v.blood_unit_id
            {where}
            ORDER BY v.days_to_expiry, v.blood_unit_id
            """
        ),
        params,
    )
    return [BloodUnitResponse.model_validate(row) for row in result.mappings().all()]


async def emergency_summary_report(session: AsyncSession) -> list[EmergencySummaryRow]:
    result = await session.execute(
        text(
            """
            SELECT h.hospital_id, h.name AS hospital_name, er.request_type,
                er.priority, er.status, COUNT(*)::INTEGER AS request_count
            FROM lifelink.emergency_request AS er
            JOIN lifelink.doctor AS d ON d.doctor_id = er.requested_by
            JOIN lifelink.hospital AS h ON h.hospital_id = d.hospital_id
            GROUP BY h.hospital_id, h.name, er.request_type, er.priority, er.status
            ORDER BY h.name, er.request_type, er.priority, er.status
            """
        )
    )
    return [EmergencySummaryRow.model_validate(row) for row in result.mappings().all()]


async def donation_trends_report(session: AsyncSession) -> list[DonationTrendRow]:
    result = await session.execute(
        text(
            """
            SELECT date_trunc('month', donation_date)::DATE AS month,
                donation_type, COUNT(*)::INTEGER AS donation_count
            FROM lifelink.donation WHERE record_status = 'ACTIVE'
            GROUP BY date_trunc('month', donation_date), donation_type
            ORDER BY month, donation_type
            """
        )
    )
    return [DonationTrendRow.model_validate(row) for row in result.mappings().all()]


async def reservation_summary_report(
    session: AsyncSession,
    *,
    actor: UserResponse,
) -> list[ReservationSummaryRow]:
    where = ""
    params: dict[str, Any] = {}
    if actor.role is UserRole.BLOOD_BANK_STAFF:
        where = "WHERE bu.current_blood_bank_id = :bank_id"
        params["bank_id"] = actor.blood_bank_id
    result = await session.execute(
        text(
            f"""
            SELECT bb.blood_bank_id, bb.name AS blood_bank_name, br.status,
                COUNT(*)::INTEGER AS reservation_count
            FROM lifelink.blood_reservation AS br
            JOIN lifelink.blood_unit AS bu ON bu.blood_unit_id = br.blood_unit_id
            JOIN lifelink.blood_bank AS bb ON bb.blood_bank_id = bu.current_blood_bank_id
            {where}
            GROUP BY bb.blood_bank_id, bb.name, br.status
            ORDER BY bb.name, br.status
            """
        ),
        params,
    )
    return [
        ReservationSummaryRow.model_validate(row) for row in result.mappings().all()
    ]


async def organ_matches_report(session: AsyncSession) -> list[OrganMatchResponse]:
    result = await session.execute(
        text(
            """
            SELECT match_id, request_id, organ_unit_id, organ_type,
                recipient_id, recipient_name, hospital_id, hospital_name,
                priority, compatibility_score, urgency_score, waiting_time_score,
                final_priority AS academic_priority_score, candidate_rank,
                match_status, calculated_at
            FROM lifelink.organ_match_priority_view
            ORDER BY organ_unit_id, candidate_rank
            """
        )
    )
    return [OrganMatchResponse.model_validate(row) for row in result.mappings().all()]


async def hospital_response_time_report(
    session: AsyncSession,
) -> list[HospitalResponseTimeRow]:
    result = await session.execute(
        text(
            """
            SELECT h.hospital_id, h.name AS hospital_name,
                COUNT(DISTINCT er.request_id)::INTEGER AS reserved_request_count,
                ROUND(AVG(EXTRACT(EPOCH FROM (first_hold.reserved_at - er.requested_at)) / 60.0), 2)
                    AS average_response_minutes
            FROM lifelink.emergency_request AS er
            JOIN lifelink.doctor AS d ON d.doctor_id = er.requested_by
            JOIN lifelink.hospital AS h ON h.hospital_id = d.hospital_id
            JOIN LATERAL (
                SELECT MIN(br.reserved_at) AS reserved_at
                FROM lifelink.blood_reservation AS br
                WHERE br.request_id = er.request_id
                  AND br.status IN ('ACTIVE', 'COMPLETED')
            ) AS first_hold ON first_hold.reserved_at IS NOT NULL
            GROUP BY h.hospital_id, h.name
            ORDER BY h.name
            """
        )
    )
    return [
        HospitalResponseTimeRow.model_validate(row) for row in result.mappings().all()
    ]


async def list_audit_logs(
    session: AsyncSession,
    *,
    page: int,
    page_size: int,
    table_name: str | None,
    record_id: str | None,
    action: str | None,
    user_id: int | None,
) -> PageResponse[AuditLogResponse]:
    filters: list[str] = []
    params: dict[str, Any] = {}
    for column, value in (
        ("al.table_name", table_name),
        ("al.record_id", record_id),
        ("al.action", action),
        ("al.user_id", user_id),
    ):
        if value is not None:
            name = column.split(".")[1]
            filters.append(f"{column} = :{name}")
            params[name] = value
    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    source = """
        FROM lifelink.audit_log AS al
        LEFT JOIN lifelink.user_account AS ua ON ua.user_id = al.user_id
    """
    return await _paged(
        session,
        count_sql=f"SELECT COUNT(*) {source} {where}",
        rows_sql=f"""
            SELECT al.audit_id, al.user_id, ua.username, al.table_name,
                al.record_id, al.action, al.old_status, al.new_status,
                al.action_time, al.details
            {source} {where}
            ORDER BY al.action_time DESC, al.audit_id DESC
            LIMIT :limit OFFSET :offset
        """,
        parameters=params,
        page=page,
        page_size=page_size,
        model=AuditLogResponse,
    )
