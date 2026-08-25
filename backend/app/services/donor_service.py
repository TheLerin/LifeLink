"""Parameterized PostgreSQL access for normalized donor profiles and history."""

import json
from collections.abc import Mapping
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.auth import UserResponse
from app.schemas.donors import (
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
)
from app.utils.errors import ConflictError, NotFoundError, UnprocessableError

DONOR_SUMMARY_COLUMNS = """
    d.donor_id,
    p.full_name,
    p.date_of_birth,
    EXTRACT(YEAR FROM AGE(CURRENT_DATE, p.date_of_birth))::INTEGER AS age_years,
    p.gender,
    d.blood_group,
    d.weight_kg,
    d.is_active,
    a.city,
    a.district,
    last_blood.last_blood_donation_date,
    COALESCE(active_conditions.active_condition_count, 0)::INTEGER
        AS active_condition_count,
    (eligible.donor_id IS NOT NULL) AS is_eligible_demo,
    'Simplified academic rule; not medical clearance'::TEXT AS eligibility_note
"""

DONOR_FROM_JOINS = """
    FROM lifelink.donor AS d
    JOIN lifelink.person AS p
        ON p.person_id = d.donor_id
    JOIN lifelink.address AS a
        ON a.address_id = p.address_id
    LEFT JOIN LATERAL (
        SELECT MAX(dn.donation_date) AS last_blood_donation_date
        FROM lifelink.donation AS dn
        WHERE dn.donor_id = d.donor_id
          AND dn.donation_type = 'BLOOD'
          AND dn.record_status = 'ACTIVE'
    ) AS last_blood ON TRUE
    LEFT JOIN LATERAL (
        SELECT COUNT(*)::INTEGER AS active_condition_count
        FROM lifelink.donor_condition AS dc
        WHERE dc.donor_id = d.donor_id
          AND dc.condition_status = 'ACTIVE'
    ) AS active_conditions ON TRUE
    LEFT JOIN lifelink.eligible_donors_view AS eligible
        ON eligible.donor_id = d.donor_id
"""

LOCK_DONOR_QUERY = text(
    f"""
    SELECT
        {DONOR_SUMMARY_COLUMNS},
        p.address_id,
        p.created_at,
        p.updated_at,
        a.line1,
        a.line2,
        a.state,
        a.pincode
    {DONOR_FROM_JOINS}
    WHERE d.donor_id = :donor_id
    FOR UPDATE OF d, p, a
    """
)

DONOR_DETAIL_QUERY = text(
    f"""
    SELECT
        {DONOR_SUMMARY_COLUMNS},
        p.address_id,
        p.created_at,
        p.updated_at,
        a.line1,
        a.line2,
        a.state,
        a.pincode
    {DONOR_FROM_JOINS}
    WHERE d.donor_id = :donor_id
    """
)

DONOR_PHONES_QUERY = text(
    """
    SELECT phone_id, phone_number, is_primary
    FROM lifelink.donor_phone
    WHERE donor_id = :donor_id
    ORDER BY is_primary DESC, phone_id
    """
)

INSERT_ADDRESS_QUERY = text(
    """
    INSERT INTO lifelink.address (
        line1, line2, city, district, state, pincode
    ) VALUES (
        :line1, :line2, :city, :district, :state, :pincode
    )
    RETURNING address_id
    """
)

INSERT_PERSON_QUERY = text(
    """
    INSERT INTO lifelink.person (
        full_name, date_of_birth, gender, address_id
    ) VALUES (
        :full_name, :date_of_birth, :gender, :address_id
    )
    RETURNING person_id
    """
)

INSERT_DONOR_QUERY = text(
    """
    INSERT INTO lifelink.donor (
        donor_id, weight_kg, blood_group, is_active
    ) VALUES (
        :donor_id, :weight_kg, :blood_group, :is_active
    )
    """
)

