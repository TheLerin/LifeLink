"""Request-scoped access to the application database manager and sessions."""

from collections.abc import AsyncIterator

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.database import DatabaseManager


def get_database(request: Request) -> DatabaseManager:
    """Return the manager owned by the current FastAPI application."""

    return request.app.state.database


async def get_db_session(
    database: DatabaseManager = Depends(get_database),
) -> AsyncIterator[AsyncSession]:
    """Provide one rollback-safe SQLAlchemy session per request."""

    async with database.session() as session:
        yield session
