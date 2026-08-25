"""Process liveness and PostgreSQL readiness endpoints."""

from fastapi import APIRouter, Depends, Request, status

from app.config.database import DatabaseManager
from app.config.settings import Settings
from app.dependencies.database import get_database
from app.schemas.system import ErrorResponse, HealthResponse, ReadinessResponse
from app.utils.errors import ServiceUnavailableError

router = APIRouter(prefix="/health", tags=["system"])


@router.get(
    "",
    response_model=HealthResponse,
    summary="Check API process liveness",
)
async def health(request: Request) -> HealthResponse:
    """Return process health without depending on PostgreSQL."""

    settings: Settings = request.app.state.settings
    return HealthResponse(
        service=settings.app_name,
        version=settings.app_version,
        environment=settings.app_environment,
    )


@router.get(
    "/ready",
    response_model=ReadinessResponse,
    responses={
        status.HTTP_503_SERVICE_UNAVAILABLE: {
            "model": ErrorResponse,
            "description": "PostgreSQL is unavailable or timed out",
        }
    },
    summary="Check PostgreSQL readiness",
)
async def readiness(
    database: DatabaseManager = Depends(get_database),
) -> ReadinessResponse:
    """Report ready only after a bounded PostgreSQL `SELECT 1` succeeds."""

    if not await database.ping():
        raise ServiceUnavailableError(
            code="database_unavailable",
            message="The database is not ready.",
        )
    return ReadinessResponse()