INSERT_PHONE_QUERY = text(
    """
    INSERT INTO lifelink.donor_phone (
        donor_id, phone_number, is_primary
    ) VALUES (
        :donor_id, :phone_number, :is_primary
    )
    """
)

DELETE_PHONES_QUERY = text(
    """
    DELETE FROM lifelink.donor_phone
    WHERE donor_id = :donor_id
    """
)

SET_ACTOR_QUERY = text(
    """
    SELECT set_config('lifelink.app_user_id', :actor_user_id, TRUE)
    """
)

INSERT_AUDIT_QUERY = text(
    """
    INSERT INTO lifelink.audit_log (
        user_id, table_name, record_id, action, details
    ) VALUES (
        :actor_user_id, 'donor', :record_id, :action, :details
    )
    """
)

DONATION_HISTORY_FROM = """
    FROM lifelink.donation AS dn
    LEFT JOIN lifelink.donation_camp AS camp
        ON camp.camp_id = dn.camp_id
    LEFT JOIN lifelink.blood_donation AS bd
        ON bd.donation_id = dn.donation_id
    LEFT JOIN lifelink.blood_bank AS bb
        ON bb.blood_bank_id = bd.collection_bank_id
    LEFT JOIN lifelink.blood_unit AS bu
        ON bu.donation_id = dn.donation_id
    LEFT JOIN lifelink.organ_donation AS od
        ON od.donation_id = dn.donation_id
    LEFT JOIN lifelink.organ_bank AS ob
        ON ob.organ_bank_id = od.collection_organ_bank_id
    LEFT JOIN lifelink.organ_unit AS ou
        ON ou.donation_id = dn.donation_id
"""

DONATION_HISTORY_COLUMNS = """
    dn.donation_id,
    dn.donation_date,
    dn.donation_type,
    dn.record_status,
    dn.camp_id,
    camp.organizer AS camp_organizer,
    bd.collection_bank_id,
    bb.name AS collection_bank_name,
    od.collection_organ_bank_id,
    ob.name AS collection_organ_bank_name,
    bd.quantity_collected_ml,
    COALESCE(bu.blood_unit_id, ou.organ_unit_id) AS unit_id,
    CASE
        WHEN dn.donation_type = 'BLOOD' THEN bu.blood_group
        ELSE ou.organ_type
    END AS unit_type,
    COALESCE(bu.status, ou.status) AS unit_status,
    bu.expiry_date,
    COALESCE(bd.notes, od.notes) AS notes
"""

CONDITION_HISTORY_QUERY = text(
    """
    SELECT
        mc.condition_id,
        mc.condition_name,
        mc.description,
        dc.diagnosed_date,
        dc.condition_status
    FROM lifelink.donor_condition AS dc
    JOIN lifelink.medical_condition AS mc
        ON mc.condition_id = dc.condition_id
    WHERE dc.donor_id = :donor_id
      AND (
          CAST(:condition_status AS VARCHAR) IS NULL
          OR dc.condition_status = :condition_status
      )
    ORDER BY
        CASE dc.condition_status
            WHEN 'ACTIVE' THEN 1
            WHEN 'MONITORED' THEN 2
            WHEN 'RESOLVED' THEN 3
            ELSE 4
        END,
        dc.diagnosed_date DESC NULLS LAST,
        mc.condition_name
    """
)


