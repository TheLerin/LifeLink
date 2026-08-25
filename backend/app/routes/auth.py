"""Database-backed login and current-account endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.security import create_access_token
from app.config.settings import Settings
from app.dependencies.auth import get_current_user
from app.dependencies.database import get_db_session
from app.schemas.auth import LoginRequest, TokenResponse, UserResponse
from app.schemas.system import ErrorResponse
from app.services.auth_service import authenticate_user

router = APIRouter(prefix="/auth", tags=["authentication"])


@router.post(
    "/login",
    response_model=TokenResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ErrorResponse},
    },
    summary="Sign in with a LifeLink database account",
)
async def login(
    payload: LoginRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> TokenResponse:
    """Verify bcrypt credentials and issue one JWT access token."""

    user = await authenticate_user(
        session,
        username=payload.username,
        password=payload.password.get_secret_value(),
    )
    settings: Settings = request.app.state.settings
    access_token = create_access_token(
        user_id=user.user_id,
        role=user.role,
        settings=settings,
    )
    return TokenResponse(
        access_token=access_token,
        expires_in=settings.access_token_expire_minutes * 60,
        user=user,
    )


@router.get(
    "/me",
    response_model=UserResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ErrorResponse},
    },
    summary="Return the current database account",
)
async def current_account(
    current_user: Annotated[UserResponse, Depends(get_current_user)],
) -> UserResponse:
    """Return the current active account without its password hash."""

    return current_user
