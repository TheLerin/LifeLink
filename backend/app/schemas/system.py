"""Schemas for service metadata, health, readiness, and errors."""

from typing import Any, Literal

from pydantic import BaseModel, Field


class ServiceInfoResponse(BaseModel):
    name: str
    version: str
    environment: str
    docs_url: str
    health_url: str
    readiness_url: str


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str
    version: str
    environment: str


class ReadinessResponse(BaseModel):
    status: Literal["ready"] = "ready"
    database: Literal["up"] = "up"


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: Any | None = None
    request_id: str | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail = Field(description="Stable machine and human-readable error")
