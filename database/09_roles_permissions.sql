/*
 * LifeLink — Multi-Hospital Blood and Organ Allocation System
 * Phase 12: PostgreSQL roles and GRANT/REVOKE demonstration
 *
 * Run after 01_schema.sql through 08_indexes.sql.
 * Run this file as the database owner or a PostgreSQL administrator that can:
 *   - CREATE/ALTER ROLE;
 *   - grant privileges on every object in schema lifelink.
 *
 * This file creates six NOLOGIN group roles matching the application roles:
 *
 *   lifelink_admin
 *   lifelink_doctor
 *   lifelink_blood_bank_staff
 *   lifelink_organ_bank_staff
 *   lifelink_donor
 *   lifelink_recipient
 *
 * Important security boundary
 * --------------------------------------------------------------------------
 * PostgreSQL roles in this file are a DBMS-course demonstration of coarse,
 * object-level RBAC. FastAPI/JWT will later enforce row scope such as:
 *   - a DONOR sees only their own profile and donations;
 *   - a RECIPIENT sees only their own requests;
 *   - staff act only for their assigned bank/hospital.
 *
 * Ordinary GRANT SELECT cannot express "only my row". Granting DONOR or
 * RECIPIENT unrestricted access to PERSON, DONATION, or EMERGENCY_REQUEST
 * would expose other fictional users. Therefore those two database roles get
 * only non-sensitive centre/camp reference data. Own-record access remains an
 * application-RBAC responsibility unless PostgreSQL row-level security is
 * deliberately added in a later scope expansion.
 *
 * Group roles are NOLOGIN: production login/service roles should receive one
 * of them through GRANT role_name TO login_name. No passwords are stored here.
 */

BEGIN;

-- ========================================================================== 
-- 1. Create or normalize the six cluster-level group roles
-- ========================================================================== 

DO $block$
DECLARE
    v_role_name TEXT;
BEGIN
    FOREACH v_role_name IN ARRAY ARRAY[
        'lifelink_admin',
        'lifelink_doctor',
        'lifelink_blood_bank_staff',
        'lifelink_organ_bank_staff',
        'lifelink_donor',
        'lifelink_recipient'
    ]
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_roles
            WHERE rolname = v_role_name
        ) THEN
            EXECUTE format('CREATE ROLE %I', v_role_name);
        END IF;

        EXECUTE format(
            'ALTER ROLE %I WITH NOLOGIN INHERIT NOSUPERUSER NOCREATEDB '
            'NOCREATEROLE NOREPLICATION NOBYPASSRLS',
            v_role_name
        );
    END LOOP;
END;
$block$;

COMMENT ON ROLE lifelink_admin IS
    'LifeLink application administrator group; not a PostgreSQL superuser.';
COMMENT ON ROLE lifelink_doctor IS
    'LifeLink doctor group for request creation and authorized tracking.';
COMMENT ON ROLE lifelink_blood_bank_staff IS
    'LifeLink blood-bank operations group.';
COMMENT ON ROLE lifelink_organ_bank_staff IS
    'LifeLink organ-bank operations and academic matching group.';
COMMENT ON ROLE lifelink_donor IS
    'LifeLink donor group; own-row scope is enforced by application RBAC.';
COMMENT ON ROLE lifelink_recipient IS
    'LifeLink recipient group; own-row scope is enforced by application RBAC.';

-- Cluster-role creation is committed before database/schema ACL changes. This
-- also makes the administrative boundary explicit: roles are cluster objects,
-- while the following grants belong to the current LifeLink database.

COMMIT;

BEGIN;

-- CONNECT is intentionally not revoked from PUBLIC because that privilege is
-- database-wide and the database may contain unrelated schemas. The protected
-- boundary here is USAGE on schema lifelink. If a deployment has revoked PUBLIC
-- CONNECT, its administrator can additionally run:
--
--   GRANT CONNECT ON DATABASE lifelink_db
--   TO lifelink_admin,
--      lifelink_doctor,
--      lifelink_blood_bank_staff,
--      lifelink_organ_bank_staff,
--      lifelink_donor,
--      lifelink_recipient;
--
-- Replace lifelink_db with the actual database identifier; never guess it in a
-- portable project script.

