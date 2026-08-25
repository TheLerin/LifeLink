"""Parameterized PostgreSQL access for login and current-user identity."""

from collections.abc import Mapping
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.security import DUMMY_BCRYPT_HASH, verify_password
from app.schemas.auth import UserResponse, UserStatus
from app.utils.errors import ForbiddenError, UnauthorizedError

LOGIN_ACCOUNT_QUERY = text(
    """
    SELECT
        ua.user_id,
        ua.person_id,
        ua.blood_bank_id,
        ua.organ_bank_id,
        ua.username,
        ua.password_hash,
        ua.role,
        ua.status,
        ua.created_at,
        ua.last_login_at,
        p.full_name,
        bb.name AS blood_bank_name,
        ob.name AS organ_bank_name
    FROM lifelink.user_account AS ua
    LEFT JOIN lifelink.person AS p
        ON p.person_id = ua.person_id
    LEFT JOIN lifelink.blood_bank AS bb
        ON bb.blood_bank_id = ua.blood_bank_id
    LEFT JOIN lifelink.organ_bank AS ob
        ON ob.organ_bank_id = ua.organ_bank_id
    WHERE ua.username = :username
    """
)

CURRENT_USER_QUERY = text(
    """
    SELECT
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
    FROM lifelink.user_account AS ua
    LEFT JOIN lifelink.person AS p
        ON p.person_id = ua.person_id
    LEFT JOIN lifelink.blood_bank AS bb
        ON bb.blood_bank_id = ua.blood_bank_id
    LEFT JOIN lifelink.organ_bank AS ob
        ON ob.organ_bank_id = ua.organ_bank_id
    WHERE ua.user_id = :user_id
    """
)

UPDATE_LAST_LOGIN_QUERY = text(
    """
    UPDATE lifelink.user_account
    SET last_login_at = CURRENT_TIMESTAMP
    WHERE user_id = :user_id
    RETURNING last_login_at
    """
)


def user_from_row(row: Mapping[str, Any]) -> UserResponse:
    public_values = dict(row)
    public_values.pop("password_hash", None)
    return UserResponse.model_validate(public_values)


async def authenticate_user(
    session: AsyncSession,
    *,
    username: str,
    password: str,
) -> UserResponse:
    """Verify one account and atomically record its successful login time."""

    result = await session.execute(LOGIN_ACCOUNT_QUERY, {"username": username})
    row = result.mappings().one_or_none()

    candidate_hash = row["password_hash"] if row else DUMMY_BCRYPT_HASH
    password_matches = verify_password(password, candidate_hash)
    if row is None or not password_matches:
        raise UnauthorizedError(
            code="invalid_credentials",
            message="Incorrect username or password.",
        )

    account_status = UserStatus(row["status"])
    if account_status is UserStatus.DISABLED:
        raise ForbiddenError(
            code="account_disabled",
            message="This account is disabled.",
        )
    if account_status is UserStatus.LOCKED:
        raise ForbiddenError(
            code="account_locked",
            message="This account is locked.",
        )

    update_result = await session.execute(
        UPDATE_LAST_LOGIN_QUERY,
        {"user_id": row["user_id"]},
    )
    last_login_at = update_result.scalar_one()
    await session.commit()

    user_values = dict(row)
    user_values["last_login_at"] = last_login_at
    return user_from_row(user_values)


async def get_user_by_id(
    session: AsyncSession,
    user_id: int,
) -> UserResponse | None:
    """Load public account identity without selecting the password hash."""

    result = await session.execute(CURRENT_USER_QUERY, {"user_id": user_id})
    row = result.mappings().one_or_none()
    return user_from_row(row) if row else None
