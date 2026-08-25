/*
 * LifeLink — Multi-Hospital Blood and Organ Allocation System
 * Phase 10: Stored functions and procedures
 *
 * Run after:
 *   1. 01_schema.sql
 *   2. 02_constraints.sql
 *   3. 03_sample_data.sql       (recommended for the demo)
 *   4. 04_views.sql
 *   5. 05_trigger_functions.sql
 *   6. 06_triggers.sql
 *
 * Routines created:
 *   1. register_donation(...)              function
 *   2. reserve_emergency_blood(...)        function
 *   3. release_expired_reservations(...)   procedure
 *   4. calculate_organ_match(...)          function
 *   5. generate_inventory_report(...)      function
 *
 * All modifying routines execute inside the caller's PostgreSQL transaction.
 * If any statement raises an exception, the call is atomic and its changes
 * are rolled back by PostgreSQL.
 */

BEGIN;

SET search_path TO lifelink, public;

-- ========================================================================== 
-- 1. Register one complete BLOOD or ORGAN donation
-- ========================================================================== 
-- Purpose:
--   Create the DONATION parent, exactly one required subtype, and its initial
--   unit as one atomic operation.
--
-- Required parameters:
--   p_donor_id, p_donation_type, p_collection_bank_id, p_user_id
--
-- Type-specific parameters:
--   BLOOD -> p_quantity_collected_ml and p_expiry_date are required.
--   ORGAN -> p_organ_type is required.
--
-- Returns:
--   Generated donation ID, the generated type-specific unit ID, and status.
--
-- Academic validation:
--   Active donor; authorized active-bank staff; non-future donation date;
--   valid camp when supplied; and simplified blood-donor criteria. These are
--   demonstration rules and must not be described as clinical clearance.
--
-- Example BLOOD call:
--   SELECT *
--   FROM lifelink.register_donation(
--       10, 'BLOOD', 1, 3, CURRENT_DATE, NULL, 450,
--       CURRENT_DATE + 35, NULL, 'Demo registration'
--   );
--
-- Example ORGAN call:
--   SELECT *
--   FROM lifelink.register_donation(
--       10, 'ORGAN', 1, 4, CURRENT_DATE, NULL, NULL,
--       NULL, 'KIDNEY', 'Academic organ record only'
--   );

