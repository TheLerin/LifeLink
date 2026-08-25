# LifeLink authentication and application RBAC

This document covers API Module 1. PostgreSQL remains authoritative for account
records and constraints, while FastAPI enforces application authentication,
role permissions, and later own-record scope.

## Implemented endpoints

| Method | Endpoint | Access | Result |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Verifies username/bcrypt password and returns one JWT access token |
| `GET` | `/api/auth/me` | Bearer token | Reloads the current account from PostgreSQL without selecting its password hash |

The login body is JSON:

```json
{
  "username": "blood.central",
  "password": "Demo@123"
}
```

## Security flow

1. FastAPI queries `lifelink.user_account` using a bound `:username` parameter.
2. bcrypt verifies the submitted password. Missing and incorrect accounts return
   the same `invalid_credentials` response.
3. `DISABLED` and `LOCKED` accounts cannot receive tokens.
4. A successful login updates `last_login_at` and commits that change.
5. The signed token contains `sub` (user ID), `role`, `iat`, `exp`, `iss`,
   `aud`, `jti`, and `type=access`.
6. Every protected request verifies the signature and required claims, then
   reloads the account from PostgreSQL.
7. A deleted, disabled, locked, or role-changed account is rejected immediately,
   even if its old JWT has not yet expired.

JWTs are identity assertions, not the final source of account status. This is
why `/api/auth/me` and the reusable role guards consult the database.

## Application roles

| Role | Intended module access |
|---|---|
| `ADMIN` | Users, reference data, centres, reports, audit, administration |
| `DOCTOR` | Authorized recipients, medical information, emergency requests |
| `BLOOD_BANK_STAFF` | Blood donations, screening, units, reservations, issue, inventory |
| `ORGAN_BANK_STAFF` | Organ donations, units, matching, match status |
| `DONOR` | Own profile and donation history only |
| `RECIPIENT` | Own profile and request status only |

Later routers use `require_roles(...)`. Donor and recipient row ownership must
also be expressed in their parameterized queries; a matching role alone is not
sufficient.

The PostgreSQL roles in `09_roles_permissions.sql` remain the DBMS-course
coarse-grained GRANT/REVOKE demonstration. They do not replace FastAPI own-row
checks.

## Development-only demo accounts

The fictional seed has one shared development password: `Demo@123`.

| Username | Role |
|---|---|
| `admin.demo` | `ADMIN` |
| `doctor.maya` | `DOCTOR` |
| `blood.central` | `BLOOD_BANK_STAFF` |
| `organ.hopebridge` | `ORGAN_BANK_STAFF` |
| `donor.ananya` | `DONOR` |
| `recipient.isha` | `RECIPIENT` |

Additional seeded staff accounts use the same fictional demo password. These
credentials are strictly for local coursework and must not be reused in a real
deployment.

## Configuration

Set `JWT_SECRET` to a unique random value. Staging and production settings
reject the documented placeholder and secrets shorter than 32 UTF-8 bytes.
`JWT_ALGORITHM` is fixed to `HS256` and the default access-token lifetime is 120
minutes, matching the approved blueprint.

This course-level design intentionally has no refresh tokens, SSO, OAuth
providers, password-reset email flow, or token revocation service.
