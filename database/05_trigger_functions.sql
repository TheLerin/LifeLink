/*
 * LifeLink — Multi-Hospital Blood and Organ Allocation System
 * Phase 8: PL/pgSQL trigger functions
 *
 * Prerequisites:
 *   1. 01_schema.sql
 *   2. 02_constraints.sql
 *
 * This file creates trigger functions only. It does not attach triggers.
 * Trigger attachment is intentionally reserved for 06_triggers.sql.
 */

BEGIN;

SET search_path TO lifelink, public;

-- --------------------------------------------------------------------------
-- Helper: application user identity for audit rows
-- --------------------------------------------------------------------------
-- FastAPI will set the authenticated user inside each write transaction:
--
--   SET LOCAL lifelink.app_user_id = '3';
--
-- current_setting(..., true) returns NULL when the setting was not supplied.

CREATE OR REPLACE FUNCTION current_app_user_id()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = lifelink, pg_temp
AS $function$
DECLARE
    v_raw_value TEXT;
BEGIN
    v_raw_value := current_setting('lifelink.app_user_id', TRUE);

    IF v_raw_value IS NULL OR btrim(v_raw_value) = '' THEN
        RETURN NULL;
    END IF;

    IF v_raw_value !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '22023',
                MESSAGE = 'lifelink.app_user_id must contain a positive integer';
    END IF;

    RETURN v_raw_value::INTEGER;
END;
$function$;

COMMENT ON FUNCTION current_app_user_id() IS
    'Returns the transaction-local authenticated application user for auditing.';

-- --------------------------------------------------------------------------
-- Generic updated_at maintenance
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = lifelink, pg_temp
AS $function$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION set_updated_at() IS
    'Sets NEW.updated_at immediately before an UPDATE.';

-- --------------------------------------------------------------------------
-- Donation specialization: total and disjoint
-- --------------------------------------------------------------------------
-- This function is designed for deferred constraint triggers on DONATION,
-- BLOOD_DONATION, and ORGAN_DONATION. At transaction end, every donation must
-- have exactly the subtype named by donation_type and no opposite subtype.

CREATE OR REPLACE FUNCTION validate_donation_specialization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = lifelink, pg_temp
AS $function$
DECLARE
    v_donation_id INTEGER;
    v_donation_type VARCHAR(10);
    v_has_blood_subtype BOOLEAN;
    v_has_organ_subtype BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_donation_id := OLD.donation_id;
    ELSE
        v_donation_id := NEW.donation_id;
    END IF;

    SELECT d.donation_type
    INTO v_donation_type
    FROM donation AS d
    WHERE d.donation_id = v_donation_id;

    -- The parent may already have been deleted. Referential actions handle the
    -- remaining cleanup, so there is no specialization row left to validate.
    IF NOT FOUND THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM blood_donation AS bd
        WHERE bd.donation_id = v_donation_id
    )
    INTO v_has_blood_subtype;

    SELECT EXISTS (
        SELECT 1
        FROM organ_donation AS od
        WHERE od.donation_id = v_donation_id
    )
    INTO v_has_organ_subtype;

    IF v_donation_type = 'BLOOD'
       AND (NOT v_has_blood_subtype OR v_has_organ_subtype) THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = format(
                    'Donation %s is BLOOD and must have exactly one blood subtype',
                    v_donation_id
                );
    ELSIF v_donation_type = 'ORGAN'
          AND (NOT v_has_organ_subtype OR v_has_blood_subtype) THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = format(
                    'Donation %s is ORGAN and must have exactly one organ subtype',
                    v_donation_id
                );
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION validate_donation_specialization() IS
    'Deferred validation of total, disjoint BLOOD/ORGAN donation specialization.';

-- --------------------------------------------------------------------------
-- User-account role must match the referenced person subtype
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION validate_user_account_role_subject()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = lifelink, pg_temp
AS $function$
BEGIN
    IF NEW.role = 'DOCTOR'
       AND NOT EXISTS (
           SELECT 1 FROM doctor WHERE doctor_id = NEW.person_id
       ) THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'A DOCTOR account must reference a doctor subtype';
    ELSIF NEW.role = 'DONOR'
          AND NOT EXISTS (
              SELECT 1 FROM donor WHERE donor_id = NEW.person_id
          ) THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'A DONOR account must reference a donor subtype';
    ELSIF NEW.role = 'RECIPIENT'
          AND NOT EXISTS (
              SELECT 1 FROM recipient WHERE recipient_id = NEW.person_id
          ) THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'A RECIPIENT account must reference a recipient subtype';
    END IF;

    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION validate_user_account_role_subject() IS
    'Ensures role-specific user accounts reference the correct person subtype.';

