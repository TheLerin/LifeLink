# LifeLink

LifeLink is a PostgreSQL-first college DBMS project for multi-hospital blood
and organ allocation and emergency coordination. The database implements the
normalized schema, constraints, views, triggers, routines, indexes, RBAC demo,
audit trail, and transaction-safe reservation workflow. FastAPI `1.0.0`
exposes the complete database-backed API with JWT authentication and RBAC, and a
React single-page application consumes that API for all six roles.

## Layout

`database/` holds the numbered SQL scripts, which are the authoritative schema.
`backend/` holds the FastAPI application, `frontend/` the React client, `docs/`
the written documentation, and `tools/` the offline contract checker.

## Start

1. Create a PostgreSQL database.
2. Run `database/01_schema.sql` through `database/09_roles_permissions.sql` in
   numeric order as a database owner.
3. Copy `.env.example` to `.env` and set `DATABASE_URL` and `JWT_SECRET`.
4. Install and start the backend:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements-dev.txt
uvicorn app.main:app --app-dir backend --reload
```

Swagger UI is available at `http://localhost:8000/docs`.

5. Start the frontend in a second terminal:

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

The UI is served at `http://localhost:5173`. Leaving `VITE_API_BASE_URL` empty
uses the Vite dev proxy, so API requests are same-origin and no CORS setup is
needed. Sign in with one of the demo accounts shown on the login screen; they are
seeded by `database/03_sample_data.sql`, describe fictional people only, and
share the coursework-only password `Demo@123`.

## Verify

```bash
cd backend
pytest
ruff check app
ruff format --check app
```

```bash
cd frontend
npm run check          # delimiter balance + import graph, runs without node_modules
npm run build
```

```bash
python3 tools/check_contract.py   # every frontend call maps to a real backend route
```

`tools/check_contract.py` reads the FastAPI routers with Python's `ast` module and
compares them against `frontend/src/api/endpoints.js`, so a UI call to a route
that does not exist is caught without starting either process. It currently
reports 69 declared backend routes and 67 frontend calls with every call matched;
`/health` and `/health/ready` are the two unmatched routes because the login
screen reaches them through a direct `fetch` to distinguish a wrong password from
a backend that is not running.

The SQL scripts include their own executable checks and the explicit
two-session concurrency demonstration is documented in
[`docs/10_concurrency_demo.md`](docs/10_concurrency_demo.md).

Backend modules and access rules are documented in
[`docs/14_complete_api.md`](docs/14_complete_api.md) and the frontend
architecture in [`docs/15_frontend.md`](docs/15_frontend.md). The academic donor
and organ rules are demonstration logic only and must not be described as medical
clearance or clinical transplant guidance.

## The rule that shapes the design

The frontend never sets a blood unit to `RESERVED`. It calls
`POST /api/emergency-requests/{id}/reserve`, and `lifelink.reserve_emergency_blood()`
locks the request, selects the unit by first-expiry-first-out, creates the
reservation, flips the unit, recomputes the request status and writes the audit
row in one transaction. The reserve dialog therefore asks only for a hold
duration and offers no unit picker, because choosing the unit in the browser
would move the allocation decision out of the database.

