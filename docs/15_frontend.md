# LifeLink frontend

The frontend is a React single-page application that consumes the FastAPI layer
described in [`14_complete_api.md`](14_complete_api.md). It is deliberately a
thin presentation layer: every rule that matters is enforced by PostgreSQL and
re-checked by FastAPI, and the UI's job is to make those rules visible and hard
to violate by accident.

## Stack

React 18.3 with Vite 5.4, Tailwind CSS 3.4, React Router 6.26, Recharts 2.12 and
lucide-react for icons. The source is plain JSX, not TypeScript, matching the
project's stated scope. There is no state-management library and no data-fetching
library: the whole data path is four small hooks in `src/hooks/useApi.js`, which
keeps it readable in a viva without asking anyone to trust a framework.

## Layout of `src`

`api/` holds the transport. `client.js` owns `fetch`, the `/api` prefix, the
bearer token, the error envelope and the 401 handling; `endpoints.js` is a
catalogue where every FastAPI operation appears exactly once, so the entire
backend surface is visible in a single file and a path change touches one line.

`context/` holds `AuthContext` (session, current account, sign-in and sign-out)
and `ToastContext`. `hooks/` holds `useApi`, `usePagedList`, `useMutation` and
`useDebouncedValue`, plus the lookup hooks that back form dropdowns.

`constants/` is the shared vocabulary: enum lists, the status-to-colour map from
the design language, the navigation tree, and the report catalogue.
`components/` holds eighteen presentation primitives, the important ones being
`DataTable`, `FilterBar`, `Modal`, `ConfirmDialog`, `StatusBadge` and the
state helpers in `States.jsx`. `pages/` holds twenty-seven screens.

## How a screen is built

Screens are configuration rather than markup. A table is described by an array
of column objects with an optional `render`, and a filter row by an array of
filter objects naming only query parameters the backend actually accepts. An
unknown query parameter is ignored server-side, which silently misleads the
user, so the filter list is treated as part of the API contract.

List screens call `usePagedList`, which owns page, page size and filters and
refetches when any of them change. Detail screens call `useApi`. Anything that
writes calls `useMutation`, which exposes `pending` so buttons disable
themselves and `error` so the failure is shown where the action was taken,
including the backend's `request_id`.

## Authorisation

Roles are mirrored, never invented. `constants/navigation.js` lists the roles
that may see each destination and `RoleRoute` guards the routes, both matching
the `require_roles(...)` dependencies in `backend/app/routes/operations.py`. The
UI hides what a role cannot do so nobody is offered a button that returns 403,
but hiding is a courtesy, not the control: FastAPI rejects the call and
PostgreSQL rejects the statement regardless of what the browser sends.

One asymmetry is worth knowing because it looks like a bug. Organ-bank staff can
read emergency requests but not reservations, so the reservations panel on the
emergency-request screen is suppressed for that role rather than rendered and
allowed to fail.

## The reservation rule

This is the project's central constraint. The frontend never sets a blood unit
to `RESERVED`. `BLOOD_UNIT_MANUAL_TRANSITIONS` in `constants/lifelink.js`
deliberately has no transition whose target is `RESERVED`, so the manual
status control cannot express it. Reserving is a single call to
`POST /api/emergency-requests/{id}/reserve`, and the reserve dialog asks only for
a hold duration.

There is no unit picker, on purpose. Offering one would move the allocation
decision into the browser. Instead `lifelink.reserve_emergency_blood()` locks the
request row, picks the unit by first-expiry-first-out, inserts the reservation,
flips the unit to `RESERVED`, recomputes the request status and writes the audit
row — all in one transaction that either fully succeeds or leaves nothing behind.
The UI's contribution is to explain this and then stay out of the way.

## The organ ranking

The organ score is presented as the **Academic Priority Score** and never as AI,
machine learning, a medical probability or a transplant-success prediction. It is
a fixed published formula computed by `lifelink.organ_match_priority_view`:

```
final_priority = 0.50 x compatibility + 0.30 x urgency + 0.20 x waiting_time
```

Only compatibility is entered by a person. Urgency is derived from the request
priority and waiting time from days since the request was raised. Every
component is shown as its own column next to the total so the ranking can be
recomputed by hand, and the disclaimer travels with it in `ORGAN_SCORE_NOTE`.
Rejected matches leave the view permanently, which the reject confirmation says
plainly.

## Reports

The seven reports share one definition in `constants/reports.js`, listing each
report's slug, the view or function that produces it, and the roles allowed to
run it. `ReportsPage` renders the catalogue filtered by role and
`ReportDetailPage` renders any single report, selecting its fetcher, columns and
chart from the slug. Charts are aggregated from the same rows shown in the table
so the picture and the numbers cannot disagree, and CSV export writes the raw API
rows so the download matches the database rather than the formatting.

Only the blood-inventory report takes filters, because it is the only one whose
endpoint accepts them; they are passed to `generate_inventory_report()` so
PostgreSQL does the filtering.

## Running it

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Leaving `VITE_API_BASE_URL` empty uses the Vite dev proxy in `vite.config.js`, so
requests are same-origin and no CORS setup is needed. Sign in with the seeded
demo accounts listed on the login screen; they exist only in
`database/03_sample_data.sql` and use fictional people throughout.

## Verification

```bash
cd frontend && npm run check      # syntax + import graph, no node_modules needed
python3 tools/check_contract.py   # frontend calls vs backend routes
```

`scripts/check-syntax.mjs` proves every delimiter in all 58 source files opens
and closes in order. `scripts/check-imports.mjs` proves every relative import
resolves and every named import is actually exported by its target, which is the
class of mistake that otherwise appears at runtime as "Element type is invalid".
`tools/check_contract.py` parses the FastAPI routers with Python's `ast` module
and compares them against `endpoints.js`; it currently reports 69 declared
backend routes against 67 frontend calls, with every call matched. The two
unmatched routes are `/health` and `/health/ready`, which the login screen
reaches through `pingApi()` rather than the `api` helper so it can tell "wrong
password" apart from "backend is not running".

These checks exist because they can run without a network. They are not a
substitute for `npm run build` and `pytest`, both of which need packages
installed first.
