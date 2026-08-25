"""Isolated application fixtures that do not need a live PostgreSQL server."""

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config.settings import Settings
from app.main import create_app


class FakeDatabaseManager:
    """Minimal lifecycle/readiness double used by foundation endpoint tests."""

    def __init__(self) -> None:
        self.available = True
        self.start_calls = 0
        self.stop_calls = 0
        self.ping_calls = 0

    async def start(self) -> None:
        self.start_calls += 1

    async def stop(self) -> None:
        self.stop_calls += 1

    async def ping(self) -> bool:
        self.ping_calls += 1
        return self.available


@pytest.fixture
def settings() -> Settings:
    return Settings(
        _env_file=None,
        app_environment="test",
        database_url="postgresql+psycopg://test:test@localhost/lifelink_test",
        frontend_origin="http://localhost:5173",
    )


@pytest.fixture
def fake_database() -> FakeDatabaseManager:
    return FakeDatabaseManager()


@pytest.fixture
def application(
    settings: Settings,
    fake_database: FakeDatabaseManager,
) -> FastAPI:
    return create_app(settings=settings, database=fake_database)  # type: ignore[arg-type]


@pytest.fixture
def client(application: FastAPI) -> Iterator[TestClient]:
    with TestClient(application) as test_client:
        yield test_client
