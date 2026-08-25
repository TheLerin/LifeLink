"""Bearer authentication and reusable application-role guards."""

from collections.abc import Callable, Coroutine
from typing import Annotated, Any

from fastapi import Depends, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.security import (
    AccessTokenExpiredError,
    AccessTokenInvalidError,
    decode_access_token,
)
from app.config.settings import Settings
from app.dependencies.database import get_db_session
from app.schemas.auth import UserResponse, UserRole, UserStatus
from app.services.auth_service import get_user_by_id
from app.utils.errors import ForbiddenError, UnauthorizedError

bearer_scheme = HTTPBearer(
    auto_error=False,
    scheme_name="LifeLinkBearer",
    description="JWT access token returned by POST /api/auth/login",
)


async def get_current_user(
    request: Request,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Security(bearer_scheme),
    ],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> UserResponse:
    """Verify the JWT, then re-check current role/status in PostgreSQL."""

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise UnauthorizedError(
            code="bearer_token_required",
            message="A bearer access token is required.",
        )

    settings: Settings = request.app.state.settings
    try:
        token_identity = decode_access_token(credentials.credentials, settings)
    except AccessTokenExpiredError as exc:
        raise UnauthorizedError(
            code="token_expired",
            message="The access token has expired.",
        ) from exc
    except AccessTokenInvalidError as exc:
        raise UnauthorizedError(
            code="invalid_token",
            message="The access token is invalid.",
        ) from exc

    user = await get_user_by_id(session, token_identity.user_id)
    if user is None:
        raise UnauthorizedError(
            code="invalid_token_subject",
            message="The token account no longer exists.",
        )
    if user.status is UserStatus.DISABLED:
        raise ForbiddenError(
            code="account_disabled",
            message="This account is disabled.",
        )
    if user.status is UserStatus.LOCKED:
        raise ForbiddenError(
            code="account_locked",
            message="This account is locked.",
        )
    if user.role is not token_identity.role:
        raise UnauthorizedError(
            code="stale_token_role",
            message="The account role changed; sign in again.",
        )
    return user


RoleDependency = Callable[..., Coroutine[Any, Any, UserResponse]]


def require_roles(*allowed_roles: UserRole) -> RoleDependency:
    """Create a dependency that permits only the listed application roles."""

    if not allowed_roles:
        raise ValueError("require_roles() needs at least one role")
    allowed = frozenset(allowed_roles)

    async def role_guard(
        current_user: Annotated[UserResponse, Depends(get_current_user)],
    ) -> UserResponse:
        if current_user.role not in allowed:
            raise ForbiddenError(
                code="insufficient_role",
                message="Your role is not permitted to perform this action.",
            )
        return current_user

    return role_guard
