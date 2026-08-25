"""ADMIN user-account listing and mutation through parameterized PostgreSQL SQL."""

import json
from collections.abc import Mapping
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.security import hash_password
from app.schemas.auth import UserResponse, UserRole, UserStatus
from app.schemas.users import (
    UserCreateRequest,
    UserListResponse,
    UserStatusUpdateRequest,
    UserUpdateRequest,
)
from app.services.auth_service import get_user_by_id, user_from_row
from app.utils.errors import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    UnprocessableError,
)

USER_SELECT_COLUMNS = """
    ua.user_id,
    ua.person_id,
    ua.blood_bank_id,
    ua.organ_bank_id,
    ua.username,
    ua.role,
    ua.status,
    ua.created_at,
    ua.last_login_at,
    p.full_name,
    bb.name AS blood_bank_name,
    ob.name AS organ_bank_name
"""

USER_FROM_JOINS = """
    FROM lifelink.user_account AS ua
    LEFT JOIN lifelink.person AS p
        ON p.person_id = ua.person_id
    LEFT JOIN lifelink.blood_bank AS bb
        ON bb.blood_bank_id = ua.blood_bank_id
    LEFT JOIN lifelink.organ_bank AS ob
        ON ob.organ_bank_id = ua.organ_bank_id
"""

LOCK_USER_QUERY = text(
    f"""
    SELECT {USER_SELECT_COLUMNS}
    {USER_FROM_JOINS}
    WHERE ua.user_id = :user_id
    FOR UPDATE OF ua
    """
)

LOCK_ACTIVE_ADMINS_QUERY = text(
    """
    SELECT user_id
    FROM lifelink.user_account
    WHERE role = 'ADMIN'
      AND status = 'ACTIVE'
    ORDER BY user_id
    FOR UPDATE
    """
)

LOCK_USER_POLICY_QUERY = text(
    """
    SELECT pg_advisory_xact_lock(
        hashtextextended('lifelink.user_account.policy', 0)
    )
    """
)

LOCK_ADMIN_ACTOR_QUERY = text(
    """
    SELECT role, status
    FROM lifelink.user_account
    WHERE user_id = :actor_user_id
    FOR UPDATE
    """
)

INSERT_USER_QUERY = text(
    """
    INSERT INTO lifelink.user_account (
        person_id,
        blood_bank_id,
        organ_bank_id,
        username,
        password_hash,
        role,
        status
    )
    VALUES (
        :person_id,
        :blood_bank_id,
        :organ_bank_id,
        :username,
        :password_hash,
        :role,
        :status
    )
    RETURNING user_id
    """
)

UPDATE_USER_STATUS_QUERY = text(
    """
    UPDATE lifelink.user_account
    SET status = :status
    WHERE user_id = :user_id
    RETURNING user_id
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
        user_id,
        table_name,
        record_id,
        action,
        old_status,
        new_status,
        details
    )
    VALUES (
        :actor_user_id,
        'user_account',
        :record_id,
        :action,
        :old_status,
        :new_status,
        :details
    )
    """
)


def _integrity_error(exc: IntegrityError) -> Exception:
    diagnostic = getattr(exc.orig, "diag", None)
    constraint = getattr(diagnostic, "constraint_name", None)
    sqlstate = getattr(exc.orig, "sqlstate", None)

    if constraint == "uq_user_account_username":
        return ConflictError(
            code="username_already_exists",
            message="That username is already assigned.",
        )
    if constraint == "uq_user_account_person_role":
        return ConflictError(
            code="person_role_account_exists",
            message="That person already has an account for this role.",
        )
    if constraint == "ck_user_account_affiliation":
        return UnprocessableError(
            code="invalid_user_affiliation",
            message="The selected role and person/bank affiliation do not match.",
        )
    if constraint == "ck_user_account_username":
        return UnprocessableError(
            code="invalid_username",
            message="The username does not satisfy the database format.",
        )
    if sqlstate == "23503":
        return UnprocessableError(
            code="invalid_user_reference",
            message="A referenced person or bank does not exist.",
        )
    if sqlstate == "23514":
        return UnprocessableError(
            code="invalid_user_role_subject",
            message="The role does not match the referenced person or affiliation.",
        )
    return UnprocessableError(
        code="user_constraint_violation",
        message="The account change violates a database constraint.",
    )


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def _set_actor(session: AsyncSession, actor_user_id: int) -> None:
    await session.execute(
        SET_ACTOR_QUERY,
        {"actor_user_id": str(actor_user_id)},
    )