CREATE OR REPLACE FUNCTION register_donation(
    p_donor_id INTEGER,
    p_donation_type VARCHAR(10),
    p_collection_bank_id INTEGER,
    p_user_id INTEGER,
    p_donation_date DATE DEFAULT CURRENT_DATE,
    p_camp_id INTEGER DEFAULT NULL,
    p_quantity_collected_ml INTEGER DEFAULT NULL,
    p_expiry_date DATE DEFAULT NULL,
    p_organ_type VARCHAR(50) DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
    donation_id INTEGER,
    blood_unit_id INTEGER,
    organ_unit_id INTEGER,
    unit_status VARCHAR(20)
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = lifelink, pg_temp
AS $function$
DECLARE
    v_actor_role VARCHAR(30);
    v_actor_status VARCHAR(20);
    v_actor_blood_bank_id INTEGER;
    v_actor_organ_bank_id INTEGER;
    v_donor_blood_group VARCHAR(3);
    v_donor_weight NUMERIC(5,2);
    v_donor_active BOOLEAN;
    v_donor_date_of_birth DATE;
    v_donation_id INTEGER;
    v_blood_unit_id INTEGER := NULL;
    v_organ_unit_id INTEGER := NULL;
    v_unit_status VARCHAR(20);
BEGIN
    IF p_donation_type IS NULL
       OR upper(btrim(p_donation_type)) NOT IN ('BLOOD', 'ORGAN') THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '22023',
                MESSAGE = 'Donation type must be BLOOD or ORGAN';
    END IF;

    p_donation_type := upper(btrim(p_donation_type));

    IF p_donation_date IS NULL OR p_donation_date > CURRENT_DATE THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '22023',
                MESSAGE = 'Donation date is required and cannot be in the future';
    END IF;

    SELECT
        ua.role,
        ua.status,
        ua.blood_bank_id,
        ua.organ_bank_id
    INTO
        v_actor_role,
        v_actor_status,
        v_actor_blood_bank_id,
        v_actor_organ_bank_id
    FROM user_account AS ua
    WHERE ua.user_id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23503',
                MESSAGE = format('Application user %s does not exist', p_user_id);
    END IF;

    IF v_actor_status <> 'ACTIVE' THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '42501',
                MESSAGE = 'Only an ACTIVE application user may register a donation';
    END IF;

    SELECT
        d.blood_group,
        d.weight_kg,
        d.is_active,
        p.date_of_birth
    INTO
        v_donor_blood_group,
        v_donor_weight,
        v_donor_active,
        v_donor_date_of_birth
    FROM donor AS d
    JOIN person AS p
        ON p.person_id = d.donor_id
    WHERE d.donor_id = p_donor_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23503',
                MESSAGE = format('Donor %s does not exist', p_donor_id);
    END IF;

    IF NOT v_donor_active THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'An inactive donor cannot register a donation';
    END IF;

    IF p_camp_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM donation_camp AS dc
           WHERE dc.camp_id = p_camp_id
             AND dc.camp_date = p_donation_date
             AND dc.status <> 'CANCELLED'
       ) THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'Camp must exist, match the donation date, and not be cancelled';
    END IF;

    IF p_donation_type = 'BLOOD' THEN
        IF v_actor_role NOT IN ('ADMIN', 'BLOOD_BANK_STAFF')
           OR (
               v_actor_role = 'BLOOD_BANK_STAFF'
               AND v_actor_blood_bank_id IS DISTINCT FROM p_collection_bank_id
           ) THEN
            RAISE EXCEPTION
                USING
                    ERRCODE = '42501',
                    MESSAGE = 'User is not authorized for this blood bank';
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM blood_bank AS bb
            WHERE bb.blood_bank_id = p_collection_bank_id
              AND bb.status = 'ACTIVE'
        ) THEN
            RAISE EXCEPTION
                USING
                    ERRCODE = '23514',
                    MESSAGE = 'Collection blood bank must exist and be ACTIVE';
        END IF;

        IF p_quantity_collected_ml IS NULL
           OR p_expiry_date IS NULL
           OR p_organ_type IS NOT NULL THEN
            RAISE EXCEPTION
                USING
                    ERRCODE = '22023',
                    MESSAGE = 'BLOOD requires quantity and expiry, and must not specify organ type';
        END IF;

        IF p_expiry_date <= p_donation_date THEN
            RAISE EXCEPTION
                USING
                    ERRCODE = '23514',
                    MESSAGE = 'Blood-unit expiry date must be after donation date';
        END IF;

        IF EXTRACT(YEAR FROM AGE(p_donation_date, v_donor_date_of_birth)) NOT BETWEEN 18 AND 65
           OR v_donor_weight < 50
           OR EXISTS (
               SELECT 1
               FROM donor_condition AS dc
               WHERE dc.donor_id = p_donor_id
                 AND dc.condition_status = 'ACTIVE'
           )
           OR EXISTS (
               SELECT 1
               FROM donation AS dn
               WHERE dn.donor_id = p_donor_id
                 AND dn.donation_type = 'BLOOD'
                 AND dn.record_status = 'ACTIVE'
                 AND dn.donation_date > p_donation_date - 90
                 AND dn.donation_date <= p_donation_date
           ) THEN
            RAISE EXCEPTION
                USING
                    ERRCODE = '23514',
                    MESSAGE = 'Donor does not satisfy the simplified academic blood-donation rule';
        END IF;

        INSERT INTO donation (
            donor_id,
            camp_id,
            donation_date,
            donation_type,
            record_status
        )
        VALUES (
            p_donor_id,
            p_camp_id,
            p_donation_date,
            'BLOOD',
            'ACTIVE'
        )
        RETURNING donation.donation_id
        INTO v_donation_id;

        INSERT INTO blood_donation (
            donation_id,
            collection_bank_id,
            quantity_collected_ml,
            notes
        )
        VALUES (
            v_donation_id,
            p_collection_bank_id,
            p_quantity_collected_ml,
            p_notes
        );

        INSERT INTO blood_unit (
            donation_id,
            current_blood_bank_id,
            blood_group,
            expiry_date,
            status
        )
        VALUES (
            v_donation_id,
            p_collection_bank_id,
            v_donor_blood_group,
            p_expiry_date,
            'COLLECTED'
        )
        RETURNING blood_unit.blood_unit_id
        INTO v_blood_unit_id;

        v_unit_status := 'COLLECTED';
    ELSE
        IF v_actor_role NOT IN ('ADMIN', 'ORGAN_BANK_STAFF')
           OR (
               v_actor_role = 'ORGAN_BANK_STAFF'
               AND v_actor_organ_bank_id IS DISTINCT FROM p_collection_bank_id
           ) THEN
            RAISE EXCEPTION
                USING
                    ERRCODE = '42501',
                    MESSAGE = 'User is not authorized for this organ bank';
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM organ_bank AS ob
            WHERE ob.organ_bank_id = p_collection_bank_id
              AND ob.status = 'ACTIVE'
        ) THEN
            RAISE EXCEPTION
                USING
                    ERRCODE = '23514',
                    MESSAGE = 'Collection organ bank must exist and be ACTIVE';
        END IF;

        IF p_organ_type IS NULL
           OR btrim(p_organ_type) = ''
           OR p_quantity_collected_ml IS NOT NULL
           OR p_expiry_date IS NOT NULL THEN
            RAISE EXCEPTION
                USING
                    ERRCODE = '22023',
                    MESSAGE = 'ORGAN requires organ type, and must not specify blood quantity or expiry';
        END IF;

        INSERT INTO donation (
            donor_id,
            camp_id,
            donation_date,
            donation_type,
            record_status
        )
        VALUES (
            p_donor_id,
            p_camp_id,
            p_donation_date,
            'ORGAN',
            'ACTIVE'
        )
        RETURNING donation.donation_id
        INTO v_donation_id;

        INSERT INTO organ_donation (
            donation_id,
            collection_organ_bank_id,
            notes
        )
        VALUES (
            v_donation_id,
            p_collection_bank_id,
            p_notes
        );

        INSERT INTO organ_unit (
            donation_id,
            current_organ_bank_id,
            organ_type,
            status
        )
        VALUES (
            v_donation_id,
            p_collection_bank_id,
            upper(btrim(p_organ_type)),
            'AVAILABLE'
        )
        RETURNING organ_unit.organ_unit_id
        INTO v_organ_unit_id;

        v_unit_status := 'AVAILABLE';
    END IF;

    PERFORM set_config('lifelink.app_user_id', p_user_id::TEXT, TRUE);

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
        p_user_id,
        'donation',
        v_donation_id::TEXT,
        'DONATION_REGISTERED',
        NULL,
        'ACTIVE',
        format(
            '%s donation registered; blood unit=%s, organ unit=%s.',
            p_donation_type,
            COALESCE(v_blood_unit_id::TEXT, 'none'),
            COALESCE(v_organ_unit_id::TEXT, 'none')
        )
    );

    RETURN QUERY
    SELECT
        v_donation_id,
        v_blood_unit_id,
        v_organ_unit_id,
        v_unit_status;