-- --------------------------------------------------------------------------
-- Blood-unit origin, expiry, and screening validation
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION validate_blood_availability_after_test()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = lifelink, pg_temp
AS $function$
DECLARE
    v_donation_date DATE;
    v_donation_type VARCHAR(10);
    v_record_status VARCHAR(20);
    v_collection_bank_id INTEGER;
    v_test_count INTEGER;
    v_invalid_test_count INTEGER;
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.donation_id IS DISTINCT FROM OLD.donation_id THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'A blood unit cannot be reassigned to another donation';
    END IF;

    SELECT
        d.donation_date,
        d.donation_type,
        d.record_status,
        bd.collection_bank_id
    INTO
        v_donation_date,
        v_donation_type,
        v_record_status,
        v_collection_bank_id
    FROM blood_donation AS bd
    JOIN donation AS d
        ON d.donation_id = bd.donation_id
    WHERE bd.donation_id = NEW.donation_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23503',
                MESSAGE = format(
                    'Blood donation %s does not exist',
                    NEW.donation_id
                );
    END IF;

    IF v_donation_type <> 'BLOOD' THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'A blood unit must originate from a BLOOD donation';
    END IF;

    IF TG_OP = 'INSERT'
       AND NEW.current_blood_bank_id <> v_collection_bank_id THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'A new blood unit must initially be stored at its collection bank';
    END IF;

    IF NEW.expiry_date <= v_donation_date THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'Blood-unit expiry date must be after donation date';
    END IF;

    IF NEW.status = 'AVAILABLE' THEN
        IF NEW.expiry_date < CURRENT_DATE THEN
            RAISE EXCEPTION
                USING
                    ERRCODE = '23514',
                    MESSAGE = 'Expired blood cannot become AVAILABLE';
        END IF;

        IF v_record_status <> 'ACTIVE' THEN
            RAISE EXCEPTION
                USING
                    ERRCODE = '23514',
                    MESSAGE = 'A voided donation cannot supply AVAILABLE blood';
        END IF;

        SELECT
            COUNT(*)::INTEGER,
            COUNT(*) FILTER (WHERE result <> 'PASS')::INTEGER
        INTO
            v_test_count,
            v_invalid_test_count
        FROM medical_test_result
        WHERE donation_id = NEW.donation_id;

        IF v_test_count = 0 THEN
            RAISE EXCEPTION
                USING
                    ERRCODE = '23514',
                    MESSAGE = 'Blood cannot become AVAILABLE without screening results';
        END IF;

        IF v_invalid_test_count > 0 THEN
            RAISE EXCEPTION
                USING
                    ERRCODE = '23514',
                    MESSAGE = 'All screening results must be PASS before blood becomes AVAILABLE';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION validate_blood_availability_after_test() IS
    'Validates blood origin, expiry, and PASS screening before AVAILABLE.';

-- --------------------------------------------------------------------------
-- Blood-unit lifecycle transition graph
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION validate_blood_unit_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = lifelink, pg_temp
AS $function$
DECLARE
    v_transition_allowed BOOLEAN := FALSE;