async def _audit_user_change(
    session: AsyncSession,
    *,
    actor_user_id: int,
    target_user_id: int,
    action: str,
    details: Mapping[str, Any],
    old_status: UserStatus | None = None,
    new_status: UserStatus | None = None,
) -> None:
    await session.execute(
        INSERT_AUDIT_QUERY,
        {
            "actor_user_id": actor_user_id,
            "record_id": str(target_user_id),
            "action": action,
            "old_status": old_status.value if old_status else None,
            "new_status": new_status.value if new_status else None,
            "details": json.dumps(details, sort_keys=True, separators=(",", ":")),
        },
    )


async def _lock_user(session: AsyncSession, user_id: int) -> UserResponse:
    result = await session.execute(LOCK_USER_QUERY, {"user_id": user_id})
    row = result.mappings().one_or_none()
    if row is None:
        raise NotFoundError(
            code="user_not_found",
            message="The requested user account was not found.",
        )
    return user_from_row(row)


async def _lock_user_policy(session: AsyncSession) -> None:
    """Serialize API account mutations before taking individual row locks."""

    await session.execute(LOCK_USER_POLICY_QUERY, {})


async def _lock_admin_actor(session: AsyncSession, actor_user_id: int) -> None:
    """Re-check ADMIN authority after waiting for the mutation policy lock."""

    result = await session.execute(
        LOCK_ADMIN_ACTOR_QUERY,
        {"actor_user_id": actor_user_id},
    )
    row = result.mappings().one_or_none()
    if row is None or row["role"] != UserRole.ADMIN.value:
        raise ForbiddenError(
            code="admin_authority_changed",
            message="Administrator permissions changed; sign in again.",
        )
    if row["status"] != UserStatus.ACTIVE.value:
        raise ForbiddenError(
            code="admin_authority_changed",
            message="The administrator account is no longer active.",
        )


async def _protect_last_active_admin(session: AsyncSession) -> None:
    result = await session.execute(LOCK_ACTIVE_ADMINS_QUERY, {})
    active_admins = result.mappings().all()
    if len(active_admins) <= 1:
        raise ConflictError(
            code="last_active_admin",
            message="The final active ADMIN account cannot be disabled or demoted.",
        )


async def list_users(
    session: AsyncSession,
    *,
    page: int,
    page_size: int,
    role: UserRole | None,
    account_status: UserStatus | None,
    search: str | None,
) -> UserListResponse:
    """Return a deterministic filtered page without selecting password hashes."""

    filters: list[str] = []
    parameters: dict[str, Any] = {}
    if role is not None:
        filters.append("ua.role = :role")
        parameters["role"] = role.value
    if account_status is not None:
        filters.append("ua.status = :status")
        parameters["status"] = account_status.value
    if search:
        filters.append(
            "("
            "ua.username ILIKE :search ESCAPE E'\\\\' OR "
            "p.full_name ILIKE :search ESCAPE E'\\\\' OR "
            "bb.name ILIKE :search ESCAPE E'\\\\' OR "
            "ob.name ILIKE :search ESCAPE E'\\\\'"
            ")"
        )
        parameters["search"] = f"%{_escape_like(search.strip())}%"

    where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""
    count_query = text(
        f"""
        SELECT COUNT(*)
        {USER_FROM_JOINS}
        {where_clause}
        """
    )
    rows_query = text(
        f"""
        SELECT {USER_SELECT_COLUMNS}
        {USER_FROM_JOINS}
        {where_clause}
        ORDER BY ua.username, ua.user_id
        LIMIT :limit OFFSET :offset
        """
    )

    total_result = await session.execute(count_query, parameters)
    total = total_result.scalar_one()
    page_parameters = {
        **parameters,
        "limit": page_size,
        "offset": (page - 1) * page_size,
    }
    rows_result = await session.execute(rows_query, page_parameters)
    items = [user_from_row(row) for row in rows_result.mappings().all()]
    return UserListResponse(
        items=items,
        page=page,
        page_size=page_size,
        total=total,
        total_pages=(total + page_size - 1) // page_size,
    )