END;
$function$;

COMMENT ON FUNCTION register_donation(
    INTEGER, VARCHAR, INTEGER, INTEGER, DATE, INTEGER, INTEGER, DATE, VARCHAR, TEXT
) IS
    'Atomically registers one complete blood or organ donation and its initial unit.';

-- ========================================================================== 
-- 2. Atomically reserve the best emergency blood unit
-- ========================================================================== 
-- Purpose:
--   Implement the project's mandatory transaction/concurrency workflow.
--   The request row and FEFO candidate unit are row-locked. A caller must not
--   perform separate frontend SELECT and UPDATE statements.
--
-- Parameters:
--   p_request_id  BLOOD emergency request to fulfil.
--   p_user_id     ACTIVE ADMIN or staff member of the candidate blood bank.
--   p_hold_minutes reservation duration, from 5 through 1440 minutes.
--
-- Returns:
--   Reservation/unit identifiers, bank/group, hold timestamps, and new request
--   status.
--
-- Exact-group academic rule:
--   This implementation deliberately uses exact ABO/Rh group matching. It
--   does not claim clinical compatibility logic.
--
-- Example call:
--   SELECT * FROM lifelink.reserve_emergency_blood(9, 8, 120);

CREATE OR REPLACE FUNCTION reserve_emergency_blood(
    p_request_id INTEGER,
    p_user_id INTEGER,
    p_hold_minutes INTEGER DEFAULT 120
)
RETURNS TABLE (
    reservation_id INTEGER,
    request_id INTEGER,
    blood_unit_id INTEGER,
    blood_group VARCHAR(3),
    blood_bank_id INTEGER,
    reserved_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    request_status VARCHAR(30)
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = lifelink, pg_temp
AS $function$
DECLARE
    v_actor_role VARCHAR(30);
    v_actor_status VARCHAR(20);
    v_actor_blood_bank_id INTEGER;
    v_request_type VARCHAR(10);
    v_requested_blood_group VARCHAR(3);
    v_units_required SMALLINT;
    v_old_request_status VARCHAR(30);
    v_new_request_status VARCHAR(30);
    v_allocated_count INTEGER;
    v_blood_unit_id INTEGER;
    v_blood_bank_id INTEGER;
    v_unit_blood_group VARCHAR(3);
    v_reservation_id INTEGER;
    v_reserved_at TIMESTAMPTZ;
    v_expires_at TIMESTAMPTZ;
    v_updated_rows INTEGER;
BEGIN
    IF p_hold_minutes IS NULL OR p_hold_minutes NOT BETWEEN 5 AND 1440 THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '22023',
                MESSAGE = 'Reservation hold must be between 5 and 1440 minutes';
    END IF;

    SELECT
        ua.role,
        ua.status,
        ua.blood_bank_id
    INTO
        v_actor_role,
        v_actor_status,
        v_actor_blood_bank_id
    FROM user_account AS ua
    WHERE ua.user_id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23503',
                MESSAGE = format('Application user %s does not exist', p_user_id);
    END IF;

    IF v_actor_status <> 'ACTIVE'
       OR v_actor_role NOT IN ('ADMIN', 'BLOOD_BANK_STAFF') THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '42501',
                MESSAGE = 'Only ACTIVE blood-bank staff or an administrator may reserve blood';
    END IF;

    -- Locking the request serializes simultaneous attempts to fulfil the same
    -- request and prevents its required-unit count from being exceeded.
    SELECT
        er.request_type,
        er.blood_group,
        er.units_required,
        er.status
    INTO
        v_request_type,
        v_requested_blood_group,
        v_units_required,
        v_old_request_status
    FROM emergency_request AS er
    WHERE er.request_id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23503',
                MESSAGE = format('Emergency request %s does not exist', p_request_id);
    END IF;

    IF v_request_type <> 'BLOOD' THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'Only a BLOOD request can use emergency blood reservation';
    END IF;

    IF v_old_request_status NOT IN ('PENDING', 'PARTIALLY_RESERVED') THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = format(
                    'Request status %s does not allow another reservation',
                    v_old_request_status
                );
    END IF;

    SELECT COUNT(*)::INTEGER
    INTO v_allocated_count
    FROM blood_reservation AS br
    WHERE br.request_id = p_request_id
      AND br.status IN ('ACTIVE', 'COMPLETED');

    IF v_allocated_count >= v_units_required THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = format(
                    'Request %s already has all %s required units allocated',
                    p_request_id,
                    v_units_required
                );
    END IF;

    v_expires_at := CURRENT_TIMESTAMP
        + (p_hold_minutes * INTERVAL '1 minute');

    -- FEFO: earliest valid expiry first. FOR UPDATE protects the selected unit
    -- until this function's caller commits or rolls back.
    SELECT
        bu.blood_unit_id,
        bu.current_blood_bank_id,
        bu.blood_group
    INTO
        v_blood_unit_id,
        v_blood_bank_id,
        v_unit_blood_group
    FROM blood_unit AS bu
    JOIN blood_bank AS bb
        ON bb.blood_bank_id = bu.current_blood_bank_id
    JOIN blood_donation AS bd
        ON bd.donation_id = bu.donation_id
    JOIN donation AS dn
        ON dn.donation_id = bd.donation_id
    WHERE bu.blood_group = v_requested_blood_group
      AND bu.status = 'AVAILABLE'
      AND bu.expiry_date >= v_expires_at::DATE
      AND bb.status = 'ACTIVE'
      AND dn.record_status = 'ACTIVE'
      AND (
          v_actor_role = 'ADMIN'
          OR bu.current_blood_bank_id = v_actor_blood_bank_id
      )
      AND EXISTS (
          SELECT 1
          FROM medical_test_result AS mtr
          WHERE mtr.donation_id = bu.donation_id
      )
      AND NOT EXISTS (
          SELECT 1
          FROM medical_test_result AS mtr
          WHERE mtr.donation_id = bu.donation_id
            AND mtr.result <> 'PASS'
      )
      AND NOT EXISTS (
          SELECT 1
          FROM blood_reservation AS br
          WHERE br.blood_unit_id = bu.blood_unit_id
            AND br.status = 'ACTIVE'
      )
    ORDER BY bu.expiry_date, bu.blood_unit_id
    LIMIT 1
    FOR UPDATE OF bu;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            USING
                ERRCODE = 'P0002',
                MESSAGE = format(
                    'No reservable %s blood unit is available to this user',
                    v_requested_blood_group
                );
    END IF;

    PERFORM set_config('lifelink.app_user_id', p_user_id::TEXT, TRUE);

    -- Reservation must be inserted before AVAILABLE -> RESERVED because the
    -- lifecycle trigger requires a corresponding ACTIVE reservation.
    INSERT INTO blood_reservation AS br (
        request_id,
        blood_unit_id,
        expires_at,
        status,
        created_by
    )
    VALUES (
        p_request_id,
        v_blood_unit_id,
        v_expires_at,
        'ACTIVE',
        p_user_id
    )
    RETURNING br.reservation_id, br.reserved_at
    INTO v_reservation_id, v_reserved_at;

    UPDATE blood_unit AS bu
    SET status = 'RESERVED'
    WHERE bu.blood_unit_id = v_blood_unit_id
      AND bu.status = 'AVAILABLE';

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

    IF v_updated_rows <> 1 THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '40001',
                MESSAGE = 'Selected blood unit changed before reservation completed; retry';
    END IF;

    SELECT COUNT(*)::INTEGER
    INTO v_allocated_count
    FROM blood_reservation AS br
    WHERE br.request_id = p_request_id
      AND br.status IN ('ACTIVE', 'COMPLETED');

    v_new_request_status := CASE
        WHEN v_allocated_count >= v_units_required THEN 'RESERVED'
        ELSE 'PARTIALLY_RESERVED'
    END;

    UPDATE emergency_request AS er
    SET status = v_new_request_status
    WHERE er.request_id = p_request_id;

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
        p_user_id,
        'emergency_request',
        p_request_id::TEXT,
        'RESERVATION_PROGRESS',
        v_old_request_status,
        v_new_request_status,
        format(
            'Reservation %s allocated blood unit %s; %s of %s units are now allocated.',
            v_reservation_id,
            v_blood_unit_id,
            v_allocated_count,
            v_units_required
        )
    );

    RETURN QUERY
    SELECT
        v_reservation_id,
        p_request_id,
        v_blood_unit_id,
        v_unit_blood_group,
        v_blood_bank_id,
        v_reserved_at,
        v_expires_at,
        v_new_request_status;
