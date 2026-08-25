# LifeLink FastAPI backend

This directory contains the complete verified FastAPI backend for the LifeLink
PostgreSQL project: authentication, RBAC, administration, normalized CRUD,
critical allocation workflows, reports, and audit access.
PostgreSQL remains authoritative for constraints, triggers, stored routines,
locking, account status, and other critical consistency rules.

## Included

- environment-backed, validated application settings;
- an async SQLAlchemy engine using psycopg 3;
- bounded connection pooling and graceful engine disposal;
- transaction-ready `AsyncSession` dependency;
- FastAPI application factory and lifespan management;
- CORS restricted to the configured frontend origin;
- request IDs, request logging, and consistent JSON errors;
- liveness and database-readiness endpoints;
- bcrypt password verification against `lifelink.user_account`;
- signed JWT access tokens with expiration, issuer, and audience checks;
- current-account reload from PostgreSQL on protected requests;
- reusable six-role RBAC dependencies;
- ADMIN-only account listing, creation, updates, password resets, and status
  changes;
- audit attribution and self-lockout/final-admin safeguards;
- normalized donor profile creation and updates across address, person, donor,
  and phone relations;
- role-scoped donor summaries, full-profile ownership checks, donation history,
  condition history, and dynamically derived eligibility facts;
- recipients, doctors, hospitals, banks, donations, blood units, screening,
  emergency requests, reservations, organs, academic matching, and camps;
- database-backed inventory, expiry, emergency, donation, reservation, organ,
  response-time, and audit reports;
- isolated API tests plus full PostgreSQL golden-path validation.

The API blueprint is complete at version `1.0.0`.

## Run locally

Prerequisites: Python 3.11+ and a PostgreSQL database initialized with the
LifeLink SQL scripts.

From the `lifelink` directory:

```bash
cp .env.example .env
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements-dev.txt
uvicorn app.main:app --app-dir backend --reload
```

Set `DATABASE_URL` in `.env` to a PostgreSQL login that can use the `lifelink`
schema. Apply the database scripts before expecting readiness to succeed.
Engine creation does not block application startup; readiness reports HTTP 503
until PostgreSQL accepts `SELECT 1`.

## Current endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Service metadata and useful links |
| `GET` | `/api/health` | Process liveness; does not query PostgreSQL |
| `GET` | `/api/health/ready` | Readiness; runs a bounded PostgreSQL ping |
| `POST` | `/api/auth/login` | Verify a database account and issue a JWT |
| `GET` | `/api/auth/me` | Reload and return the authenticated account |
| `GET` | `/api/users` | ADMIN-only paginated and filtered account list |
| `POST` | `/api/users` | ADMIN-only account creation |
| `PATCH` | `/api/users/{user_id}` | ADMIN-only account/affiliation update or password reset |
| `PATCH` | `/api/users/{user_id}/status` | ADMIN-only activate, disable, or lock operation |
| `GET` | `/api/donors` | Authorized operational donor summaries |
| `POST` | `/api/donors` | ADMIN-only normalized donor creation |
| `GET` | `/api/donors/{donor_id}` | ADMIN or owning donor full profile |
| `PATCH` | `/api/donors/{donor_id}` | ADMIN-only normalized donor update |
| `GET` | `/api/donors/{donor_id}/donations` | Authorized donation history |
| `GET` | `/api/donors/{donor_id}/conditions` | Authorized condition history |
| Various | `/api/recipients`, `/api/doctors`, `/api/hospitals`, `/api/blood-banks`, `/api/organ-banks` | Normalized people and centre APIs |
| Various | `/api/donations`, `/api/blood-units`, `/api/emergency-requests`, `/api/reservations` | Blood donation and emergency allocation workflow |
| Various | `/api/organs`, `/api/organ-matches`, `/api/camps` | Organ and camp workflows |
| `GET` | `/api/reports/*`, `/api/audit` | Role-scoped SQL reports and ADMIN audit history |
| `GET` | `/docs` | Swagger UI |
| `GET` | `/openapi.json` | OpenAPI document |

Every HTTP response includes `X-Request-ID`. A valid caller-supplied request ID
is preserved; otherwise the API creates one. Errors follow this shape:

```json
{
  "error": {
    "code": "database_unavailable",
    "message": "The database is not ready.",
    "details": null,
    "request_id": "4f49113e-b269-420e-b64a-f485464d59cb"
  }
}
```

## Test

```bash
cd backend
pytest
```

The test suite checks authentication, every endpoint contract, RBAC and row
scope, validation, parameter binding, password safety, lifecycle rules,
database-routine calls, concurrency errors, reporting, and audit behavior.

See [`../docs/11_security_rbac.md`](../docs/11_security_rbac.md) for the role
matrix, JWT flow, and fictional development credentials. See
[`../docs/12_users_api.md`](../docs/12_users_api.md) for Module 2.
Module 3 is documented in [`../docs/13_donors_api.md`](../docs/13_donors_api.md).
The completed backend is documented in
[`../docs/14_complete_api.md`](../docs/14_complete_api.md).
