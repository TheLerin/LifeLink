# LifeLink — completed scope

This bundle contains every implementation module of the project: the PostgreSQL
database, the FastAPI backend, and the React frontend that consumes it.

## 1. PostgreSQL DBMS implementation — complete

- normalized LifeLink schema and constraints
- fictional sample data and one demo account for each application role
- operational views
- trigger functions and triggers
- transaction-aware stored functions/procedures
- indexes
- PostgreSQL `GRANT`/`REVOKE` role demonstration
- positive, negative, lifecycle, and report test queries
- last-unit `SELECT FOR UPDATE` concurrency demonstration
- blood lifecycle: `COLLECTED -> TESTING -> AVAILABLE -> RESERVED -> ISSUED`
- transparent academic organ-match ranking and audit trail

Files: `database/01_schema.sql` through `database/11_concurrency_demo.sql`.

## 2. FastAPI backend — complete

- FastAPI application foundation and configuration
- PostgreSQL/SQLAlchemy integration
- bcrypt password verification
- JWT access tokens and current-account reload
- application RBAC for ADMIN, DOCTOR, BLOOD_BANK_STAFF,
  ORGAN_BANK_STAFF, DONOR, and RECIPIENT
- ADMIN-only Users API
- Donors API with own-record scope
- recipients, doctors, hospitals, blood banks, and organ banks
- blood and organ donation workflows
- blood-unit screening, lifecycle, and timeline
- emergency requests and atomic FEFO reservation
- reservation cancellation and issue completion
- organ registration, match calculation, ranking, and transitions
- camps and registration
- seven database-backed reports
- ADMIN-only audit API
- stable validation, authorization, conflict, database, and concurrency errors
- 70 OpenAPI operations total
- 153 passing backend tests at the completed backend milestone

Files: `backend/` and `docs/11_security_rbac.md` through
`docs/14_complete_api.md`.

## 3. React frontend — complete

- React 18.3 + Vite 5.4 + Tailwind CSS 3.4 + React Router 6.26 + Recharts 2.12,
  written in plain JSX
- dark navy navigation, light content area, and the approved blood-status colours
- JWT login against `POST /api/auth/login`, session persistence, automatic
  sign-out on any 401, and protected routes
- role-aware navigation and route guards for ADMIN, DOCTOR, BLOOD_BANK_STAFF,
  ORGAN_BANK_STAFF, DONOR, and RECIPIENT, mirroring the backend
  `require_roles(...)` dependencies rather than inventing their own rules
- 27 pages wired to live API data, covering donors, recipients, doctors,
  hospitals, blood banks, organ banks, blood and organ donations, blood-unit
  screening and lifecycle timeline, emergency requests, reservations, organ
  registration and ranking, camps and registrations, reports, audit, and users
- server-side pagination, filtering, and search on every list screen, with the
  filter sets restricted to query parameters the API actually accepts
- create, edit, status-transition, cancel, and issue flows with per-action
  pending states and errors surfaced with the backend `request_id`
- dashboard metrics, blood-inventory chart, expiring-units attention queue, and
  recent-activity table
- all seven database-backed reports with charts derived from the displayed rows
  and CSV export of the raw API response
- academic organ-score disclaimer shown wherever the score appears, with the
  0.50 / 0.30 / 0.20 components displayed as separate columns
- reserve action implemented strictly as `POST /api/emergency-requests/{id}/reserve`
  with no unit picker and no code path that can set `RESERVED`
- offline verification tooling: delimiter-balance check, import-graph check, and
  a static frontend-to-backend API contract check

Files: `frontend/` (58 source files, 12,525 lines: 27 pages, 18 components, 30
declared routes) and `docs/15_frontend.md`.

Verification performed: `npm run check` reports 58 files balanced with every
relative import resolving to a real export; `python3 tools/check_contract.py`
reports 69 declared backend routes against 67 frontend calls with every call
matched, the two unmatched routes being `/health` and `/health/ready`, which the
login screen reaches through a direct `fetch`; all 16 navigation destinations
resolve to declared routes; `python3 -m compileall app` succeeds on the backend.
Each checker was also confirmed to fail on deliberately broken input, so a pass
means something. `npm run build`, ESLint, and `pytest` were not executed in the
authoring sandbox because the npm registry and PyPI were both unreachable there;
run them locally where installs work.

## Quick start

### Backend

Follow `backend/README.md` and the project `.env.example` to configure
PostgreSQL, then start FastAPI from `backend/`.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

The default configuration leaves `VITE_API_BASE_URL` empty so the Vite dev proxy
forwards `/api` to `http://localhost:8000`, keeping requests same-origin. Demo
accounts use the coursework-only password `Demo@123`.

## Important workflow rule

The frontend must not directly set a blood unit to `RESERVED`. It must call
`POST /api/emergency-requests/{id}/reserve` so PostgreSQL remains responsible
for locking, FEFO allocation, reservation creation, and audit history.