BEGIN
    IF TG_OP <> 'UPDATE'
       OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    v_transition_allowed :=
           (OLD.status = 'COLLECTED' AND NEW.status IN ('TESTING', 'EXPIRED'))
        OR (OLD.status = 'TESTING'   AND NEW.status IN ('AVAILABLE', 'REJECTED', 'EXPIRED'))
        OR (OLD.status = 'AVAILABLE' AND NEW.status IN ('RESERVED', 'EXPIRED'))
        OR (OLD.status = 'RESERVED'  AND NEW.status IN ('AVAILABLE', 'ISSUED', 'EXPIRED'));

    IF NOT v_transition_allowed THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = format(
                    'Invalid blood-unit transition: %s -> %s',
                    OLD.status,
                    NEW.status
                );
    END IF;

    IF NEW.status = 'REJECTED'
       AND NOT EXISTS (
           SELECT 1
           FROM medical_test_result
           WHERE donation_id = NEW.donation_id
             AND result = 'FAIL'
       ) THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'TESTING can become REJECTED only after a FAIL result';
    END IF;

    IF NEW.status = 'EXPIRED'
       AND NEW.expiry_date >= CURRENT_DATE THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'A blood unit cannot become EXPIRED before its expiry date';
    END IF;

    IF OLD.status = 'AVAILABLE'
       AND NEW.status = 'RESERVED'
       AND NOT EXISTS (
           SELECT 1
           FROM blood_reservation
           WHERE blood_unit_id = NEW.blood_unit_id
             AND status = 'ACTIVE'
       ) THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'AVAILABLE can become RESERVED only after an ACTIVE reservation exists';
    END IF;

    IF OLD.status = 'RESERVED'
       AND NEW.status = 'AVAILABLE'
       AND EXISTS (
           SELECT 1
           FROM blood_reservation
           WHERE blood_unit_id = NEW.blood_unit_id
             AND status = 'ACTIVE'
       ) THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'A unit cannot return to AVAILABLE while an ACTIVE reservation exists';
    END IF;

    IF OLD.status = 'RESERVED'
       AND NEW.status = 'ISSUED'
       AND NOT EXISTS (
           SELECT 1
           FROM blood_reservation
           WHERE blood_unit_id = NEW.blood_unit_id
             AND status = 'COMPLETED'
       ) THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'RESERVED can become ISSUED only after reservation completion';
    END IF;

    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION validate_blood_unit_status_transition() IS
    'Enforces the permitted blood-unit lifecycle and reservation-linked transitions.';

-- --------------------------------------------------------------------------
-- Blood-reservation creation and activation preconditions
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_expired_blood_reservation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = lifelink, pg_temp
AS $function$
DECLARE
    v_is_new_activation BOOLEAN;
    v_existing_allocation_count INTEGER;
    v_excluded_reservation_id INTEGER;
    v_unit_status VARCHAR(20);
    v_unit_expiry DATE;
    v_unit_blood_group VARCHAR(3);
    v_bank_status VARCHAR(20);
    v_request_type VARCHAR(10);
    v_request_status VARCHAR(30);
    v_requested_blood_group VARCHAR(3);
    v_units_required SMALLINT;
BEGIN
    IF NEW.status <> 'ACTIVE' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_is_new_activation := TRUE;
        v_excluded_reservation_id := NULL;
    ELSE
        v_is_new_activation := OLD.status IS DISTINCT FROM 'ACTIVE';
        v_excluded_reservation_id := OLD.reservation_id;
    END IF;

    SELECT
        bu.status,
        bu.expiry_date,
        bu.blood_group,
        bb.status,
        er.request_type,
        er.status,
        er.blood_group,
        er.units_required
    INTO
        v_unit_status,
        v_unit_expiry,
        v_unit_blood_group,
        v_bank_status,
        v_request_type,
        v_request_status,
        v_requested_blood_group,
        v_units_required
    FROM blood_unit AS bu
    JOIN blood_bank AS bb
        ON bb.blood_bank_id = bu.current_blood_bank_id
    CROSS JOIN emergency_request AS er
    WHERE bu.blood_unit_id = NEW.blood_unit_id
      AND er.request_id = NEW.request_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23503',
                MESSAGE = 'Reservation request or blood unit does not exist';
    END IF;

    IF v_request_type <> 'BLOOD' THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'A blood reservation must reference a BLOOD request';
    END IF;

    IF v_request_status NOT IN ('PENDING', 'PARTIALLY_RESERVED', 'RESERVED') THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = format(
                    'Request status %s does not allow an ACTIVE reservation',
                    v_request_status
                );
    END IF;

    IF v_requested_blood_group <> v_unit_blood_group THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = format(
                    'Requested group %s does not match unit group %s',
                    v_requested_blood_group,
                    v_unit_blood_group
                );
    END IF;

    IF v_bank_status <> 'ACTIVE' THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'Blood cannot be reserved from an inactive bank';
    END IF;

    IF v_unit_expiry < CURRENT_DATE THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'Expired blood cannot be reserved';
    END IF;

    IF NEW.expires_at IS NULL THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'An ACTIVE reservation must have an expiry timestamp';
    END IF;

    IF NEW.expires_at::DATE > v_unit_expiry THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'Reservation expiry cannot be later than blood-unit expiry';
    END IF;

    IF v_is_new_activation AND v_unit_status <> 'AVAILABLE' THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = format(
                    'Only an AVAILABLE blood unit can be newly reserved; current status is %s',
                    v_unit_status
                );
    END IF;

    IF NOT v_is_new_activation
       AND v_unit_status NOT IN ('AVAILABLE', 'RESERVED') THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = format(
                    'An ACTIVE reservation cannot reference unit status %s',
                    v_unit_status
                );
    END IF;

    IF v_is_new_activation THEN
        SELECT COUNT(*)::INTEGER
        INTO v_existing_allocation_count
        FROM blood_reservation AS br
        WHERE br.request_id = NEW.request_id
          AND br.status IN ('ACTIVE', 'COMPLETED')
          AND (
              v_excluded_reservation_id IS NULL
              OR br.reservation_id <> v_excluded_reservation_id
          );

        IF v_existing_allocation_count >= v_units_required THEN
            RAISE EXCEPTION
                USING
                    ERRCODE = '23514',
                    MESSAGE = format(
                        'Request %s already has all %s required units allocated',
                        NEW.request_id,
                        v_units_required
                    );
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION prevent_expired_blood_reservation() IS
    'Validates ACTIVE reservation type, group, bank, expiry, availability, and remaining demand.';

