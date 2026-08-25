"""Behavioral checks for the Phase 15 FastAPI foundation."""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config.settings import Settings
from app.main import create_app
from app.tests.conftest import FakeDatabaseManager


def test_application_lifespan_starts_and_stops_database(
    settings: Settings,
    fake_database: FakeDatabaseManager,
) -> None:
    application = create_app(settings=settings, database=fake_database)  # type: ignore[arg-type]

    with TestClient(application) as client:
        assert client.get("/").status_code == 200
        assert fake_database.start_calls == 1
        assert fake_database.stop_calls == 0

    assert fake_database.stop_calls == 1


def test_service_info_uses_configured_api_paths(client: TestClient) -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert response.json() == {
        "name": "LifeLink API",
        "version": "1.0.0",
        "environment": "test",
        "docs_url": "/docs",
        "health_url": "/api/health",
        "readiness_url": "/api/health/ready",
    }


def test_liveness_does_not_query_database(
    client: TestClient,
    fake_database: FakeDatabaseManager,
) -> None:
    fake_database.available = False

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert fake_database.ping_calls == 0


def test_readiness_succeeds_after_database_ping(
    client: TestClient,
    fake_database: FakeDatabaseManager,
) -> None:
    response = client.get("/api/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready", "database": "up"}
    assert fake_database.ping_calls == 1


def test_readiness_failure_is_structured_and_does_not_leak_details(
    client: TestClient,
    fake_database: FakeDatabaseManager,
) -> None:
    fake_database.available = False

    response = client.get("/api/health/ready")

    assert response.status_code == 503
    assert response.json() == {
        "error": {
            "code": "database_unavailable",
            "message": "The database is not ready.",
            "details": None,
            "request_id": response.headers["X-Request-ID"],
        }
    }


def test_valid_incoming_request_id_is_preserved(client: TestClient) -> None:
    response = client.get(
        "/api/health",
        headers={"X-Request-ID": "demo-request-42"},
    )

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "demo-request-42"


def test_invalid_incoming_request_id_is_replaced(client: TestClient) -> None:
    response = client.get(
        "/api/health",
        headers={"X-Request-ID": "contains spaces and control-like text"},
    )

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] != "contains spaces and control-like text"


def test_unknown_route_uses_error_contract(client: TestClient) -> None:
    response = client.get("/api/not-a-route")

    assert response.status_code == 404
    assert response.json() == {
        "error": {
            "code": "not_found",
            "message": "Not Found",
            "details": None,
            "request_id": response.headers["X-Request-ID"],
        }
    }


def test_cors_allows_only_configured_frontend_origin(client: TestClient) -> None:
    response = client.options(
        "/api/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_cors_rejects_unconfigured_origin(client: TestClient) -> None:
    response = client.options(
        "/api/health",
        headers={
            "Origin": "https://untrusted.example",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_settings_require_psycopg_sqlalchemy_url() -> None:
    with pytest.raises(ValidationError, match="postgresql\\+psycopg"):
        Settings(
            _env_file=None,
            database_url="postgresql://user:password@localhost/lifelink",
        )


def test_settings_require_origin_without_path() -> None:
    with pytest.raises(ValidationError, match="must not contain a path"):
        Settings(
            _env_file=None,
            frontend_origin="http://localhost:5173/app",
        )
