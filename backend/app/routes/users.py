"""ADMIN-only database-backed user-account endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import require_roles
from app.dependencies.database import get_db_session
from app.schemas.auth import UserResponse, UserRole, UserStatus
from app.schemas.system import ErrorResponse
from app.schemas.users import (
    UserCreateRequest,
    UserListResponse,
    UserStatusUpdateRequest,
    UserUpdateRequest,
)
from app.services.users_service import (
    create_user,
    list_users,
    update_user,
    update_user_status,
)

router = APIRouter(prefix="/users", tags=["users"])
admin_only = require_roles(UserRole.ADMIN)


@router.get(
    "",
    response_model=UserListResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ErrorResponse},
    },
    summary="List application accounts",
)
async def get_users(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    admin: Annotated[UserResponse, Depends(admin_only)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    role: UserRole | None = None,
    account_status: Annotated[UserStatus | None, Query(alias="status")] = None,
    search: Annotated[
        str | None,
        Query(min_length=1, max_length=80, pattern=r"^.*\S.*$"),
    ] = None,
) -> UserListResponse:
    """Return a bounded page with optional role, status, and text filters."""

    del admin  # authorization is the purpose of this dependency
    return await list_users(
        session,
        page=page,
        page_size=page_size,
        role=role,
        account_status=account_status,
        search=search,
    )


@router.post(
    "",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
        status.HTTP_409_CONFLICT: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ErrorResponse},
    },
    summary="Create an application account",
)
async def post_user(
    payload: UserCreateRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    admin: Annotated[UserResponse, Depends(admin_only)],
) -> UserResponse:
    """Hash the password and create one DB-constrained account."""

    return await create_user(session, actor=admin, payload=payload)


@router.patch(
    "/{user_id}",
    response_model=UserResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
        status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
        status.HTTP_409_CONFLICT: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ErrorResponse},
    },
    summary="Update selected account fields",
)
async def patch_user(
    user_id: Annotated[int, Path(gt=0)],
    payload: UserUpdateRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    admin: Annotated[UserResponse, Depends(admin_only)],
) -> UserResponse:
    """Patch identity/affiliation fields or reset a password."""

    return await update_user(
        session,
        actor=admin,
        user_id=user_id,
        payload=payload,
    )


@router.patch(
    "/{user_id}/status",
    response_model=UserResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
        status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
        status.HTTP_409_CONFLICT: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ErrorResponse},
    },
    summary="Change account status",
)
async def patch_user_status(
    user_id: Annotated[int, Path(gt=0)],
    payload: UserStatusUpdateRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    admin: Annotated[UserResponse, Depends(admin_only)],
) -> UserResponse:
    """Activate, disable, or lock an account with admin safety checks."""

    return await update_user_status(
        session,
        actor=admin,
        user_id=user_id,
        payload=payload,
    )