-- --------------------------------------------------------------------------
-- Blood-reservation lifecycle
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION validate_blood_reservation_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = lifelink, pg_temp
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'ACTIVE' THEN
            RAISE EXCEPTION
                USING
                    ERRCODE = '23514',
                    MESSAGE = 'A new operational reservation must start as ACTIVE';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.request_id IS DISTINCT FROM OLD.request_id
       OR NEW.blood_unit_id IS DISTINCT FROM OLD.blood_unit_id THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'A reservation cannot be reassigned to another request or unit';
    END IF;

    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    IF NOT (
        OLD.status = 'ACTIVE'
        AND NEW.status IN ('COMPLETED', 'CANCELLED', 'EXPIRED')
    ) THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = format(
                    'Invalid reservation transition: %s -> %s',
                    OLD.status,
                    NEW.status
                );
    END IF;

    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION validate_blood_reservation_status_transition() IS
    'Enforces ACTIVE-to-terminal reservation transitions and immutable links.';

-- --------------------------------------------------------------------------
-- Organ-unit origin integrity
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION validate_organ_unit_origin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = lifelink, pg_temp
AS $function$
DECLARE
    v_donation_type VARCHAR(10);
    v_record_status VARCHAR(20);
    v_collection_bank_id INTEGER;
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.donation_id IS DISTINCT FROM OLD.donation_id THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'An organ unit cannot be reassigned to another donation';
    END IF;

    SELECT
        d.donation_type,
        d.record_status,
        od.collection_organ_bank_id
    INTO
        v_donation_type,
        v_record_status,
        v_collection_bank_id
    FROM organ_donation AS od
    JOIN donation AS d
        ON d.donation_id = od.donation_id
    WHERE od.donation_id = NEW.donation_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23503',
                MESSAGE = format(
                    'Organ donation %s does not exist',
                    NEW.donation_id
                );
    END IF;

    IF v_donation_type <> 'ORGAN' THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'An organ unit must originate from an ORGAN donation';
    END IF;

    IF TG_OP = 'INSERT'
       AND NEW.current_organ_bank_id <> v_collection_bank_id THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'A new organ unit must initially be stored at its collection bank';
    END IF;

    IF NEW.status IN ('AVAILABLE', 'MATCHING', 'ALLOCATED')
       AND v_record_status <> 'ACTIVE' THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'A voided donation cannot supply an active organ unit';
    END IF;

    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION validate_organ_unit_origin() IS
    'Validates organ donation type, initial bank, immutable origin, and active record.';