END;
$function$;

COMMENT ON FUNCTION reserve_emergency_blood(INTEGER, INTEGER, INTEGER) IS
    'Atomically locks and reserves the FEFO exact-group blood unit for an emergency request.';

-- ========================================================================== 
-- 3. Release reservation holds whose timestamps have expired
-- ========================================================================== 
-- Purpose:
--   Batch maintenance operation. ACTIVE holds at or before the current time
--   become EXPIRED. A still-usable unit returns to AVAILABLE; a unit whose
--   blood expiry date has passed becomes EXPIRED. Request progress is then
--   recalculated. Existing audit triggers record reservation and unit changes.
--
-- Parameters:
--   p_user_id must be an ACTIVE ADMIN or BLOOD_BANK_STAFF user. Staff process
--   only units at their own bank. INOUT counters are returned by CALL.
--
-- Example call:
--   CALL lifelink.release_expired_reservations(3);

CREATE OR REPLACE PROCEDURE release_expired_reservations(
    IN p_user_id INTEGER,
    INOUT p_released_reservation_count INTEGER DEFAULT 0,
    INOUT p_returned_available_count INTEGER DEFAULT 0,
    INOUT p_expired_unit_count INTEGER DEFAULT 0
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = lifelink, pg_temp
AS $procedure$
DECLARE
    v_actor_role VARCHAR(30);
    v_actor_status VARCHAR(20);
    v_actor_blood_bank_id INTEGER;
    v_row RECORD;
    v_new_unit_status VARCHAR(20);
    v_old_request_status VARCHAR(30);
    v_new_request_status VARCHAR(30);
    v_allocated_count INTEGER;
    v_updated_rows INTEGER;
BEGIN
    SELECT
        ua.role,
        ua.status,
        ua.blood_bank_id
    INTO
        v_actor_role,
        v_actor_status,
        v_actor_blood_bank_id
    FROM user_account AS ua
    WHERE ua.user_id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23503',
                MESSAGE = format('Application user %s does not exist', p_user_id);
    END IF;

    IF v_actor_status <> 'ACTIVE'
       OR v_actor_role NOT IN ('ADMIN', 'BLOOD_BANK_STAFF') THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '42501',
                MESSAGE = 'Only ACTIVE blood-bank staff or an administrator may release holds';
    END IF;

    p_released_reservation_count := 0;
    p_returned_available_count := 0;
    p_expired_unit_count := 0;

    PERFORM set_config('lifelink.app_user_id', p_user_id::TEXT, TRUE);

    FOR v_row IN
        SELECT
            br.reservation_id,
            br.request_id,
            br.blood_unit_id,
            bu.status AS unit_status,
            bu.expiry_date,
            er.units_required
        FROM blood_reservation AS br
        JOIN blood_unit AS bu
            ON bu.blood_unit_id = br.blood_unit_id
        JOIN emergency_request AS er
            ON er.request_id = br.request_id
        WHERE br.status = 'ACTIVE'
          AND br.expires_at <= CURRENT_TIMESTAMP
          AND (
              v_actor_role = 'ADMIN'
              OR bu.current_blood_bank_id = v_actor_blood_bank_id
          )
        ORDER BY br.expires_at, br.reservation_id
        FOR UPDATE OF br, bu, er
    LOOP
        -- ACTIVE must become terminal before RESERVED can return to AVAILABLE.
        UPDATE blood_reservation AS br
        SET status = 'EXPIRED'
        WHERE br.reservation_id = v_row.reservation_id
          AND br.status = 'ACTIVE';

        GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

        IF v_updated_rows <> 1 THEN
            CONTINUE;
        END IF;

        p_released_reservation_count := p_released_reservation_count + 1;

        IF v_row.unit_status = 'RESERVED' THEN
            v_new_unit_status := CASE
                WHEN v_row.expiry_date < CURRENT_DATE THEN 'EXPIRED'
                ELSE 'AVAILABLE'
            END;

            UPDATE blood_unit AS bu
            SET status = v_new_unit_status
            WHERE bu.blood_unit_id = v_row.blood_unit_id
              AND bu.status = 'RESERVED';

            GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

            IF v_updated_rows = 1 AND v_new_unit_status = 'AVAILABLE' THEN
                p_returned_available_count := p_returned_available_count + 1;
            ELSIF v_updated_rows = 1 AND v_new_unit_status = 'EXPIRED' THEN
                p_expired_unit_count := p_expired_unit_count + 1;
            END IF;
        END IF;

        SELECT er.status
        INTO v_old_request_status
        FROM emergency_request AS er
        WHERE er.request_id = v_row.request_id;

        -- A stale hold is always released, but a terminal request must never
        -- be reopened merely because maintenance processed that hold.
        IF v_old_request_status IN ('PENDING', 'PARTIALLY_RESERVED', 'RESERVED') THEN
            SELECT COUNT(*)::INTEGER
            INTO v_allocated_count
            FROM blood_reservation AS br
            WHERE br.request_id = v_row.request_id
              AND br.status IN ('ACTIVE', 'COMPLETED');

            v_new_request_status := CASE
                WHEN v_allocated_count = 0 THEN 'PENDING'
                WHEN v_allocated_count < v_row.units_required THEN 'PARTIALLY_RESERVED'
                ELSE 'RESERVED'
            END;

            IF v_new_request_status IS DISTINCT FROM v_old_request_status THEN
                UPDATE emergency_request AS er
                SET status = v_new_request_status
                WHERE er.request_id = v_row.request_id;

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
                    p_user_id,
                    'emergency_request',
                    v_row.request_id::TEXT,
                    'RESERVATION_EXPIRED',
                    v_old_request_status,
                    v_new_request_status,
                    format(
                        'Reservation %s expired; %s of %s units remain allocated.',
                        v_row.reservation_id,
                        v_allocated_count,
                        v_row.units_required
                    )
                );
            END IF;
        END IF;
    END LOOP;