async def create_user(
    session: AsyncSession,
    *,
    actor: UserResponse,
    payload: UserCreateRequest,
) -> UserResponse:
    """Create an account and its administrative audit row in one transaction."""

    password_hash = hash_password(payload.password.get_secret_value())
    await _lock_user_policy(session)
    await _lock_admin_actor(session, actor.user_id)
    try:
        await _set_actor(session, actor.user_id)
        result = await session.execute(
            INSERT_USER_QUERY,
            {
                "person_id": payload.person_id,
                "blood_bank_id": payload.blood_bank_id,
                "organ_bank_id": payload.organ_bank_id,
                "username": payload.username,
                "password_hash": password_hash,
                "role": payload.role.value,
                "status": payload.status.value,
            },
        )
        user_id = result.scalar_one()
        await _audit_user_change(
            session,
            actor_user_id=actor.user_id,
            target_user_id=user_id,
            action="CREATE",
            new_status=payload.status,
            details={"role": payload.role.value, "username": payload.username},
        )
        await session.commit()
    except IntegrityError as exc:
        raise _integrity_error(exc) from exc

    created = await get_user_by_id(session, user_id)
    if created is None:  # defensive: INSERT ... RETURNING already proved existence
        raise NotFoundError(
            code="user_not_found",
            message="Created user was not found.",
        )
    return created


async def update_user(
    session: AsyncSession,
    *,
    actor: UserResponse,
    user_id: int,
    payload: UserUpdateRequest,
) -> UserResponse:
    """Patch selected account fields while preserving DB relationship checks."""

    password_hash = (
        hash_password(payload.new_password.get_secret_value())
        if "new_password" in payload.model_fields_set
        else None
    )
    await _lock_user_policy(session)
    await _lock_admin_actor(session, actor.user_id)
    target = await _lock_user(session, user_id)
    updates: dict[str, Any] = {}
    changed_fields: list[str] = []

    direct_fields = ("username", "person_id", "blood_bank_id", "organ_bank_id")
    for field_name in direct_fields:
        if field_name not in payload.model_fields_set:
            continue
        value = getattr(payload, field_name)
        if value != getattr(target, field_name):
            updates[field_name] = value
            changed_fields.append(field_name)

    if "role" in payload.model_fields_set and payload.role is not target.role:
        if actor.user_id == user_id and payload.role is not UserRole.ADMIN:
            raise ConflictError(
                code="cannot_demote_self",
                message="An ADMIN cannot demote their own active session.",
            )
        if target.role is UserRole.ADMIN and target.status is UserStatus.ACTIVE:
            await _protect_last_active_admin(session)
        updates["role"] = payload.role.value
        changed_fields.append("role")

    if "new_password" in payload.model_fields_set:
        updates["password_hash"] = password_hash
        changed_fields.append("password_reset")

    if not updates:
        return target

    assignments = ", ".join(f"{column} = :{column}" for column in updates)
    update_query = text(
        f"""
        UPDATE lifelink.user_account
        SET {assignments}
        WHERE user_id = :user_id
        RETURNING user_id
        """
    )
    try:
        await _set_actor(session, actor.user_id)
        await session.execute(update_query, {**updates, "user_id": user_id})
        await _audit_user_change(
            session,
            actor_user_id=actor.user_id,
            target_user_id=user_id,
            action="UPDATE",
            details={"changed_fields": sorted(changed_fields)},
        )
        await session.commit()
    except IntegrityError as exc:
        raise _integrity_error(exc) from exc

    updated = await get_user_by_id(session, user_id)
    if updated is None:
        raise NotFoundError(
            code="user_not_found",
            message="Updated user was not found.",
        )
    return updated


async def update_user_status(
    session: AsyncSession,
    *,
    actor: UserResponse,
    user_id: int,
    payload: UserStatusUpdateRequest,
) -> UserResponse:
    """Change account status with self-lockout and last-admin protection."""

    await _lock_user_policy(session)
    await _lock_admin_actor(session, actor.user_id)
    target = await _lock_user(session, user_id)
    if target.status is payload.status:
        return target
    if actor.user_id == user_id and payload.status is not UserStatus.ACTIVE:
        raise ConflictError(
            code="cannot_deactivate_self",
            message="An ADMIN cannot disable or lock their own active session.",
        )
    if target.role is UserRole.ADMIN and target.status is UserStatus.ACTIVE:
        await _protect_last_active_admin(session)

    try:
        await _set_actor(session, actor.user_id)
        await session.execute(
            UPDATE_USER_STATUS_QUERY,
            {"status": payload.status.value, "user_id": user_id},
        )
        await _audit_user_change(
            session,
            actor_user_id=actor.user_id,
            target_user_id=user_id,
            action="STATUS_CHANGE",
            old_status=target.status,
            new_status=payload.status,
            details={"changed_fields": ["status"]},
        )
        await session.commit()
    except IntegrityError as exc:
        raise _integrity_error(exc) from exc

    updated = await get_user_by_id(session, user_id)
    if updated is None:
        raise NotFoundError(
            code="user_not_found",
            message="Updated user was not found.",
        )
    return updated