def _integrity_error(exc: IntegrityError) -> Exception:
    diagnostic = getattr(exc.orig, "diag", None)
    constraint = getattr(diagnostic, "constraint_name", None)
    sqlstate = getattr(exc.orig, "sqlstate", None)

    if constraint == "uq_donor_phone_number":
        return ConflictError(
            code="duplicate_donor_phone",
            message="That phone number is already assigned to this donor.",
        )
    if constraint == "uq_donor_phone_one_primary":
        return ConflictError(
            code="multiple_primary_phones",
            message="A donor can have only one primary phone number.",
        )
    if sqlstate == "23503":
        return UnprocessableError(
            code="invalid_donor_reference",
            message="A referenced donor record does not exist.",
        )
    if sqlstate == "23505":
        return ConflictError(
            code="donor_unique_conflict",
            message="The donor change conflicts with an existing record.",
        )
    if sqlstate == "23514":
        return UnprocessableError(
            code="donor_constraint_violation",
            message="The donor change violates a database constraint.",
        )
    return UnprocessableError(
        code="donor_write_failed",
        message="The donor change could not be accepted.",
    )


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _summary_from_row(row: Mapping[str, Any]) -> DonorSummaryResponse:
    return DonorSummaryResponse.model_validate(dict(row))


async def _set_actor(session: AsyncSession, actor_user_id: int) -> None:
    await session.execute(SET_ACTOR_QUERY, {"actor_user_id": str(actor_user_id)})


async def _audit_donor_change(
    session: AsyncSession,
    *,
    actor_user_id: int,
    donor_id: int,
    action: str,
    changed_fields: list[str],
) -> None:
    await session.execute(
        INSERT_AUDIT_QUERY,
        {
            "actor_user_id": actor_user_id,
            "record_id": str(donor_id),
            "action": action,
            "details": json.dumps(
                {"changed_fields": sorted(changed_fields)},
                separators=(",", ":"),
            ),
        },
    )


async def donor_exists(session: AsyncSession, donor_id: int) -> bool:
    result = await session.execute(
        text("SELECT EXISTS (SELECT 1 FROM lifelink.donor WHERE donor_id = :donor_id)"),
        {"donor_id": donor_id},
    )
    return bool(result.scalar_one())


async def _get_donor_row(
    session: AsyncSession,
    donor_id: int,
    *,
    for_update: bool = False,
) -> Mapping[str, Any]:
    query = LOCK_DONOR_QUERY if for_update else DONOR_DETAIL_QUERY
    result = await session.execute(query, {"donor_id": donor_id})
    row = result.mappings().one_or_none()
    if row is None:
        raise NotFoundError(
            code="donor_not_found",
            message="The requested donor was not found.",
        )
    return row


async def _get_phones(
    session: AsyncSession,
    donor_id: int,
) -> list[DonorPhoneResponse]:
    result = await session.execute(DONOR_PHONES_QUERY, {"donor_id": donor_id})
    return [DonorPhoneResponse.model_validate(row) for row in result.mappings().all()]


def _detail_from_row(
    row: Mapping[str, Any],
    phones: list[DonorPhoneResponse],
) -> DonorDetailResponse:
    values = dict(row)
    values["address"] = {
        "address_id": values["address_id"],
        "line1": values["line1"],
        "line2": values["line2"],
        "city": values["city"],
        "district": values["district"],
        "state": values["state"],
        "pincode": values["pincode"],
    }
    values["phones"] = phones
    return DonorDetailResponse.model_validate(values)


async def list_donors(
    session: AsyncSession,
    *,
    page: int,
    page_size: int,
    blood_group: str | None,
    is_active: bool | None,
    eligible_only: bool,
    search: str | None,
) -> DonorListResponse:
    filters: list[str] = []
    parameters: dict[str, Any] = {}
    if blood_group is not None:
        filters.append("d.blood_group = :blood_group")
        parameters["blood_group"] = blood_group
    if is_active is not None:
        filters.append("d.is_active = :is_active")
        parameters["is_active"] = is_active
    if eligible_only:
        filters.append("eligible.donor_id IS NOT NULL")
    if search:
        filters.append("p.full_name ILIKE :search ESCAPE E'\\\\'")
        parameters["search"] = f"%{_escape_like(search.strip())}%"

    where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""
    count_query = text(
        f"""
        SELECT COUNT(*)
        {DONOR_FROM_JOINS}
        {where_clause}
        """
    )
    rows_query = text(
        f"""
        SELECT {DONOR_SUMMARY_COLUMNS}
        {DONOR_FROM_JOINS}
        {where_clause}
        ORDER BY p.full_name, d.donor_id
        LIMIT :limit OFFSET :offset
        """
    )
    total_result = await session.execute(count_query, parameters)
    total = total_result.scalar_one()
    rows_result = await session.execute(
        rows_query,
        {
            **parameters,
            "limit": page_size,
            "offset": (page - 1) * page_size,
        },
    )
    items = [_summary_from_row(row) for row in rows_result.mappings().all()]
    return DonorListResponse(
        items=items,
        page=page,
        page_size=page_size,
        total=total,
        total_pages=(total + page_size - 1) // page_size,
    )


