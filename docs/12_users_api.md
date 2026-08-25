# LifeLink Module 2: ADMIN Users API

This module manages application accounts stored in
`lifelink.user_account`. Every endpoint requires an active JWT-authenticated
`ADMIN` account. PostgreSQL remains authoritative for foreign keys, role
affiliations, subtype validation, uniqueness, and status values.

## Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/users` | List accounts with bounded pagination and filters |
| `POST` | `/api/users` | Create an account with a bcrypt password hash |
| `PATCH` | `/api/users/{user_id}` | Update username, role, affiliation, or password |
| `PATCH` | `/api/users/{user_id}/status` | Set `ACTIVE`, `DISABLED`, or `LOCKED` |

Physical account deletion is intentionally excluded. Operational accounts are
disabled so their references and audit history remain intact.

## List contract

`GET /api/users` accepts:

| Parameter | Rule |
|---|---|
| `page` | Integer greater than or equal to 1; default 1 |
| `page_size` | 1–100; default 20 |
| `role` | One of the six application roles |
| `status` | `ACTIVE`, `DISABLED`, or `LOCKED` |
| `search` | 1–80 characters containing at least one non-space character |

Search checks username, person name, blood-bank name, and organ-bank name.
`%`, `_`, and `\` are escaped so they are treated as literal user input. All
filter values, limits, offsets, IDs, and writes use bound SQL parameters.

## Role-affiliation contract

| Role | Required reference | Forbidden references |
|---|---|---|
| `ADMIN` | None | Blood bank and organ bank |
| `DOCTOR` | Doctor `person_id` | Blood bank and organ bank |
| `DONOR` | Donor `person_id` | Blood bank and organ bank |
| `RECIPIENT` | Recipient `person_id` | Blood bank and organ bank |
| `BLOOD_BANK_STAFF` | `blood_bank_id` | Organ bank; person is not required |
| `ORGAN_BANK_STAFF` | `organ_bank_id` | Blood bank; person is not required |

When changing roles, the client should patch the role and its complete new
affiliation in one request. PostgreSQL rejects incomplete or mismatched
combinations.

## Password and response safety

- New passwords must contain 8–72 UTF-8 bytes.
- The API stores only bcrypt hashes.
- `password_hash` is never selected for lists or current-user responses.
- Passwords and hashes never appear in audit details.
- Password changes are recorded only as `password_reset` in the changed-field
  list.

## Administrative safeguards

Every account mutation follows this order:

1. Take a transaction-scoped PostgreSQL advisory lock for the account policy.
2. Lock and re-check the acting account as an active `ADMIN`.
3. Lock the target account row.
4. Lock active ADMIN rows when demotion or deactivation is involved.
5. Apply the update, write its audit row, and commit atomically.

This prevents simultaneous requests from racing around the active-admin rule.
It also closes the small gap where an administrator could lose authority after
JWT validation while waiting for a database lock.

An administrator cannot:

- demote their own active session;
- disable or lock their own active session; or
- remove the final active ADMIN through a concurrent request.

## Audit events

| Operation | Audit action | Status fields |
|---|---|---|
| Create | `CREATE` | `new_status` |
| General patch | `UPDATE` | Not applicable |
| Status patch | `STATUS_CHANGE` | `old_status` and `new_status` |

The acting user ID is also supplied through transaction-local
`lifelink.app_user_id` for consistent attribution by database routines.

## Main error codes

| HTTP | Code | Meaning |
|---|---|---|
| 401 | `bearer_token_required` | No valid authentication was supplied |
| 403 | `insufficient_role` | The caller is not an ADMIN |
| 403 | `admin_authority_changed` | ADMIN authority changed while the request waited |
| 404 | `user_not_found` | Target account does not exist |
| 409 | `username_already_exists` | Username candidate key conflict |
| 409 | `person_role_account_exists` | Duplicate person-role account |
| 409 | `cannot_demote_self` | Acting ADMIN attempted self-demotion |
| 409 | `cannot_deactivate_self` | Acting ADMIN attempted self-disable or self-lock |
| 409 | `last_active_admin` | Operation would remove the final active ADMIN |
| 422 | `invalid_user_affiliation` | Role/reference combination is invalid |
| 422 | `invalid_user_reference` | Referenced person or bank does not exist |
| 422 | `invalid_user_role_subject` | Person subtype does not match the role |

The module deliberately does not add OAuth, refresh tokens, row-level security,
or account deletion. Those are outside the approved course-project scope.