SET search_path TO lifelink, public;

-- ========================================================================== 
-- 2. Deny-by-default baseline and repeat-run cleanup
-- ========================================================================== 
-- PostgreSQL grants EXECUTE on newly created functions to PUBLIC by default.
-- Remove that default exposure before granting only approved project routines.

REVOKE ALL PRIVILEGES ON SCHEMA lifelink FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA lifelink FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA lifelink FROM PUBLIC;
REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA lifelink FROM PUBLIC;

ALTER DEFAULT PRIVILEGES IN SCHEMA lifelink
    REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA lifelink
    REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA lifelink
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Clear privileges previously assigned by this script so rerunning it restores
-- the matrix below rather than accumulating outdated access.

REVOKE ALL PRIVILEGES ON SCHEMA lifelink
    FROM lifelink_admin,
         lifelink_doctor,
         lifelink_blood_bank_staff,
         lifelink_organ_bank_staff,
         lifelink_donor,
         lifelink_recipient;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA lifelink
    FROM lifelink_admin,
         lifelink_doctor,
         lifelink_blood_bank_staff,
         lifelink_organ_bank_staff,
         lifelink_donor,
         lifelink_recipient;

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA lifelink
    FROM lifelink_admin,
         lifelink_doctor,
         lifelink_blood_bank_staff,
         lifelink_organ_bank_staff,
         lifelink_donor,
         lifelink_recipient;

REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA lifelink
    FROM lifelink_admin,
         lifelink_doctor,
         lifelink_blood_bank_staff,
         lifelink_organ_bank_staff,
         lifelink_donor,
         lifelink_recipient;

-- Table-level REVOKE does not erase every possible old column grant, so reset
-- the sensitive USER_ACCOUNT columns explicitly before applying narrow grants.

REVOKE SELECT (
    user_id,
    person_id,
    blood_bank_id,
    organ_bank_id,
    username,
    password_hash,
    role,
    status,
    created_at,
    last_login_at
) ON user_account
FROM lifelink_doctor,
     lifelink_blood_bank_staff,
     lifelink_organ_bank_staff,
     lifelink_donor,
     lifelink_recipient;

-- Reset every column-level UPDATE grant used by this matrix. This prevents an
-- older permission from surviving if a later version removes it.

REVOKE UPDATE (notes) ON blood_donation
FROM lifelink_doctor,
     lifelink_blood_bank_staff,
     lifelink_organ_bank_staff,
     lifelink_donor,
     lifelink_recipient;

REVOKE UPDATE (registration_status) ON donation_registration
FROM lifelink_doctor,
     lifelink_blood_bank_staff,
     lifelink_organ_bank_staff,
     lifelink_donor,
     lifelink_recipient;

REVOKE UPDATE (result, test_date, remarks) ON medical_test_result
FROM lifelink_doctor,
     lifelink_blood_bank_staff,
     lifelink_organ_bank_staff,
     lifelink_donor,
     lifelink_recipient;

REVOKE UPDATE (current_blood_bank_id, expiry_date, status) ON blood_unit
FROM lifelink_doctor,
     lifelink_blood_bank_staff,
     lifelink_organ_bank_staff,
     lifelink_donor,
     lifelink_recipient;

REVOKE UPDATE (expires_at, status) ON blood_reservation
FROM lifelink_doctor,
     lifelink_blood_bank_staff,
     lifelink_organ_bank_staff,
     lifelink_donor,
     lifelink_recipient;

REVOKE UPDATE (notes) ON organ_donation
FROM lifelink_doctor,
     lifelink_blood_bank_staff,
     lifelink_organ_bank_staff,
     lifelink_donor,
     lifelink_recipient;

REVOKE UPDATE (current_organ_bank_id, status) ON organ_unit
FROM lifelink_doctor,
     lifelink_blood_bank_staff,
     lifelink_organ_bank_staff,
     lifelink_donor,
     lifelink_recipient;

REVOKE UPDATE (compatibility_score, match_status, calculated_at) ON organ_match
FROM lifelink_doctor,
     lifelink_blood_bank_staff,
     lifelink_organ_bank_staff,
     lifelink_donor,
     lifelink_recipient;

REVOKE UPDATE (status) ON emergency_request
FROM lifelink_doctor,
     lifelink_blood_bank_staff,
     lifelink_organ_bank_staff,
     lifelink_donor,
     lifelink_recipient;

-- Every role may resolve objects in the schema, but none may CREATE or alter
-- schema objects. DDL remains with the database owner/migration account.

GRANT USAGE ON SCHEMA lifelink
TO lifelink_admin,
   lifelink_doctor,
   lifelink_blood_bank_staff,
   lifelink_organ_bank_staff,
   lifelink_donor,
   lifelink_recipient;

REVOKE CREATE ON SCHEMA lifelink
FROM lifelink_admin,
     lifelink_doctor,
     lifelink_blood_bank_staff,
     lifelink_organ_bank_staff,
     lifelink_donor,
     lifelink_recipient;

-- Audit trigger functions call this narrow helper to read the transaction-local
-- application user ID. Operational writers need only this helper; the trigger
-- validation/audit functions themselves are not exposed for direct execution.

GRANT EXECUTE ON FUNCTION current_app_user_id()
TO lifelink_admin,
   lifelink_blood_bank_staff,
   lifelink_organ_bank_staff;

-- ========================================================================== 
-- 3. ADMIN — application administration, reports, and audit
-- ========================================================================== 
-- ADMIN is intentionally not SUPERUSER, CREATEDB, CREATEROLE, or schema owner.
-- It can manage existing LifeLink data and call the approved business routines.

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA lifelink
TO lifelink_admin;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA lifelink
TO lifelink_admin;

GRANT EXECUTE ON FUNCTION register_donation(
    INTEGER,
    VARCHAR,
    INTEGER,
    INTEGER,
    DATE,
    INTEGER,
    INTEGER,
    DATE,
    VARCHAR,
    TEXT
) TO lifelink_admin;

GRANT EXECUTE ON FUNCTION reserve_emergency_blood(INTEGER, INTEGER, INTEGER)
TO lifelink_admin;

GRANT EXECUTE ON PROCEDURE release_expired_reservations(
    INTEGER,
    INTEGER,
    INTEGER,
    INTEGER
) TO lifelink_admin;

GRANT EXECUTE ON FUNCTION calculate_organ_match(
    INTEGER,
    INTEGER,
    NUMERIC,
    INTEGER
) TO lifelink_admin;

GRANT EXECUTE ON FUNCTION generate_inventory_report(INTEGER, VARCHAR, VARCHAR)
TO lifelink_admin;

-- ========================================================================== 
-- 4. DOCTOR — recipient context, emergency request creation, tracking
-- ========================================================================== 

GRANT SELECT ON
    person,
    recipient,
    doctor,
    hospital,
    blood_bank,
    organ_bank,
    blood_unit,
    organ_unit,
    emergency_request,
    blood_reservation,
    organ_match
TO lifelink_doctor;

GRANT SELECT ON
    available_blood_units_view,
    active_emergency_requests_view,
    organ_match_priority_view,
    expiring_blood_units_view
TO lifelink_doctor;

GRANT INSERT ON emergency_request
TO lifelink_doctor;

GRANT USAGE, SELECT ON SEQUENCE emergency_request_request_id_seq
TO lifelink_doctor;

-- Explicit negative grants make the viva restriction visible. A doctor cannot
-- manage accounts/audit or directly mutate bank/organ allocation records.

REVOKE ALL PRIVILEGES ON user_account, audit_log
FROM lifelink_doctor;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON
    blood_unit,
    organ_unit,
    blood_reservation,
    organ_match
FROM lifelink_doctor;

-- ========================================================================== 
-- 5. BLOOD_BANK_STAFF — donation, screening, units, reservation, reports
-- ========================================================================== 
-- These are object-level permissions. Bank-specific row scope is checked by
-- the stored routines and will also be enforced by FastAPI authorization.

GRANT SELECT ON
    address,
    person,
    donor,
    recipient,
    doctor,
    hospital,
    blood_bank,
    organ_bank,
    donation_camp,
    medical_condition,
    donor_condition,
    donation_registration,
    donation,
    blood_donation,
    organ_donation,
    blood_unit,
    medical_test_result,
    emergency_request,
    blood_reservation
TO lifelink_blood_bank_staff;

-- The operational routines validate user role/status/bank but must not expose
-- USER_ACCOUNT.password_hash. Column-level SELECT is sufficient for them.

GRANT SELECT (
    user_id,
    blood_bank_id,
    organ_bank_id,
    role,
    status
) ON user_account
TO lifelink_blood_bank_staff;

GRANT SELECT ON
    eligible_donors_view,
    available_blood_units_view,
    active_emergency_requests_view,
    expiring_blood_units_view
TO lifelink_blood_bank_staff;

GRANT INSERT ON
    donation,
    blood_donation,
    blood_unit,
    medical_test_result,
    donation_registration,
    blood_reservation,
    audit_log
TO lifelink_blood_bank_staff;

GRANT UPDATE (notes) ON blood_donation
TO lifelink_blood_bank_staff;

GRANT UPDATE (registration_status) ON donation_registration
TO lifelink_blood_bank_staff;

GRANT UPDATE (result, test_date, remarks) ON medical_test_result
TO lifelink_blood_bank_staff;

GRANT UPDATE (current_blood_bank_id, expiry_date, status) ON blood_unit
TO lifelink_blood_bank_staff;

GRANT UPDATE (expires_at, status) ON blood_reservation
TO lifelink_blood_bank_staff;

GRANT UPDATE (status) ON emergency_request
TO lifelink_blood_bank_staff;

GRANT USAGE, SELECT ON SEQUENCE donation_donation_id_seq
TO lifelink_blood_bank_staff;
GRANT USAGE, SELECT ON SEQUENCE blood_unit_blood_unit_id_seq
TO lifelink_blood_bank_staff;
GRANT USAGE, SELECT ON SEQUENCE donation_registration_registration_id_seq
TO lifelink_blood_bank_staff;
GRANT USAGE, SELECT ON SEQUENCE blood_reservation_reservation_id_seq
TO lifelink_blood_bank_staff;
GRANT USAGE, SELECT ON SEQUENCE audit_log_audit_id_seq
TO lifelink_blood_bank_staff;

GRANT EXECUTE ON FUNCTION register_donation(
    INTEGER,
    VARCHAR,
    INTEGER,
    INTEGER,
    DATE,
    INTEGER,
    INTEGER,
    DATE,
    VARCHAR,
    TEXT
) TO lifelink_blood_bank_staff;

GRANT EXECUTE ON FUNCTION reserve_emergency_blood(INTEGER, INTEGER, INTEGER)
TO lifelink_blood_bank_staff;

GRANT EXECUTE ON PROCEDURE release_expired_reservations(
    INTEGER,
    INTEGER,
    INTEGER,
    INTEGER
) TO lifelink_blood_bank_staff;

GRANT EXECUTE ON FUNCTION generate_inventory_report(INTEGER, VARCHAR, VARCHAR)
TO lifelink_blood_bank_staff;

-- Append-only audit participation: staff-triggered operations may INSERT audit
-- events, but staff cannot read, modify, or delete the audit trail directly.

REVOKE SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON audit_log
FROM lifelink_blood_bank_staff;

-- Blood staff may read the opposite subtype for deferred disjointness checks,
-- but cannot create or alter organ donations, units, or matches.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON organ_donation
FROM lifelink_blood_bank_staff;
REVOKE ALL PRIVILEGES ON organ_unit, organ_match
FROM lifelink_blood_bank_staff;

-- ========================================================================== 
-- 6. ORGAN_BANK_STAFF — organ donation, units, screening, academic matching
-- ========================================================================== 

GRANT SELECT ON
    address,
    person,
    donor,
    recipient,
    doctor,
    hospital,
    blood_bank,
    organ_bank,
    donation_camp,
    donation,
    blood_donation,
    organ_donation,
    organ_unit,
    medical_test_result,
    emergency_request,
    organ_match
TO lifelink_organ_bank_staff;

GRANT SELECT (
    user_id,
    blood_bank_id,
    organ_bank_id,
    role,
    status
) ON user_account
TO lifelink_organ_bank_staff;

GRANT SELECT ON
    active_emergency_requests_view,
    organ_match_priority_view
TO lifelink_organ_bank_staff;

GRANT INSERT ON
    donation,
    organ_donation,
    organ_unit,
    medical_test_result,
    organ_match,
    audit_log
TO lifelink_organ_bank_staff;

GRANT UPDATE (notes) ON organ_donation
TO lifelink_organ_bank_staff;

GRANT UPDATE (result, test_date, remarks) ON medical_test_result
TO lifelink_organ_bank_staff;

GRANT UPDATE (current_organ_bank_id, status) ON organ_unit
TO lifelink_organ_bank_staff;

GRANT UPDATE (compatibility_score, match_status, calculated_at) ON organ_match
TO lifelink_organ_bank_staff;

GRANT UPDATE (status) ON emergency_request
TO lifelink_organ_bank_staff;

GRANT USAGE, SELECT ON SEQUENCE donation_donation_id_seq
TO lifelink_organ_bank_staff;
GRANT USAGE, SELECT ON SEQUENCE organ_unit_organ_unit_id_seq
TO lifelink_organ_bank_staff;
GRANT USAGE, SELECT ON SEQUENCE organ_match_match_id_seq
TO lifelink_organ_bank_staff;
GRANT USAGE, SELECT ON SEQUENCE audit_log_audit_id_seq
TO lifelink_organ_bank_staff;

GRANT EXECUTE ON FUNCTION register_donation(
    INTEGER,
    VARCHAR,
    INTEGER,
    INTEGER,
    DATE,
    INTEGER,
    INTEGER,
    DATE,
    VARCHAR,
    TEXT
) TO lifelink_organ_bank_staff;

GRANT EXECUTE ON FUNCTION calculate_organ_match(
    INTEGER,
    INTEGER,
    NUMERIC,
    INTEGER
) TO lifelink_organ_bank_staff;

REVOKE SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON audit_log
FROM lifelink_organ_bank_staff;

-- Organ staff may read the opposite subtype for deferred disjointness checks,
-- but cannot create or alter blood units or reservations.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON blood_donation
FROM lifelink_organ_bank_staff;
REVOKE ALL PRIVILEGES ON blood_unit, blood_reservation
FROM lifelink_organ_bank_staff;

-- ========================================================================== 
-- 7. DONOR and RECIPIENT — safe reference access only at database level
-- ========================================================================== 
-- Own-row profile/history requests are served by parameterized FastAPI queries
-- after JWT identity checks. No broad PERSON/DONATION/REQUEST table access is
-- granted here.

GRANT SELECT ON
    donation_camp,
    hospital,
    blood_bank,
    organ_bank
TO lifelink_donor;

GRANT SELECT ON
    hospital,
    blood_bank,
    organ_bank
TO lifelink_recipient;

REVOKE ALL PRIVILEGES ON
    person,
    donor,
    recipient,
    user_account,
    donation,
    blood_donation,
    organ_donation,
    blood_unit,
    organ_unit,
    medical_test_result,
    emergency_request,
    blood_reservation,
    organ_match,
    audit_log
FROM lifelink_donor,
     lifelink_recipient;

-- ========================================================================== 
-- 8. Executable permission-matrix assertions
-- ========================================================================== 
-- These checks fail the transaction if a critical positive or negative grant
-- is missing. They validate privileges without attempting forbidden writes.

DO $block$
BEGIN
    IF NOT has_schema_privilege('lifelink_admin', 'lifelink', 'USAGE')
       OR has_schema_privilege('lifelink_admin', 'lifelink', 'CREATE') THEN
        RAISE EXCEPTION 'ADMIN schema privilege assertion failed';
    END IF;

    IF NOT has_table_privilege(
        'lifelink_admin', 'lifelink.user_account', 'SELECT'
    )
       OR NOT has_table_privilege(
           'lifelink_admin', 'lifelink.user_account', 'INSERT'
       )
       OR NOT has_table_privilege(
           'lifelink_admin', 'lifelink.user_account', 'UPDATE'
       )
       OR NOT has_table_privilege(
           'lifelink_admin', 'lifelink.user_account', 'DELETE'
       ) THEN
        RAISE EXCEPTION 'ADMIN data-management assertion failed';
    END IF;

    IF NOT has_table_privilege(
        'lifelink_doctor', 'lifelink.emergency_request', 'SELECT'
    )
       OR NOT has_table_privilege(
           'lifelink_doctor', 'lifelink.emergency_request', 'INSERT'
       )
       OR has_table_privilege(
           'lifelink_doctor',
           'lifelink.blood_unit',
           'UPDATE'
       )
       OR has_table_privilege(
           'lifelink_doctor',
           'lifelink.user_account',
           'SELECT'
       ) THEN
        RAISE EXCEPTION 'DOCTOR privilege assertion failed';
    END IF;

    IF NOT has_column_privilege(
        'lifelink_blood_bank_staff',
        'lifelink.user_account',
        'role',
        'SELECT'
    )
       OR has_column_privilege(
           'lifelink_blood_bank_staff',
           'lifelink.user_account',
           'password_hash',
           'SELECT'
       )
       OR NOT has_column_privilege(
           'lifelink_blood_bank_staff',
           'lifelink.blood_unit',
           'status',
           'UPDATE'
       )
       OR has_table_privilege(
           'lifelink_blood_bank_staff',
           'lifelink.organ_match',
           'INSERT'
       ) THEN
        RAISE EXCEPTION 'BLOOD_BANK_STAFF privilege assertion failed';
    END IF;

    IF NOT has_table_privilege(
        'lifelink_organ_bank_staff', 'lifelink.organ_match', 'SELECT'
    )
       OR NOT has_table_privilege(
           'lifelink_organ_bank_staff', 'lifelink.organ_match', 'INSERT'
       )
       OR NOT has_column_privilege(
           'lifelink_organ_bank_staff',
           'lifelink.organ_match',
           'match_status',
           'UPDATE'
       )
       OR has_table_privilege(
           'lifelink_organ_bank_staff',
           'lifelink.blood_reservation',
           'INSERT'
       ) THEN
        RAISE EXCEPTION 'ORGAN_BANK_STAFF privilege assertion failed';
    END IF;

    IF NOT has_table_privilege(
        'lifelink_donor',
        'lifelink.donation_camp',
        'SELECT'
    )
       OR has_table_privilege(
           'lifelink_donor',
           'lifelink.person',
           'SELECT'
       )
       OR NOT has_table_privilege(
           'lifelink_recipient',
           'lifelink.hospital',
           'SELECT'
       )
       OR has_table_privilege(
           'lifelink_recipient',
           'lifelink.emergency_request',
           'SELECT'
       ) THEN
        RAISE EXCEPTION 'DONOR/RECIPIENT privilege assertion failed';
    END IF;

    IF NOT has_function_privilege(
        'lifelink_blood_bank_staff',
        'lifelink.reserve_emergency_blood(integer,integer,integer)',
        'EXECUTE'
    )
       OR has_function_privilege(
           'lifelink_doctor',
           'lifelink.reserve_emergency_blood(integer,integer,integer)',
           'EXECUTE'
       )
       OR NOT has_function_privilege(
           'lifelink_organ_bank_staff',
           'lifelink.calculate_organ_match(integer,integer,numeric,integer)',
           'EXECUTE'
       )
       OR has_function_privilege(
           'lifelink_donor',
           'lifelink.calculate_organ_match(integer,integer,numeric,integer)',
           'EXECUTE'
       ) THEN
        RAISE EXCEPTION 'Routine EXECUTE privilege assertion failed';
    END IF;