END;
$procedure$;

COMMENT ON PROCEDURE release_expired_reservations(INTEGER, INTEGER, INTEGER, INTEGER) IS
    'Expires elapsed ACTIVE holds, safely releases their units, and recalculates request progress.';

-- ========================================================================== 
-- 4. Calculate one transparent academic organ match
-- ========================================================================== 
-- Purpose:
--   Insert or recalculate a CANDIDATE organ_match. Only compatibility_score is
--   stored because urgency, waiting time, final priority, and rank are derived
--   by organ_match_priority_view.
--
-- Formula returned by the view:
--   0.50 * compatibility + 0.30 * urgency + 0.20 * waiting time
--
-- Parameters:
--   Request, organ unit, academic compatibility score (0..100), and actor.
--
-- Returns:
--   All explainable score components, final academic priority, and rank.
--   This is an academic demonstration, not clinical transplant guidance.
--
-- Example call:
--   SELECT * FROM lifelink.calculate_organ_match(10, 1, 93.00, 4);

CREATE OR REPLACE FUNCTION calculate_organ_match(
    p_request_id INTEGER,
    p_organ_unit_id INTEGER,
    p_compatibility_score NUMERIC(5,2),
    p_user_id INTEGER
)
RETURNS TABLE (
    match_id INTEGER,
    request_id INTEGER,
    organ_unit_id INTEGER,
    compatibility_score NUMERIC,
    urgency_score NUMERIC,
    waiting_time_score NUMERIC,
    academic_priority_score NUMERIC,
    candidate_rank BIGINT,
    match_status VARCHAR(20),
    calculated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = lifelink, pg_temp
AS $function$
DECLARE
    v_actor_role VARCHAR(30);
    v_actor_status VARCHAR(20);
    v_actor_organ_bank_id INTEGER;
    v_request_type VARCHAR(10);
    v_request_organ_type VARCHAR(50);
    v_request_status VARCHAR(30);
    v_unit_organ_type VARCHAR(50);
    v_unit_status VARCHAR(20);
    v_unit_bank_id INTEGER;
    v_match_id INTEGER;
    v_existing_status VARCHAR(20);
BEGIN
    IF p_compatibility_score IS NULL
       OR p_compatibility_score < 0
       OR p_compatibility_score > 100 THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '22023',
                MESSAGE = 'Academic compatibility score must be from 0 through 100';
    END IF;

    SELECT
        ua.role,
        ua.status,
        ua.organ_bank_id
    INTO
        v_actor_role,
        v_actor_status,
        v_actor_organ_bank_id
    FROM user_account AS ua
    WHERE ua.user_id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23503',
                MESSAGE = format('Application user %s does not exist', p_user_id);
    END IF;

    IF v_actor_status <> 'ACTIVE'
       OR v_actor_role NOT IN ('ADMIN', 'ORGAN_BANK_STAFF') THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '42501',
                MESSAGE = 'Only ACTIVE organ-bank staff or an administrator may calculate matches';
    END IF;

    SELECT
        er.request_type,
        er.organ_type,
        er.status,
        ou.organ_type,
        ou.status,
        ou.current_organ_bank_id
    INTO
        v_request_type,
        v_request_organ_type,
        v_request_status,
        v_unit_organ_type,
        v_unit_status,
        v_unit_bank_id
    FROM emergency_request AS er
    CROSS JOIN organ_unit AS ou
    WHERE er.request_id = p_request_id
      AND ou.organ_unit_id = p_organ_unit_id
    FOR UPDATE OF er, ou;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23503',
                MESSAGE = 'Organ request or organ unit does not exist';
    END IF;

    IF v_request_type <> 'ORGAN'
       OR v_request_status NOT IN ('PENDING', 'MATCHED') THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'An active ORGAN request is required for candidate calculation';
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

    IF v_unit_status NOT IN ('AVAILABLE', 'MATCHING') THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                MESSAGE = 'Candidate calculation requires an AVAILABLE or MATCHING organ unit';
    END IF;

    IF v_actor_role = 'ORGAN_BANK_STAFF'
       AND v_actor_organ_bank_id IS DISTINCT FROM v_unit_bank_id THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '42501',
                MESSAGE = 'User is not authorized for the organ unit bank';
    END IF;

    SELECT
        om.match_id,
        om.match_status
    INTO
        v_match_id,
        v_existing_status
    FROM organ_match AS om
    WHERE om.request_id = p_request_id
      AND om.organ_unit_id = p_organ_unit_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_status <> 'CANDIDATE' THEN
            RAISE EXCEPTION
                USING
                    ERRCODE = '23514',
                    MESSAGE = format(
                        'A %s match cannot be recalculated as a candidate',
                        v_existing_status
                    );
        END IF;

        UPDATE organ_match AS om
        SET compatibility_score = p_compatibility_score,
            calculated_at = CURRENT_TIMESTAMP
        WHERE om.match_id = v_match_id;
    ELSE
        INSERT INTO organ_match AS om (
            request_id,
            organ_unit_id,
            compatibility_score,
            match_status,
            calculated_at
        )
        VALUES (
            p_request_id,
            p_organ_unit_id,
            p_compatibility_score,
            'CANDIDATE',
            CURRENT_TIMESTAMP
        )
        RETURNING om.match_id
        INTO v_match_id;
    END IF;

    PERFORM set_config('lifelink.app_user_id', p_user_id::TEXT, TRUE);

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
        p_user_id,
        'organ_match',
        v_match_id::TEXT,
        'ACADEMIC_MATCH_CALCULATED',
        v_existing_status,
        'CANDIDATE',
        format(
            'Request %s and organ unit %s calculated with compatibility score %s.',
            p_request_id,
            p_organ_unit_id,
            p_compatibility_score
        )
    );

    RETURN QUERY
    SELECT
        omp.match_id,
        omp.request_id,
        omp.organ_unit_id,
        omp.compatibility_score,
        omp.urgency_score,
        omp.waiting_time_score,
        omp.final_priority,
        omp.candidate_rank,
        omp.match_status,
        omp.calculated_at
    FROM organ_match_priority_view AS omp
    WHERE omp.match_id = v_match_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            USING
                ERRCODE = 'P0001',
                MESSAGE = 'Calculated match was not exposed by the academic priority view';
    END IF;
