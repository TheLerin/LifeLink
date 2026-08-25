"""LifeLink FastAPI application factory and ASGI entry point."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config.database import DatabaseManager
from app.config.logging import configure_logging
from app.config.settings import Settings, get_settings
from app.routes.auth import router as auth_router
from app.routes.donors import router as donors_router
from app.routes.health import router as health_router
from app.routes.operations import ALL_OPERATION_ROUTERS
from app.routes.users import router as users_router
from app.schemas.system import ServiceInfoResponse
from app.utils.errors import register_exception_handlers
from app.utils.middleware import register_request_context_middleware

logger = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    database: DatabaseManager | None = None,
) -> FastAPI:
    """Build an independently testable LifeLink ASGI application."""

    active_settings = settings or get_settings()
    active_database = database or DatabaseManager(active_settings)
    configure_logging(active_settings.log_level)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await active_database.start()
        logger.info(
            "application_started name=%s version=%s environment=%s",
            active_settings.app_name,
            active_settings.app_version,
            active_settings.app_environment,
        )
        try:
            yield
        finally:
            await active_database.stop()
            logger.info("application_stopped name=%s", active_settings.app_name)

    application = FastAPI(
        title=active_settings.app_name,
        version=active_settings.app_version,
        debug=active_settings.debug,
        lifespan=lifespan,
        description=(
            "API foundation for the LifeLink multi-hospital blood and organ "
            "allocation database project."
        ),
    )
    application.state.settings = active_settings
    application.state.database = active_database

    register_exception_handlers(application)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=active_settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[active_settings.request_id_header],
    )
    register_request_context_middleware(
        application,
        header_name=active_settings.request_id_header,
    )

    application.include_router(auth_router, prefix=active_settings.api_prefix)
    application.include_router(donors_router, prefix=active_settings.api_prefix)
    application.include_router(health_router, prefix=active_settings.api_prefix)
    application.include_router(users_router, prefix=active_settings.api_prefix)
    for operation_router in ALL_OPERATION_ROUTERS:
        application.include_router(
            operation_router,
            prefix=active_settings.api_prefix,
        )

    @application.get(
        "/",
        response_model=ServiceInfoResponse,
        tags=["system"],
        summary="Describe the API service",
    )
    async def service_info() -> ServiceInfoResponse:
        health_url = f"{active_settings.api_prefix}/health"
        return ServiceInfoResponse(
            name=active_settings.app_name,
            version=active_settings.app_version,
            environment=active_settings.app_environment,
            docs_url=application.docs_url or "/docs",
            health_url=health_url,
            readiness_url=f"{health_url}/ready",
        )

    return application


app = create_app()
