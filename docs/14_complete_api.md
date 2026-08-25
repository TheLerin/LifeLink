# LifeLink Complete Database-Backed API

Version `1.0.0` completes the backend API defined in the approved blueprint.
The service exposes 70 operations in total: system health, authentication,
users, donors, and 55 remaining operational endpoints.

## Endpoint and role matrix

| Module | Endpoints | Application access |
|---|---|---|
| Recipients | `GET/POST /api/recipients`, `GET/PATCH /api/recipients/{id}`, `GET /api/recipients/{id}/requests` | ADMIN creates/updates; operational staff and doctors read; RECIPIENT reads only its own record and requests |
| Doctors | `GET/POST /api/doctors`, `GET/PATCH /api/doctors/{id}` | ADMIN manages/lists; DOCTOR reads only its own full profile |
| Hospitals | `GET/POST /api/hospitals`, `GET /api/hospitals/{id}` | Every authenticated role reads; ADMIN creates |
| Blood banks | `GET/POST /api/blood-banks`, `GET /api/blood-banks/{id}` | Every authenticated role reads; ADMIN creates |
| Organ banks | `GET/POST /api/organ-banks`, `GET /api/organ-banks/{id}` | Every authenticated role reads; ADMIN creates |
| Donations | `POST /api/donations/blood`, `POST /api/donations/organ`, `GET /api/donations`, `GET /api/donations/{id}` | Bank staff operate only their workflow/bank; ADMIN operates all; DONOR reads only its history |
| Blood units | `GET /api/blood-units`, `GET /api/blood-units/{id}`, `PATCH /api/blood-units/{id}/status`, `GET /api/blood-units/{id}/timeline` | ADMIN/BLOOD_BANK_STAFF only; staff rows are scoped to their bank |
| Screening | `POST/GET /api/donations/{id}/tests` | ADMIN and the appropriate bank staff; bank affiliation is checked |
| Emergency requests | `GET/POST /api/emergency-requests`, `GET/PATCH /api/emergency-requests/{id}` | DOCTOR creates/tracks hospital requests; ADMIN manages; staff read their workflow; RECIPIENT reads only its requests |
| Reservations | `POST /api/emergency-requests/{id}/reserve`, `GET /api/reservations`, `GET /api/reservations/{id}`, `POST /api/reservations/{id}/cancel`, `POST /api/reservations/{id}/issue` | ADMIN/BLOOD_BANK_STAFF reserve and transition; DOCTOR/RECIPIENT have scoped reads |
| Organs | `GET/POST /api/organs`, `GET /api/organs/{id}` | ADMIN/ORGAN_BANK_STAFF only; staff rows are scoped to their bank |
| Organ matches | `POST /api/organs/{id}/calculate-matches`, `GET /api/organs/{id}/matches`, `PATCH /api/organ-matches/{id}/status` | ADMIN/ORGAN_BANK_STAFF calculate, read, and transition academic matches |
| Camps | `GET/POST /api/camps`, `GET /api/camps/{id}`, `POST /api/camps/{id}/register` | Every role reads; ADMIN creates; ADMIN/BLOOD_BANK_STAFF/DONOR register, with donor self-scope |
| Reports | Seven endpoints under `/api/reports` | ADMIN; blood reports also allow scoped BLOOD_BANK_STAFF, organ ranking allows ORGAN_BANK_STAFF |
| Audit | `GET /api/audit` | ADMIN only |

All routes reload the current account from PostgreSQL after JWT verification.
Role checks happen before service execution, and person/bank ownership is
applied through bound SQL parameters.

## Database-authoritative workflows

### Blood donation and screening

`POST /api/donations/blood` invokes PostgreSQL `register_donation(...)`. The
function atomically creates the donation supertype, blood subtype, and one
traceable `COLLECTED` unit. Staff then move it to `TESTING`, add academic test
results, and may move it to `AVAILABLE` only when database triggers accept the
screening and lifecycle state.

The general status endpoint refuses direct `RESERVED` input. Reservation must
go through the emergency endpoint.

### Emergency reservation

`POST /api/emergency-requests/{id}/reserve` invokes
`reserve_emergency_blood(...)`. PostgreSQL locks the request and FEFO unit,
creates one ACTIVE reservation, moves the unit to `RESERVED`, updates request
progress, and audits the change in one transaction. The partial unique index
on ACTIVE reservations prevents double allocation independently of FastAPI.

Cancellation transitions the reservation before releasing its unit. Issue
completion transitions the reservation before `RESERVED -> ISSUED`, matching
the database trigger requirements.

### Academic organ matching

Organ registration also uses `register_donation(...)`. Candidate calculation
uses `calculate_organ_match(...)`, and the API exposes compatibility, urgency,
waiting-time, final score, and rank separately.

The displayed value is an **Academic Priority Score; not clinical transplant
guidance**. It is not AI, medical probability, or a transplant recommendation.

## Reports

The API includes:

- `/api/reports/blood-inventory`
- `/api/reports/expiring-units`
- `/api/reports/emergency-summary`
- `/api/reports/donation-trends`
- `/api/reports/reservations`
- `/api/reports/organ-matches`
- `/api/reports/hospital-response-time`

These use PostgreSQL functions, views, joins, aggregates, date arithmetic, and
unit-level rows. No report is hard-coded and no quantity-only inventory table
is introduced.

## Error and privacy contract

Validation, missing records, authorization failures, conflicts, PostgreSQL
constraints, and concurrency failures use stable JSON error codes. Password
hashes are absent from every request, response, report, and OpenAPI schema.
Audit metadata records identifiers and changed-field names without copying
names, addresses, phone numbers, credentials, or medical values.

## Verified golden path

The release validation builds database scripts `01` through `08`, then runs
and rolls back this complete flow:

1. normalized donor and recipient creation;
2. blood donation and individual unit creation;
3. `COLLECTED -> TESTING -> AVAILABLE` after PASS screening;
4. CRITICAL emergency request;
5. atomic FEFO reservation;
6. attempted duplicate ACTIVE reservation rejection;
7. reservation completion and `RESERVED -> ISSUED`;
8. organ donation, transparent match calculation, selection, and completion;
9. inventory, expiry, organ-ranking, and audit reports;
10. transaction rollback restoring the original seed state.