END;
$function$;

COMMENT ON FUNCTION calculate_organ_match(INTEGER, INTEGER, NUMERIC, INTEGER) IS
    'Stores one compatibility fact and returns transparent derived academic organ-priority components.';

-- ========================================================================== 
-- 5. Parameterized blood inventory report
-- ========================================================================== 
-- Purpose:
--   Return grouped unit-level inventory for all banks or optional bank, group,
--   and status filters. This complements the fixed project views.
--
-- Parameters:
--   Any filter may be NULL. Non-NULL values are validated.
--
-- Returns:
--   Count by bank/group/status, usable AVAILABLE count, active reservations,
--   expiry range, and units expiring in the next seven days.
--
-- Example calls:
--   SELECT * FROM lifelink.generate_inventory_report();
--   SELECT * FROM lifelink.generate_inventory_report(2, 'AB-', NULL);

CREATE OR REPLACE FUNCTION generate_inventory_report(
    p_blood_bank_id INTEGER DEFAULT NULL,
    p_blood_group VARCHAR(3) DEFAULT NULL,
    p_status VARCHAR(20) DEFAULT NULL
)
RETURNS TABLE (
    blood_bank_id INTEGER,
    blood_bank_name VARCHAR(150),
    bank_status VARCHAR(20),
    blood_group VARCHAR(3),
    unit_status VARCHAR(20),
    unit_count BIGINT,
    usable_available_count BIGINT,
    active_reservation_count BIGINT,
    earliest_expiry_date DATE,
    latest_expiry_date DATE,
    expiring_within_7_days BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = lifelink, pg_temp
AS $function$
BEGIN
    IF p_blood_bank_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM blood_bank AS bb
           WHERE bb.blood_bank_id = p_blood_bank_id
       ) THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '22023',
                MESSAGE = format('Blood bank %s does not exist', p_blood_bank_id);
    END IF;

    IF p_blood_group IS NOT NULL
       AND p_blood_group NOT IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-') THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '22023',
                MESSAGE = format('Invalid blood group: %s', p_blood_group);
    END IF;

    IF p_status IS NOT NULL
       AND p_status NOT IN (
           'COLLECTED',
           'TESTING',
           'AVAILABLE',
           'RESERVED',
           'ISSUED',
           'REJECTED',
           'EXPIRED'
       ) THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '22023',
                MESSAGE = format('Invalid blood-unit status: %s', p_status);
    END IF;

    RETURN QUERY
    SELECT
        bb.blood_bank_id,
        bb.name,
        bb.status,
        bu.blood_group,
        bu.status,
        COUNT(*) AS unit_count,
        COUNT(*) FILTER (
            WHERE bu.status = 'AVAILABLE'
              AND bu.expiry_date >= CURRENT_DATE
              AND dn.record_status = 'ACTIVE'
              AND bb.status = 'ACTIVE'
              AND EXISTS (
                  SELECT 1
                  FROM medical_test_result AS mtr
                  WHERE mtr.donation_id = bu.donation_id
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM medical_test_result AS mtr
                  WHERE mtr.donation_id = bu.donation_id
                    AND mtr.result <> 'PASS'
              )
        ) AS usable_available_count,
        COUNT(*) FILTER (
            WHERE EXISTS (
                SELECT 1
                FROM blood_reservation AS br
                WHERE br.blood_unit_id = bu.blood_unit_id
                  AND br.status = 'ACTIVE'
            )
        ) AS active_reservation_count,
        MIN(bu.expiry_date) AS earliest_expiry_date,
        MAX(bu.expiry_date) AS latest_expiry_date,
        COUNT(*) FILTER (
            WHERE bu.status = 'AVAILABLE'
              AND bu.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
        ) AS expiring_within_7_days
    FROM blood_unit AS bu
    JOIN blood_bank AS bb
        ON bb.blood_bank_id = bu.current_blood_bank_id
    JOIN donation AS dn
        ON dn.donation_id = bu.donation_id
    WHERE (p_blood_bank_id IS NULL OR bb.blood_bank_id = p_blood_bank_id)
      AND (p_blood_group IS NULL OR bu.blood_group = p_blood_group)
      AND (p_status IS NULL OR bu.status = p_status)
    GROUP BY
        bb.blood_bank_id,
        bb.name,
        bb.status,
        bu.blood_group,
        bu.status
    ORDER BY
        bb.name,
        bu.blood_group,
        bu.status;
END;
$function$;

COMMENT ON FUNCTION generate_inventory_report(INTEGER, VARCHAR, VARCHAR) IS
    'Returns validated, parameterized blood inventory grouped by bank, group, and lifecycle status.';

COMMIT;

/*
 * Suggested independent test cases (run in a disposable database or inside a
 * transaction that is rolled back):
 *
 * 1. register_donation:
 *      - valid BLOOD call creates parent + subtype + COLLECTED unit;
 *      - inactive donor 12 is rejected.
 *
 * 2. reserve_emergency_blood:
 *      - request 9 and user 8 reserve only AB- unit 12;
 *      - a second attempt safely fails and cannot create a duplicate hold.
 *
 * 3. release_expired_reservations:
 *      - an elapsed ACTIVE hold becomes EXPIRED;
 *      - its unexpired RESERVED unit returns to AVAILABLE.
 *
 * 4. calculate_organ_match:
 *      - request 10, organ unit 1, score 93, user 4 returns all components;
 *      - a KIDNEY request paired with organ unit 4 (CORNEA) is rejected.
 *
 * 5. generate_inventory_report:
 *      - bank 2 / AB- returns the deterministic concurrency-case unit;
 *      - an invalid blood group is rejected.
 */