async def get_donor(session: AsyncSession, donor_id: int) -> DonorDetailResponse:
    row = await _get_donor_row(session, donor_id)
    phones = await _get_phones(session, donor_id)
    return _detail_from_row(row, phones)


async def create_donor(
    session: AsyncSession,
    *,
    actor: UserResponse,
    payload: DonorCreateRequest,
) -> DonorDetailResponse:
    try:
        await _set_actor(session, actor.user_id)
        address_result = await session.execute(
            INSERT_ADDRESS_QUERY,
            payload.address.model_dump(),
        )
        address_id = address_result.scalar_one()
        person_result = await session.execute(
            INSERT_PERSON_QUERY,
            {
                "full_name": payload.full_name,
                "date_of_birth": payload.date_of_birth,
                "gender": payload.gender.value,
                "address_id": address_id,
            },
        )
        donor_id = person_result.scalar_one()
        await session.execute(
            INSERT_DONOR_QUERY,
            {
                "donor_id": donor_id,
                "weight_kg": payload.weight_kg,
                "blood_group": payload.blood_group.value,
                "is_active": payload.is_active,
            },
        )
        for phone in payload.phones:
            await session.execute(
                INSERT_PHONE_QUERY,
                {"donor_id": donor_id, **phone.model_dump()},
            )
        await _audit_donor_change(
            session,
            actor_user_id=actor.user_id,
            donor_id=donor_id,
            action="CREATE",
            changed_fields=["address", "person", "donor", "phones"],
        )
        await session.commit()
    except IntegrityError as exc:
        raise _integrity_error(exc) from exc

    return await get_donor(session, donor_id)


async def update_donor(
    session: AsyncSession,
    *,
    actor: UserResponse,
    donor_id: int,
    payload: DonorUpdateRequest,
) -> DonorDetailResponse:
    target = await _get_donor_row(session, donor_id, for_update=True)
    person_updates: dict[str, Any] = {}
    donor_updates: dict[str, Any] = {}
    address_updates: dict[str, Any] = {}
    changed_fields: list[str] = []

    for field_name in ("full_name", "date_of_birth", "gender"):
        if field_name not in payload.model_fields_set:
            continue
        value = getattr(payload, field_name)
        bound_value = value.value if hasattr(value, "value") else value
        if bound_value != target[field_name]:
            person_updates[field_name] = bound_value
            changed_fields.append(field_name)

    for field_name in ("weight_kg", "blood_group", "is_active"):
        if field_name not in payload.model_fields_set:
            continue
        value = getattr(payload, field_name)
        bound_value = value.value if hasattr(value, "value") else value
        if bound_value != target[field_name]:
            donor_updates[field_name] = bound_value
            changed_fields.append(field_name)

    if payload.address is not None:
        for field_name in payload.address.model_fields_set:
            value = getattr(payload.address, field_name)
            if value != target[field_name]:
                address_updates[field_name] = value
                changed_fields.append(f"address.{field_name}")

    replace_phones = payload.phones is not None
    if replace_phones:
        changed_fields.append("phones")

    if not changed_fields:
        phones = await _get_phones(session, donor_id)
        return _detail_from_row(target, phones)

    try:
        await _set_actor(session, actor.user_id)
        if person_updates:
            assignments = ", ".join(f"{key} = :{key}" for key in person_updates)
            await session.execute(
                text(
                    f"UPDATE lifelink.person SET {assignments} "
                    "WHERE person_id = :donor_id"
                ),
                {**person_updates, "donor_id": donor_id},
            )
        if donor_updates:
            assignments = ", ".join(f"{key} = :{key}" for key in donor_updates)
            await session.execute(
                text(
                    f"UPDATE lifelink.donor SET {assignments} "
                    "WHERE donor_id = :donor_id"
                ),
                {**donor_updates, "donor_id": donor_id},
            )
        if address_updates:
            assignments = ", ".join(f"{key} = :{key}" for key in address_updates)
            await session.execute(
                text(
                    f"UPDATE lifelink.address SET {assignments} "
                    "WHERE address_id = :address_id"
                ),
                {**address_updates, "address_id": target["address_id"]},
            )
        if replace_phones:
            await session.execute(DELETE_PHONES_QUERY, {"donor_id": donor_id})
            for phone in payload.phones or []:
                await session.execute(
                    INSERT_PHONE_QUERY,
                    {"donor_id": donor_id, **phone.model_dump()},
                )
        await _audit_donor_change(
            session,
            actor_user_id=actor.user_id,
            donor_id=donor_id,
            action="UPDATE",
            changed_fields=changed_fields,
        )
        await session.commit()
    except IntegrityError as exc:
        raise _integrity_error(exc) from exc

    return await get_donor(session, donor_id)


