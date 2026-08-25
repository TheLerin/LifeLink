"""Async PostgreSQL engine, pool lifecycle, and session boundaries."""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config.settings import Settings

logger = logging.getLogger(__name__)


class DatabaseManager:
    """Own the SQLAlchemy engine and its connection pool for one API process."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._engine: AsyncEngine | None = None
        self._session_factory: async_sessionmaker[AsyncSession] | None = None

    @property
    def started(self) -> bool:
        return self._engine is not None

    async def start(self) -> None:
        """Create the async engine without requiring an immediate DB connection."""

        if self._engine is not None:
            return

        self._engine = create_async_engine(
            self._settings.database_url.get_secret_value(),
            echo=self._settings.debug,
            pool_pre_ping=True,
            pool_size=self._settings.db_pool_size,
            max_overflow=self._settings.db_max_overflow,
            pool_timeout=self._settings.db_pool_timeout_seconds,
            pool_recycle=self._settings.db_pool_recycle_seconds,
            connect_args={
                "connect_timeout": self._settings.db_connect_timeout_seconds,
                "options": (
                    "-c search_path=lifelink,public -c application_name=lifelink_api"
                ),
            },
        )
        self._session_factory = async_sessionmaker(
            bind=self._engine,
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
        )
        logger.info("database_engine_started")

    async def stop(self) -> None:
        """Close all pooled connections during application shutdown."""

        engine = self._engine
        self._engine = None
        self._session_factory = None
        if engine is not None:
            await engine.dispose()
            logger.info("database_engine_stopped")

    async def ping(self) -> bool:
        """Run a bounded connection/`SELECT 1` check for readiness."""

        engine = self._engine
        if engine is None:
            return False

        try:
            async with asyncio.timeout(self._settings.db_health_timeout_seconds):
                async with engine.connect() as connection:
                    result = await connection.execute(text("SELECT 1"))
                    return result.scalar_one() == 1
        except Exception:
            logger.warning(
                "database_readiness_check_failed",
                exc_info=self._settings.debug,
            )
            return False

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        """Yield one rollback-safe session for a FastAPI request."""

        if self._session_factory is None:
            raise RuntimeError(
                "DatabaseManager.start() must run before opening a session"
            )

        async with self._session_factory() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise
