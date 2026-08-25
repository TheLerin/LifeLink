/*
 * LifeLink — Multi-Hospital Blood and Organ Allocation System
 * Phase 9: Trigger attachment
 *
 * Prerequisites:
 *   1. 01_schema.sql
 *   2. 02_constraints.sql
 *   3. 05_trigger_functions.sql
 *
 * The numeric prefixes make the execution order explicit for triggers that
 * share the same timing and event. PostgreSQL fires same-kind triggers in
 * alphabetical name order. DROP ... IF EXISTS makes this script repeatable.
 */

BEGIN;

SET search_path TO lifelink, public;

-- --------------------------------------------------------------------------
-- Person and account integrity
-- --------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_10_person_updated_at ON person;
CREATE TRIGGER trg_10_person_updated_at
BEFORE UPDATE ON person
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMENT ON TRIGGER trg_10_person_updated_at ON person IS
    'Refreshes person.updated_at for every row update.';

DROP TRIGGER IF EXISTS trg_10_user_role_subject ON user_account;
CREATE TRIGGER trg_10_user_role_subject
BEFORE INSERT OR UPDATE OF person_id, role ON user_account
FOR EACH ROW
EXECUTE FUNCTION validate_user_account_role_subject();

COMMENT ON TRIGGER trg_10_user_role_subject ON user_account IS
    'Requires DOCTOR, DONOR, and RECIPIENT accounts to reference the matching person subtype.';

-- --------------------------------------------------------------------------
-- Donation specialization
-- --------------------------------------------------------------------------
-- These checks are deferred until transaction end so the parent and its one
-- required subtype can be inserted or deleted in either safe statement order.

DROP TRIGGER IF EXISTS ctr_donation_specialization_parent ON donation;
CREATE CONSTRAINT TRIGGER ctr_donation_specialization_parent
AFTER INSERT OR UPDATE OR DELETE ON donation
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_donation_specialization();

COMMENT ON TRIGGER ctr_donation_specialization_parent ON donation IS
    'At transaction end, requires exactly the subtype named by donation_type.';

DROP TRIGGER IF EXISTS ctr_blood_donation_specialization ON blood_donation;
CREATE CONSTRAINT TRIGGER ctr_blood_donation_specialization
AFTER INSERT OR UPDATE OR DELETE ON blood_donation
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_donation_specialization();

COMMENT ON TRIGGER ctr_blood_donation_specialization ON blood_donation IS
    'Deferred total-and-disjoint validation for the BLOOD donation subtype.';

DROP TRIGGER IF EXISTS ctr_organ_donation_specialization ON organ_donation;
CREATE CONSTRAINT TRIGGER ctr_organ_donation_specialization
AFTER INSERT OR UPDATE OR DELETE ON organ_donation
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_donation_specialization();

COMMENT ON TRIGGER ctr_organ_donation_specialization ON organ_donation IS
    'Deferred total-and-disjoint validation for the ORGAN donation subtype.';

-- --------------------------------------------------------------------------
-- Blood-unit integrity, lifecycle, timestamp, and audit
-- --------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_10_blood_unit_integrity ON blood_unit;
CREATE TRIGGER trg_10_blood_unit_integrity
BEFORE INSERT OR UPDATE OF donation_id, current_blood_bank_id, expiry_date, status
ON blood_unit
FOR EACH ROW
EXECUTE FUNCTION validate_blood_availability_after_test();

COMMENT ON TRIGGER trg_10_blood_unit_integrity ON blood_unit IS
    'Validates origin, initial bank, expiry, and PASS screening before availability.';

DROP TRIGGER IF EXISTS trg_20_blood_unit_transition ON blood_unit;
CREATE TRIGGER trg_20_blood_unit_transition
BEFORE UPDATE OF status ON blood_unit
FOR EACH ROW
EXECUTE FUNCTION validate_blood_unit_status_transition();

COMMENT ON TRIGGER trg_20_blood_unit_transition ON blood_unit IS
    'Enforces the permitted blood-unit lifecycle and reservation-linked transitions.';

DROP TRIGGER IF EXISTS trg_90_blood_unit_updated_at ON blood_unit;
CREATE TRIGGER trg_90_blood_unit_updated_at
BEFORE UPDATE ON blood_unit
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMENT ON TRIGGER trg_90_blood_unit_updated_at ON blood_unit IS
    'Refreshes blood_unit.updated_at after earlier BEFORE checks succeed.';

DROP TRIGGER IF EXISTS trg_90_blood_unit_audit ON blood_unit;
CREATE TRIGGER trg_90_blood_unit_audit
AFTER UPDATE OF status ON blood_unit
FOR EACH ROW
EXECUTE FUNCTION audit_blood_unit_status_change();

COMMENT ON TRIGGER trg_90_blood_unit_audit ON blood_unit IS
    'Writes an audit row after each successful blood-unit status change.';

-- --------------------------------------------------------------------------
-- Blood-reservation lifecycle, preconditions, and audit
-- --------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_10_reservation_transition ON blood_reservation;
CREATE TRIGGER trg_10_reservation_transition
BEFORE INSERT OR UPDATE OF request_id, blood_unit_id, status
ON blood_reservation
FOR EACH ROW
EXECUTE FUNCTION validate_blood_reservation_status_transition();

COMMENT ON TRIGGER trg_10_reservation_transition ON blood_reservation IS
    'Requires ACTIVE creation, immutable links, and ACTIVE-to-terminal transitions.';

DROP TRIGGER IF EXISTS trg_20_reservation_preconditions ON blood_reservation;
CREATE TRIGGER trg_20_reservation_preconditions
BEFORE INSERT OR UPDATE OF request_id, blood_unit_id, expires_at, status
ON blood_reservation
FOR EACH ROW
EXECUTE FUNCTION prevent_expired_blood_reservation();

COMMENT ON TRIGGER trg_20_reservation_preconditions ON blood_reservation IS
    'Validates active request demand, exact blood group, unit availability, bank, and expiry.';

DROP TRIGGER IF EXISTS trg_90_reservation_audit ON blood_reservation;
CREATE TRIGGER trg_90_reservation_audit
AFTER INSERT OR UPDATE OF status ON blood_reservation
FOR EACH ROW
EXECUTE FUNCTION audit_reservation_change();

COMMENT ON TRIGGER trg_90_reservation_audit ON blood_reservation IS
    'Audits reservation creation and successful status changes.';

-- --------------------------------------------------------------------------
-- Organ-unit and organ-match integrity
-- --------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_10_organ_unit_origin ON organ_unit;
CREATE TRIGGER trg_10_organ_unit_origin
BEFORE INSERT OR UPDATE OF donation_id, current_organ_bank_id, status
ON organ_unit
FOR EACH ROW
EXECUTE FUNCTION validate_organ_unit_origin();

COMMENT ON TRIGGER trg_10_organ_unit_origin ON organ_unit IS
    'Validates organ origin, initial bank, immutable donation, and active source record.';

DROP TRIGGER IF EXISTS trg_10_organ_match_integrity ON organ_match;
CREATE TRIGGER trg_10_organ_match_integrity
BEFORE INSERT OR UPDATE OF request_id, organ_unit_id, match_status
ON organ_match
FOR EACH ROW
EXECUTE FUNCTION validate_organ_match_request();

COMMENT ON TRIGGER trg_10_organ_match_integrity ON organ_match IS
    'Validates organ request type, organ type, request/unit states, and immutable links.';

COMMIT;