-- --------------------------------------------------------------------------
-- Organ-match request/unit consistency
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION validate_organ_match_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = lifelink, pg_temp
AS $function$
DECLARE
    v_request_type VARCHAR(10);
    v_request_organ_type VARCHAR(50);
    v_request_status VARCHAR(30);
    v_unit_organ_type VARCHAR(50);
    v_unit_status VARCHAR(20);
    v_is_new_selection BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE'
       AND (
           NEW.request_id IS DISTINCT FROM OLD.request_id
           OR NEW.organ_unit_id IS DISTINCT FROM OLD.organ_unit_id
       ) THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'An organ match cannot be reassigned to another request or unit';
    END IF;

    SELECT
        er.request_type,
        er.organ_type,
        er.status,
        ou.organ_type,
        ou.status
    INTO
        v_request_type,
        v_request_organ_type,
        v_request_status,
        v_unit_organ_type,
        v_unit_status
    FROM emergency_request AS er
    CROSS JOIN organ_unit AS ou
    WHERE er.request_id = NEW.request_id
      AND ou.organ_unit_id = NEW.organ_unit_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23503',
                MESSAGE = 'Organ request or organ unit does not exist';
    END IF;

    IF v_request_type <> 'ORGAN' THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'An organ match must reference an ORGAN request';
    END IF;

    IF v_request_organ_type <> v_unit_organ_type THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = format(
                    'Requested organ %s does not match unit organ %s',
                    v_request_organ_type,
                    v_unit_organ_type
                );
    END IF;

    IF NEW.match_status IN ('CANDIDATE', 'SELECTED')
       AND v_request_status NOT IN ('PENDING', 'MATCHED') THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = format(
                    'Request status %s does not allow candidate selection',
                    v_request_status
                );
    END IF;

    IF NEW.match_status = 'COMPLETED'
       AND v_request_status NOT IN ('MATCHED', 'COMPLETED') THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'A match can complete only for a MATCHED or COMPLETED request';
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_is_new_selection := NEW.match_status = 'SELECTED';
    ELSE
        v_is_new_selection :=
            NEW.match_status = 'SELECTED'
            AND OLD.match_status NOT IN ('SELECTED', 'COMPLETED');
    END IF;

    IF NEW.match_status = 'CANDIDATE'
       AND v_unit_status NOT IN ('AVAILABLE', 'MATCHING') THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'A candidate match requires an AVAILABLE or MATCHING organ unit';
    END IF;

    IF v_is_new_selection
       AND v_unit_status NOT IN ('AVAILABLE', 'MATCHING') THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'A new selection requires an AVAILABLE or MATCHING organ unit';
    END IF;

    IF NEW.match_status = 'COMPLETED'
       AND v_unit_status <> 'ALLOCATED' THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'A completed match requires an ALLOCATED organ unit';
    END IF;

    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION validate_organ_match_request() IS
    'Validates ORGAN request type, organ compatibility, states, and immutable match links.';

-- --------------------------------------------------------------------------
-- Audit: blood-unit lifecycle
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_blood_unit_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = lifelink, pg_temp
AS $function$
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    INSERT INTO audit_log (
        user_id,
        table_name,
        record_id,
        action,
        old_status,
        new_status,
        details
    )
    VALUES (
        current_app_user_id(),
        'blood_unit',
        NEW.blood_unit_id::TEXT,
        'STATUS_CHANGE',
        OLD.status,
        NEW.status,
        format(
            'Blood unit %s changed from %s to %s.',
            NEW.blood_unit_id,
            OLD.status,
            NEW.status
        )
    );

    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION audit_blood_unit_status_change() IS
    'Writes one audit row after a blood-unit status change.';

-- --------------------------------------------------------------------------
-- Audit: reservation creation and status changes
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_reservation_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = lifelink, pg_temp
AS $function$
DECLARE
    v_actor_user_id INTEGER;
    v_action VARCHAR(40);
    v_old_status VARCHAR(20);
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_actor_user_id := COALESCE(current_app_user_id(), NEW.created_by);
        v_action := 'RESERVATION_CREATED';
        v_old_status := NULL;
    ELSE
        v_actor_user_id := current_app_user_id();
        v_action := 'RESERVATION_STATUS_CHANGE';
        v_old_status := OLD.status;
    END IF;

    INSERT INTO audit_log (
        user_id,
        table_name,
        record_id,
        action,
        old_status,
        new_status,
        details
    )
    VALUES (
        v_actor_user_id,
        'blood_reservation',
        NEW.reservation_id::TEXT,
        v_action,
        v_old_status,
        NEW.status,
        format(
            'Reservation %s links request %s to blood unit %s.',
            NEW.reservation_id,
            NEW.request_id,
            NEW.blood_unit_id
        )
    );

    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION audit_reservation_change() IS
    'Audits reservation creation and every reservation status transition.';

COMMIT;
