# LifeLink Module 3: Donors API

This module implements all six approved donor endpoints using the normalized
`address`, `person`, `donor`, `donor_phone`, `donor_condition`,
`medical_condition`, and `donation` relations.

## Endpoints and access

| Method | Endpoint | Allowed application roles |
|---|---|---|
| `GET` | `/api/donors` | `ADMIN`, `BLOOD_BANK_STAFF`, `ORGAN_BANK_STAFF` |
| `POST` | `/api/donors` | `ADMIN` |
| `GET` | `/api/donors/{donor_id}` | `ADMIN`, owning `DONOR` |
| `PATCH` | `/api/donors/{donor_id}` | `ADMIN` |
| `GET` | `/api/donors/{donor_id}/donations` | `ADMIN`, both bank-staff roles, owning `DONOR` |
| `GET` | `/api/donors/{donor_id}/conditions` | `ADMIN`, `BLOOD_BANK_STAFF`, owning `DONOR` |

Doctors and recipients have no donor-module access. A donor JWT is insufficient
by itself: `user_account.person_id` must equal the path’s `donor_id`. Contact
details are absent from the operational list and available only through the
ADMIN-or-owner detail endpoint.

## Normalized creation

`POST /api/donors` creates these records in one transaction:

1. `address`
2. `person`
3. `donor` using the person’s shared primary key
4. one or more `donor_phone` rows
5. one credential-free `audit_log` row

No donor account is silently created. Account provisioning remains the
ADMIN Users API’s responsibility, preserving clear module boundaries.

The request requires exactly one primary phone. PostgreSQL still enforces its
candidate keys, foreign keys, blood-group domain, weight range, phone format,
and one-primary-phone partial unique index.

## Normalized update

`PATCH /api/donors/{donor_id}` can atomically update:

- person fields: name, birth date, and gender;
- donor fields: weight, blood group, and active state;
- address components;
- the complete phone collection.

The service locks the donor, person, and address rows before comparing and
writing changes. Dynamic SQL contains only fixed server-side column allowlists;
all values and identifiers remain bound parameters. A no-op patch creates no
audit row and performs no commit.

## Read models

The list and detail queries derive rather than store:

- age using PostgreSQL `AGE()`;
- latest active blood-donation date using a correlated lateral aggregate;
- active-condition count;
- simplified eligibility through `eligible_donors_view`.

Eligibility is always labeled:

> Simplified academic rule; not medical clearance

It is never represented as medical approval.

The operational list accepts bounded pagination plus `blood_group`,
`is_active`, `eligible_only`, and literal name search. `%`, `_`, and `\` in
search input are escaped before use with PostgreSQL `ILIKE`.

## History endpoints

Donation history joins the donation supertype to its blood/organ subtype,
collection centre, camp, and unit. It supports pagination plus donation-type
and record-status filters.

Condition history joins `donor_condition` to `medical_condition` and may be
filtered by `ACTIVE`, `MONITORED`, or `RESOLVED`. This endpoint is intentionally
not exposed to organ-bank staff because their approved database role has no
condition-table access.

## Audit and privacy

Donor creation and meaningful updates write one `audit_log` row in the same
transaction. Audit details contain only changed-field names—never names,
addresses, phone numbers, medical-condition values, or credentials.

Physical donor deletion is excluded. Operational donors are deactivated so
donation history and referential integrity remain intact.

## Main error codes

| HTTP | Code | Meaning |
|---|---|---|
| 401 | `bearer_token_required` | Authentication is absent or invalid |
| 403 | `insufficient_role` | Role cannot use the endpoint |
| 403 | `donor_record_forbidden` | Donor account requested another donor’s record |
| 404 | `donor_not_found` | Donor ID does not exist |
| 409 | `duplicate_donor_phone` | Phone candidate key conflict |
| 409 | `multiple_primary_phones` | Partial unique primary-phone rule failed |
| 409 | `donor_unique_conflict` | Another donor uniqueness rule failed |
| 422 | `invalid_donor_reference` | Referenced relation does not exist |
| 422 | `donor_constraint_violation` | PostgreSQL rejected a donor-domain value |