END;
$block$;

COMMIT;

/*
 * Permission matrix summary
 * --------------------------------------------------------------------------
 * Role                         Main positive access
 * ---------------------------  ---------------------------------------------
 * lifelink_admin               Existing data, reports, audit, approved routines
 * lifelink_doctor              Read clinical/request context; INSERT request
 * lifelink_blood_bank_staff    Blood donation/testing/unit/reservation workflow
 * lifelink_organ_bank_staff    Organ donation/unit/academic matching workflow
 * lifelink_donor               Non-sensitive camp and centre reference data
 * lifelink_recipient           Non-sensitive centre reference data
 *
 * No group role can LOGIN, create schema objects, create databases/roles, bypass
 * RLS, replicate, or become superuser.
 */

/*
 * Safe catalog verification queries
 * --------------------------------------------------------------------------
 *
 * 1. Role attributes:
 *
 *    SELECT
 *        rolname,
 *        rolcanlogin,
 *        rolsuper,
 *        rolcreatedb,
 *        rolcreaterole,
 *        rolbypassrls
 *    FROM pg_roles
 *    WHERE rolname LIKE 'lifelink_%'
 *    ORDER BY rolname;
 *
 * 2. Table/view grants:
 *
 *    SELECT grantee, table_name, privilege_type
 *    FROM information_schema.role_table_grants
 *    WHERE table_schema = 'lifelink'
 *      AND grantee LIKE 'lifelink_%'
 *    ORDER BY grantee, table_name, privilege_type;
 *
 * 3. Column-level protection for USER_ACCOUNT:
 *
 *    SELECT grantee, column_name, privilege_type
 *    FROM information_schema.column_privileges
 *    WHERE table_schema = 'lifelink'
 *      AND table_name = 'user_account'
 *      AND grantee LIKE 'lifelink_%'
 *    ORDER BY grantee, column_name;
 */

/*
 * GRANT/REVOKE viva demonstration (run as owner/admin)
 * --------------------------------------------------------------------------
 * PostgreSQL's SET ROLE lets the evaluator demonstrate success and denial
 * without creating password-bearing login accounts.
 *
 * A. DOCTOR positive and negative examples:
 *
 *    SET ROLE lifelink_doctor;
 *
 *    SELECT request_id, priority, status
 *    FROM lifelink.active_emergency_requests_view
 *    ORDER BY requested_at;
 *    -- Expected: succeeds.
 *
 *    SELECT password_hash FROM lifelink.user_account;
 *    -- Expected: permission denied.
 *
 *    UPDATE lifelink.blood_unit
 *    SET status = 'RESERVED'
 *    WHERE blood_unit_id = 12;
 *    -- Expected: permission denied before any lifecycle change.
 *
 *    RESET ROLE;
 *
 * B. BLOOD_BANK_STAFF routine privilege:
 *
 *    BEGIN;
 *    SET LOCAL ROLE lifelink_blood_bank_staff;
 *    SELECT * FROM lifelink.generate_inventory_report(2, 'AB-', NULL);
 *    ROLLBACK;
 *    -- Expected: succeeds; ROLLBACK leaves the demo state unchanged.
 *
 * C. Temporary membership GRANT and REVOKE example:
 *
 *    -- Assume an existing safe demonstration login named class_demo_user.
 *    GRANT lifelink_doctor TO class_demo_user;
 *    REVOKE lifelink_doctor FROM class_demo_user;
 *
 * Do not place real passwords in project SQL or screenshots.
 */
