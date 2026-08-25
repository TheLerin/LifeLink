# LifeLink frontend

React single-page application for the LifeLink multi-hospital blood and organ
allocation project. It consumes the FastAPI layer and holds no business rules of
its own. The architecture, the role model, and the reasoning behind the
reservation flow are documented in
[`../docs/15_frontend.md`](../docs/15_frontend.md).

## Run

```bash
npm install
cp .env.example .env.local
npm run dev
```

The dev server listens on `http://localhost:5173`. Start the backend first, from
the repository root:

```bash
uvicorn app.main:app --app-dir backend --reload
```

Leaving `VITE_API_BASE_URL` empty makes the Vite dev proxy forward `/api` to
`VITE_API_PROXY_TARGET`, so browser requests are same-origin and no CORS setup is
needed. Set an absolute origin only when serving a production build separately
from the API.

Sign in with any demo account listed on the login screen. They are seeded by
`database/03_sample_data.sql`, describe fictional people only, and share the
coursework-only password `Demo@123`.

## Scripts

```bash
npm run dev            # Vite dev server with the /api proxy
npm run build          # production build into dist/
npm run preview        # serve the production build
npm run check          # delimiter balance + import graph (no node_modules needed)
npm run check:syntax
npm run check:imports
```

`npm run check` is unusual and worth explaining. `check:syntax` proves every
`(`, `[` and `{` in `src/` opens and closes in the right order, which is the
mistake that actually happens when hand-editing large JSX trees.
`check:imports` proves every relative import resolves to a real file and every
named import is actually exported by its target — the class of mistake that
otherwise surfaces at runtime as "Element type is invalid". Both are written in
plain Node with no dependencies, so they run on a clean checkout before
`npm install`. They complement `npm run build`; they do not replace it.

From the repository root, `python3 tools/check_contract.py` compares every call
in `src/api/endpoints.js` against the routes FastAPI actually declares, so a call
to an endpoint that does not exist is caught without starting either process.

## Layout

```
src/
  api/          fetch client, auth token, error envelope, endpoint catalogue
  context/      AuthContext (session, sign-in/out), ToastContext
  hooks/        useApi, usePagedList, useMutation, useDebouncedValue, lookups
  constants/    enums, status colours, navigation tree, report catalogue
  components/   DataTable, FilterBar, Modal, ConfirmDialog, StatusBadge, states
  pages/        one file per screen
```

## The rule this UI is built around

The frontend never sets a blood unit to `RESERVED`. It calls
`POST /api/emergency-requests/{id}/reserve` and lets
`lifelink.reserve_emergency_blood()` lock the request, pick the unit by
first-expiry-first-out, create the reservation, update the unit and request, and
write the audit row in one transaction. `BLOOD_UNIT_MANUAL_TRANSITIONS` in
`src/constants/lifelink.js` deliberately contains no manual transition targeting
`RESERVED`, so the status control cannot express it, and the reserve dialog asks
only for a hold duration rather than offering a unit picker.

The organ ranking is shown as the **Academic Priority Score**, a fixed published
formula (`0.50 x compatibility + 0.30 x urgency + 0.20 x waiting time`) computed
in PostgreSQL. It is coursework demonstration logic and is never presented as AI,
machine learning, a medical probability, or a transplant-success prediction.