async def list_donor_donations(
    session: AsyncSession,
    *,
    donor_id: int,
    page: int,
    page_size: int,
    donation_type: DonationType | None,
    record_status: DonationRecordStatus | None,
) -> DonorDonationListResponse:
    if not await donor_exists(session, donor_id):
        raise NotFoundError(
            code="donor_not_found",
            message="The requested donor was not found.",
        )
    filters = ["dn.donor_id = :donor_id"]
    parameters: dict[str, Any] = {"donor_id": donor_id}
    if donation_type is not None:
        filters.append("dn.donation_type = :donation_type")
        parameters["donation_type"] = donation_type.value
    if record_status is not None:
        filters.append("dn.record_status = :record_status")
        parameters["record_status"] = record_status.value
    where_clause = f"WHERE {' AND '.join(filters)}"
    count_result = await session.execute(
        text(f"SELECT COUNT(*) {DONATION_HISTORY_FROM} {where_clause}"),
        parameters,
    )
    total = count_result.scalar_one()
    rows_result = await session.execute(
        text(
            f"""
            SELECT {DONATION_HISTORY_COLUMNS}
            {DONATION_HISTORY_FROM}
            {where_clause}
            ORDER BY dn.donation_date DESC, dn.donation_id DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        {
            **parameters,
            "limit": page_size,
            "offset": (page - 1) * page_size,
        },
    )
    items = [
        DonorDonationResponse.model_validate(row)
        for row in rows_result.mappings().all()
    ]
    return DonorDonationListResponse(
        items=items,
        page=page,
        page_size=page_size,
        total=total,
        total_pages=(total + page_size - 1) // page_size,
    )


async def list_donor_conditions(
    session: AsyncSession,
    *,
    donor_id: int,
    condition_status: DonorConditionStatus | None,
) -> DonorConditionListResponse:
    if not await donor_exists(session, donor_id):
        raise NotFoundError(
            code="donor_not_found",
            message="The requested donor was not found.",
        )
    result = await session.execute(
        CONDITION_HISTORY_QUERY,
        {
            "donor_id": donor_id,
            "condition_status": (
                condition_status.value if condition_status is not None else None
            ),
        },
    )
    items = [
        DonorConditionResponse.model_validate(row) for row in result.mappings().all()
    ]
    return DonorConditionListResponse(items=items, total=len(items))
