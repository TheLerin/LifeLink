# LifeLink React UI Shell

This is the completed role-aware frontend shell for the LifeLink DBMS project.
It uses React 19, Vite/Vinext, TypeScript, Tailwind CSS 4, and Lucide icons.

## Included

- JWT login integration with `POST /api/auth/login`
- Explicit fictional seed-data preview when the API is not running
- session persistence and protected routes
- role-aware navigation for all six application roles
- responsive navy/red healthcare operations layout
- command-centre dashboard, inventory chart, attention queue, activity table
- tailored module shells for donors, recipients, donations, blood units,
  emergency requests, reservations, organ matching, centres, camps, reports,
  audit, and ADMIN-only users
- approved blood-unit status colours and academic organ-matching disclaimer
- keyboard-friendly controls, accessible labels, and reduced-motion support

## Run locally

Requirements: Node.js `>=22.13.0`.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `NEXT_PUBLIC_API_BASE_URL` to the running FastAPI origin. The default is
`http://localhost:8000`.

## Development demo accounts

All accounts below use the fictional coursework-only password `Demo@123`.

| Username | Role |
| --- | --- |
| `admin.demo` | ADMIN |
| `doctor.maya` | DOCTOR |
| `blood.central` | BLOOD_BANK_STAFF |
| `organ.hopebridge` | ORGAN_BANK_STAFF |
| `donor.ananya` | DONOR |
| `recipient.isha` | RECIPIENT |

Use **Explore as …** on the login page to review the UI without a running API.
Preview content is clearly labelled fictional seed data and does not execute
mutating operations.

## Validation

```bash
npm run lint
npm test
```

The production build emits the verified Sites-compatible worker artifact.

## Integration rule

Blood units must never be set directly to `RESERVED` by the frontend. The
connected workflow must call `POST /api/emergency-requests/{id}/reserve`, which
keeps FEFO allocation and locking database-authoritative.
