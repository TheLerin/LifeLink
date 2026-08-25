/*
 * LifeLink — Multi-Hospital Blood and Organ Allocation System
 * Phase 13: SQL syllabus demonstrations and executable test suite
 *
 * Prerequisites (run in order):
 *   01_schema.sql
 *   02_constraints.sql
 *   03_sample_data.sql
 *   04_views.sql
 *   05_trigger_functions.sql
 *   06_triggers.sql
 *   07_functions_procedures.sql
 *   08_indexes.sql
 *   09_roles_permissions.sql
 *
 * Run this file as the LifeLink schema owner in a demonstration database.
 * It is deliberately plain PostgreSQL SQL: no psql-only variables or meta
 * commands are required.
 *
 * Safety model
 * --------------------------------------------------------------------------
 *   - Sections 1 and 2 are read-only.
 *   - Every successful DML/routine demonstration is enclosed by ROLLBACK.
 *   - Expected failures run inside PL/pgSQL exception subtransactions and are
 *     considered PASS only when the documented SQLSTATE is raised.
 *   - PostgreSQL sequences are non-transactional. The four sequences touched
 *     by rollback tests are therefore snapshotted and restored explicitly.
 *   - All names and records are fictional. No real passwords appear here.
 *   - The real two-session last-unit race belongs in 11_concurrency_demo.sql;
 *     it cannot be proved by a single sequential session.
 */

SET search_path TO lifelink, public;

-- ========================================================================== 
-- 0. Installation and deterministic-demo preflight
-- ========================================================================== 

DO $preflight$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*)::INTEGER
    INTO v_count
    FROM information_schema.tables
    WHERE table_schema = 'lifelink'
      AND table_type = 'BASE TABLE';

    IF v_count <> 24 THEN
        RAISE EXCEPTION 'Preflight failed: expected 24 base tables, found %', v_count;
    END IF;

    SELECT COUNT(*)::INTEGER
    INTO v_count
    FROM information_schema.views
    WHERE table_schema = 'lifelink';

    IF v_count <> 5 THEN
        RAISE EXCEPTION 'Preflight failed: expected 5 views, found %', v_count;
    END IF;

    SELECT COUNT(*)::INTEGER
    INTO v_count
    FROM pg_trigger AS t
    JOIN pg_class AS c
        ON c.oid = t.tgrelid
    JOIN pg_namespace AS n
        ON n.oid = c.relnamespace
    WHERE n.nspname = 'lifelink'
      AND NOT t.tgisinternal;

    IF v_count <> 14 THEN
        RAISE EXCEPTION 'Preflight failed: expected 14 attached triggers, found %', v_count;
    END IF;

    SELECT COUNT(*)::INTEGER
    INTO v_count
    FROM pg_proc AS p
    JOIN pg_namespace AS n
        ON n.oid = p.pronamespace
    WHERE n.nspname = 'lifelink'
      AND p.proname IN (
          'register_donation',
          'reserve_emergency_blood',
          'release_expired_reservations',
          'calculate_organ_match',
          'generate_inventory_report'
      );

    IF v_count <> 5 THEN
        RAISE EXCEPTION 'Preflight failed: expected 5 business routines, found %', v_count;
    END IF;

    SELECT COUNT(*)::INTEGER
    INTO v_count
    FROM pg_class AS c
    JOIN pg_namespace AS n
        ON n.oid = c.relnamespace
    WHERE n.nspname = 'lifelink'
      AND c.relkind = 'i'
      AND c.relname IN (
          'idx_blood_unit_available_fefo',
          'idx_blood_unit_bank_status_group_expiry',
          'idx_emergency_request_active_priority',
          'idx_emergency_request_requester_active',
          'idx_organ_unit_type_status',
          'idx_blood_reservation_request_status',
          'idx_blood_reservation_active_expiry',
          'idx_organ_match_rank_source',
          'idx_donation_donor_type_date',
          'idx_audit_log_entity_time'
      );

    IF v_count <> 10 THEN
        RAISE EXCEPTION 'Preflight failed: expected 10 workload indexes, found %', v_count;
    END IF;

    SELECT COUNT(*)::INTEGER
    INTO v_count
    FROM pg_roles
    WHERE rolname IN (
        'lifelink_admin',
        'lifelink_doctor',
        'lifelink_blood_bank_staff',
        'lifelink_organ_bank_staff',
        'lifelink_donor',
        'lifelink_recipient'
    );

    IF v_count <> 6 THEN
        RAISE EXCEPTION 'Preflight failed: expected 6 LifeLink group roles, found %', v_count;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM blood_unit WHERE blood_unit_id = 7 AND status = 'TESTING'
    ) OR NOT EXISTS (
        SELECT 1 FROM blood_unit WHERE blood_unit_id = 8 AND status = 'REJECTED'
    ) OR NOT EXISTS (
        SELECT 1 FROM blood_unit WHERE blood_unit_id = 9 AND status = 'EXPIRED'
    ) OR NOT EXISTS (
        SELECT 1 FROM blood_unit WHERE blood_unit_id = 12 AND status = 'AVAILABLE'
    ) OR NOT EXISTS (
        SELECT 1 FROM blood_unit WHERE blood_unit_id = 15 AND status = 'COLLECTED'
    ) OR NOT EXISTS (
        SELECT 1 FROM emergency_request WHERE request_id = 9 AND status = 'PENDING'
    ) THEN
        RAISE EXCEPTION
            'Preflight failed: the required deterministic edge-case rows are not in their seed states';
    END IF;

    RAISE NOTICE 'PRECHECK PASS — schema, views, routines, triggers, indexes, roles, and edge rows found';
END;
$preflight$;

-- Rollback does not rewind sequences in PostgreSQL. Capture the sequences that
-- later successful routine tests will touch, then restore them in section 6.

CREATE TEMPORARY TABLE lifelink_test_sequence_state (
    sequence_name TEXT PRIMARY KEY,
    last_value BIGINT NOT NULL,
    is_called BOOLEAN NOT NULL
) ON COMMIT PRESERVE ROWS;

INSERT INTO lifelink_test_sequence_state (sequence_name, last_value, is_called)
SELECT 'lifelink.donation_donation_id_seq', last_value, is_called
FROM lifelink.donation_donation_id_seq
UNION ALL
SELECT 'lifelink.blood_unit_blood_unit_id_seq', last_value, is_called
FROM lifelink.blood_unit_blood_unit_id_seq
UNION ALL
SELECT 'lifelink.blood_reservation_reservation_id_seq', last_value, is_called
FROM lifelink.blood_reservation_reservation_id_seq
UNION ALL
SELECT 'lifelink.audit_log_audit_id_seq', last_value, is_called
FROM lifelink.audit_log_audit_id_seq;

-- ========================================================================== 
-- 1. Required beginner-to-advanced SQL syllabus demonstrations
-- ========================================================================== 

-- Q01 — SELECT: all fictional donors with their person attributes.
SELECT
    d.donor_id,
    p.full_name,
    p.date_of_birth,
    p.gender,
    d.blood_group,
    d.weight_kg,
    d.is_active
FROM donor AS d
JOIN person AS p
    ON p.person_id = d.donor_id;

-- Q02 — WHERE: active adult donors meeting the simplified weight threshold.
SELECT
    d.donor_id,
    p.full_name,
    d.blood_group,
    d.weight_kg
FROM donor AS d
JOIN person AS p
    ON p.person_id = d.donor_id
WHERE d.is_active
  AND d.weight_kg >= 50
  AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, p.date_of_birth)) BETWEEN 18 AND 65;

-- Q03 — ORDER BY: active emergency requests, highest priority then oldest.
SELECT
    request_id,
    request_type,
    priority,
    requested_at,
    status
FROM emergency_request
WHERE status IN ('PENDING', 'PARTIALLY_RESERVED', 'RESERVED', 'MATCHED')
ORDER BY
    CASE priority
        WHEN 'CRITICAL' THEN 1
        WHEN 'HIGH'     THEN 2
        WHEN 'MEDIUM'   THEN 3
        WHEN 'LOW'      THEN 4
    END,
    requested_at,
    request_id;

-- Q04 — LIKE / ILIKE and DISTINCT: case-insensitive name search and groups.
SELECT
    person_id,
    full_name
FROM person
WHERE full_name ILIKE '%nair%'
ORDER BY full_name;

SELECT DISTINCT blood_group
FROM donor
ORDER BY blood_group;

-- Q05 — aggregate COUNT, including conditional FILTER counts.
SELECT
    COUNT(*) AS total_blood_units,
    COUNT(*) FILTER (WHERE status = 'AVAILABLE') AS available_units,
    COUNT(*) FILTER (WHERE status = 'RESERVED') AS reserved_units,
    COUNT(*) FILTER (WHERE status IN ('REJECTED', 'EXPIRED')) AS unusable_units
FROM blood_unit;

-- Q06 — meaningful SUM: total fictional volume collected by blood bank.
SELECT
    bb.blood_bank_id,
    bb.name AS blood_bank_name,
    SUM(bd.quantity_collected_ml) AS total_collected_ml
FROM blood_donation AS bd
JOIN blood_bank AS bb
    ON bb.blood_bank_id = bd.collection_bank_id
GROUP BY bb.blood_bank_id, bb.name
ORDER BY total_collected_ml DESC, bb.name;

-- Q07 — AVG: average blood-donation volume by collection bank.
SELECT
    bb.name AS blood_bank_name,
    ROUND(AVG(bd.quantity_collected_ml), 2) AS average_collected_ml
FROM blood_donation AS bd
JOIN blood_bank AS bb
    ON bb.blood_bank_id = bd.collection_bank_id
GROUP BY bb.blood_bank_id, bb.name
ORDER BY bb.name;

-- Q08 — GROUP BY: lifecycle inventory by bank, group, and status.
SELECT
    bb.name AS blood_bank_name,
    bu.blood_group,
    bu.status,
    COUNT(*) AS unit_count
FROM blood_unit AS bu
JOIN blood_bank AS bb
    ON bb.blood_bank_id = bu.current_blood_bank_id
GROUP BY bb.blood_bank_id, bb.name, bu.blood_group, bu.status
ORDER BY bb.name, bu.blood_group, bu.status;

-- Q09 — HAVING: only donors with more than one active donation record.
SELECT
    d.donor_id,
    p.full_name,
    COUNT(*) AS donation_count
FROM donation AS d
JOIN person AS p
    ON p.person_id = d.donor_id
WHERE d.record_status = 'ACTIVE'
GROUP BY d.donor_id, p.full_name
HAVING COUNT(*) > 1
ORDER BY donation_count DESC, p.full_name;

-- Q10 — INNER JOIN: donor donation history (only matching rows survive).
SELECT
    p.full_name AS donor_name,
    d.donation_id,
    d.donation_type,
    d.donation_date,
    d.record_status
FROM donation AS d
INNER JOIN donor AS dr
    ON dr.donor_id = d.donor_id
INNER JOIN person AS p
    ON p.person_id = dr.donor_id
ORDER BY p.full_name, d.donation_date DESC, d.donation_id DESC;

-- Q11 — LEFT JOIN: all hospitals, including any with zero requests.
SELECT
    h.hospital_id,
    h.name AS hospital_name,
    COUNT(er.request_id) AS request_count
FROM hospital AS h
LEFT JOIN doctor AS d
    ON d.hospital_id = h.hospital_id
LEFT JOIN emergency_request AS er
    ON er.requested_by = d.doctor_id
GROUP BY h.hospital_id, h.name
ORDER BY h.name;

-- Q12 — multi-table JOIN: active reservations with request and hospital.
SELECT
    br.reservation_id,
    br.request_id,
    h.name AS hospital_name,
    rp.full_name AS recipient_name,
    er.priority,
    bu.blood_unit_id,
    bu.blood_group,
    bb.name AS holding_blood_bank,
    br.reserved_at,
    br.expires_at
FROM blood_reservation AS br
JOIN emergency_request AS er
    ON er.request_id = br.request_id
JOIN recipient AS r
    ON r.recipient_id = er.recipient_id
JOIN person AS rp
    ON rp.person_id = r.recipient_id
JOIN doctor AS d
    ON d.doctor_id = er.requested_by
JOIN hospital AS h
    ON h.hospital_id = d.hospital_id
JOIN blood_unit AS bu
    ON bu.blood_unit_id = br.blood_unit_id
JOIN blood_bank AS bb
    ON bb.blood_bank_id = bu.current_blood_bank_id
WHERE br.status = 'ACTIVE'
ORDER BY er.priority, br.expires_at, br.reservation_id;

-- Q13 — non-correlated subquery: donors above the average donor weight.
SELECT
    d.donor_id,
    p.full_name,
    d.weight_kg
FROM donor AS d
JOIN person AS p
    ON p.person_id = d.donor_id
WHERE d.weight_kg > (
    SELECT AVG(weight_kg)
    FROM donor
)
ORDER BY d.weight_kg DESC, p.full_name;

-- Q14 — correlated subquery: each donor's latest active blood donation.
SELECT
    d.donor_id,
    p.full_name,
    d.blood_group,
    (
        SELECT MAX(dn.donation_date)
        FROM donation AS dn
        WHERE dn.donor_id = d.donor_id
          AND dn.donation_type = 'BLOOD'
          AND dn.record_status = 'ACTIVE'
    ) AS latest_blood_donation_date
FROM donor AS d
JOIN person AS p
    ON p.person_id = d.donor_id
WHERE EXISTS (
    SELECT 1
    FROM donation AS dn
    WHERE dn.donor_id = d.donor_id
      AND dn.donation_type = 'BLOOD'
      AND dn.record_status = 'ACTIVE'
)
ORDER BY latest_blood_donation_date DESC, p.full_name;

-- Q15 — CTE: reusable monthly donation trend calculation.
WITH monthly_donations AS (
    SELECT
        date_trunc('month', donation_date)::DATE AS donation_month,
        donation_type,
        COUNT(*) AS donation_count
    FROM donation
    WHERE record_status = 'ACTIVE'
    GROUP BY date_trunc('month', donation_date)::DATE, donation_type
)
SELECT
    donation_month,
    donation_type,
    donation_count
FROM monthly_donations
ORDER BY donation_month, donation_type;

-- Q16 — view queries: reusable, security-friendly projections.
SELECT *
FROM eligible_donors_view
ORDER BY blood_group, full_name;

SELECT *
FROM available_blood_units_view
WHERE blood_group = 'AB-'
ORDER BY expiry_date, blood_unit_id;

SELECT *
FROM active_emergency_requests_view
WHERE priority = 'CRITICAL'
ORDER BY requested_at, request_id;

SELECT *
FROM organ_match_priority_view
WHERE organ_unit_id = 1
ORDER BY candidate_rank;

SELECT *
FROM expiring_blood_units_view
ORDER BY days_to_expiry, blood_group, blood_unit_id;

-- Q17 — read-only stored-function call with named arguments.
SELECT *
FROM generate_inventory_report(
    p_blood_bank_id => 2,
    p_blood_group => 'AB-',
    p_status => NULL
);

-- Q18a — transaction COMMIT example; READ ONLY guarantees no data mutation.
BEGIN TRANSACTION READ ONLY;

SELECT
    request_id,
    hospital_name,
    priority,
    status,
    units_remaining
FROM active_emergency_requests_view
ORDER BY requested_at, request_id;

COMMIT;

-- Q18b — transaction ROLLBACK plus INSERT, UPDATE, and DELETE examples.
-- Explicit negative IDs avoid advancing identity sequences.
BEGIN;

INSERT INTO address (
    address_id, line1, city, district, state, pincode
) OVERRIDING SYSTEM VALUE
VALUES
    (-900001, 'Rollback Test Address One', 'Kochi', 'Ernakulam', 'Kerala', '682099'),
    (-900002, 'Rollback Test Address Two', 'Kochi', 'Ernakulam', 'Kerala', '682098');

UPDATE address
SET line2 = 'Updated inside rollback-only transaction'
WHERE address_id = -900001;

DELETE FROM address
WHERE address_id = -900002;

DO $crud_assert$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM address
        WHERE address_id = -900001
          AND line2 = 'Updated inside rollback-only transaction'
    ) OR EXISTS (
        SELECT 1 FROM address WHERE address_id = -900002
    ) THEN
        RAISE EXCEPTION 'CRUD transaction test failed before ROLLBACK';
    END IF;

    RAISE NOTICE 'CRUD PASS — INSERT, UPDATE, and DELETE visible inside transaction';
END;
$crud_assert$;

ROLLBACK;

DO $crud_rollback_assert$
BEGIN
    IF EXISTS (
        SELECT 1 FROM address WHERE address_id IN (-900001, -900002)
    ) THEN
        RAISE EXCEPTION 'ROLLBACK test failed: sentinel address survived';
    END IF;

    RAISE NOTICE 'TRANSACTION PASS — ROLLBACK removed all CRUD changes';
END;
$crud_rollback_assert$;

-- Q19 — EXPLAIN / index example.
-- With only twenty seed units, a sequential scan can honestly be cheaper.
-- This transaction-local setting proves index eligibility, not a speed claim.
BEGIN;
SET LOCAL enable_seqscan = off;

EXPLAIN (COSTS OFF)
SELECT blood_unit_id
FROM blood_unit
WHERE blood_group = 'AB-'
  AND status = 'AVAILABLE'
  AND expiry_date >= CURRENT_DATE
ORDER BY expiry_date, blood_unit_id
LIMIT 1;

EXPLAIN (COSTS OFF)
SELECT reservation_id
FROM blood_reservation
WHERE status = 'ACTIVE'
  AND expires_at <= CURRENT_TIMESTAMP
ORDER BY expires_at, reservation_id;

ROLLBACK;

-- ========================================================================== 
-- 2. Required LifeLink report queries
-- ========================================================================== 

-- R01 — AVAILABLE exact-group units in FEFO order for an AB- request.
SELECT
    blood_unit_id,
    blood_group,
    current_blood_bank_name,
    expiry_date,
    days_to_expiry
FROM available_blood_units_view
WHERE blood_group = 'AB-'
ORDER BY expiry_date, blood_unit_id;

-- R02 — usable units expiring within a parameter-like N-day CTE (N = 10).
WITH parameters AS (
    SELECT 10::INTEGER AS days_ahead
)
SELECT
    av.blood_unit_id,
    av.blood_group,
    av.current_blood_bank_name,
    av.expiry_date,
    av.days_to_expiry
FROM available_blood_units_view AS av
CROSS JOIN parameters AS p
WHERE av.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + p.days_ahead
ORDER BY av.expiry_date, av.blood_group, av.blood_unit_id;

-- R03 — current inventory by blood bank and blood group.
SELECT
    bb.name AS blood_bank_name,
    bu.blood_group,
    COUNT(*) AS all_units,
    COUNT(*) FILTER (WHERE bu.status = 'AVAILABLE') AS physically_available,
    COUNT(*) FILTER (WHERE bu.status = 'RESERVED') AS reserved,
    COUNT(*) FILTER (WHERE bu.status = 'ISSUED') AS issued,
    COUNT(*) FILTER (WHERE bu.status IN ('REJECTED', 'EXPIRED')) AS unusable
FROM blood_bank AS bb
LEFT JOIN blood_unit AS bu
    ON bu.current_blood_bank_id = bb.blood_bank_id
GROUP BY bb.blood_bank_id, bb.name, bu.blood_group
ORDER BY bb.name, bu.blood_group;

-- R04 — active reservations with hospital, request, unit, and bank context.
SELECT
    br.reservation_id,
    er.request_id,
    h.name AS hospital_name,
    er.priority,
    er.blood_group AS requested_group,
    bu.blood_unit_id,
    bb.name AS holding_bank,
    br.reserved_at,
    br.expires_at
FROM blood_reservation AS br
JOIN emergency_request AS er
    ON er.request_id = br.request_id
JOIN doctor AS d
    ON d.doctor_id = er.requested_by
JOIN hospital AS h
    ON h.hospital_id = d.hospital_id
JOIN blood_unit AS bu
    ON bu.blood_unit_id = br.blood_unit_id
JOIN blood_bank AS bb
    ON bb.blood_bank_id = bu.current_blood_bank_id
WHERE br.status = 'ACTIVE'
ORDER BY br.expires_at, br.reservation_id;

-- R05 — complete donation history for donor 2.
SELECT
    p.full_name AS donor_name,
    d.donation_id,
    d.donation_date,
    d.donation_type,
    COALESCE(bb.name, ob.name) AS collection_centre,
    bd.quantity_collected_ml,
    ou.organ_type,
    d.record_status
FROM donation AS d
JOIN person AS p
    ON p.person_id = d.donor_id
LEFT JOIN blood_donation AS bd
    ON bd.donation_id = d.donation_id
LEFT JOIN blood_bank AS bb
    ON bb.blood_bank_id = bd.collection_bank_id
LEFT JOIN organ_donation AS od
    ON od.donation_id = d.donation_id
LEFT JOIN organ_bank AS ob
    ON ob.organ_bank_id = od.collection_organ_bank_id
LEFT JOIN organ_unit AS ou
    ON ou.donation_id = od.donation_id
WHERE d.donor_id = 2
ORDER BY d.donation_date DESC, d.donation_id DESC;

-- R06 — emergency requests by priority and status.
SELECT
    er.priority,
    er.status,
    er.request_type,
    COUNT(*) AS request_count
FROM emergency_request AS er
GROUP BY er.priority, er.status, er.request_type
ORDER BY
    CASE er.priority
        WHEN 'CRITICAL' THEN 1
        WHEN 'HIGH'     THEN 2
        WHEN 'MEDIUM'   THEN 3
        WHEN 'LOW'      THEN 4
    END,
    er.status,
    er.request_type;

-- R07 — average request-to-first-reservation response time by hospital.
WITH first_reservation AS (
    SELECT
        request_id,
        MIN(reserved_at) AS first_reserved_at
    FROM blood_reservation
    WHERE status IN ('ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED')
    GROUP BY request_id
)
SELECT
    h.hospital_id,
    h.name AS hospital_name,
    COUNT(*) AS responded_request_count,
    ROUND(
        AVG(
            EXTRACT(EPOCH FROM (fr.first_reserved_at - er.requested_at)) / 60.0
        )::NUMERIC,
        2
    ) AS average_response_minutes
FROM first_reservation AS fr
JOIN emergency_request AS er
    ON er.request_id = fr.request_id
JOIN doctor AS d
    ON d.doctor_id = er.requested_by
JOIN hospital AS h
    ON h.hospital_id = d.hospital_id
GROUP BY h.hospital_id, h.name
ORDER BY average_response_minutes, h.name;

-- R08 — donation count per month and donation type.
SELECT
    date_trunc('month', donation_date)::DATE AS donation_month,
    donation_type,
    COUNT(*) AS donation_count
FROM donation
WHERE record_status = 'ACTIVE'
GROUP BY date_trunc('month', donation_date)::DATE, donation_type
ORDER BY donation_month, donation_type;

-- R09 — explainable organ candidates sorted by derived final priority.
SELECT
    organ_unit_id,
    organ_type,
    candidate_rank,
    recipient_name,
    hospital_name,
    compatibility_score,
    urgency_score,
    waiting_time_score,
    final_priority,
    match_status
FROM organ_match_priority_view
ORDER BY organ_unit_id, candidate_rank;

-- R10 — failed screening counts by blood bank and fictional test name.
SELECT
    bb.name AS blood_bank_name,
    mtr.test_name,
    COUNT(*) AS failed_result_count,
    COUNT(DISTINCT mtr.donation_id) AS affected_donation_count
FROM medical_test_result AS mtr
JOIN blood_unit AS bu
    ON bu.donation_id = mtr.donation_id
JOIN blood_bank AS bb
    ON bb.blood_bank_id = bu.current_blood_bank_id
WHERE mtr.result = 'FAIL'
GROUP BY bb.blood_bank_id, bb.name, mtr.test_name
ORDER BY failed_result_count DESC, bb.name, mtr.test_name;

-- R11 — newest-first audit history for blood unit 20.
SELECT
    audit_id,
    user_id,
    action,
    old_status,
    new_status,
    action_time,
    details
FROM audit_log
WHERE table_name = 'blood_unit'
  AND record_id = '20'
ORDER BY action_time DESC, audit_id DESC;

-- ========================================================================== 
-- 3. Positive workflow tests — all mutations are rolled back
-- ========================================================================== 

-- P01 — register_donation creates parent, subtype, unit, and audit atomically.
BEGIN;

DO $register_positive$
DECLARE
    v_result RECORD;
BEGIN
    SELECT *
    INTO STRICT v_result
    FROM register_donation(
        p_donor_id => 10,
        p_donation_type => 'BLOOD',
        p_collection_bank_id => 1,
        p_user_id => 3,
        p_donation_date => CURRENT_DATE,
        p_camp_id => NULL,
        p_quantity_collected_ml => 450,
        p_expiry_date => CURRENT_DATE + 35,
        p_organ_type => NULL,
        p_notes => 'Rollback-only positive routine test.'
    );

    IF v_result.blood_unit_id IS NULL
       OR v_result.organ_unit_id IS NOT NULL
       OR v_result.unit_status <> 'COLLECTED'
       OR NOT EXISTS (
           SELECT 1
           FROM donation AS d
           JOIN blood_donation AS bd
               ON bd.donation_id = d.donation_id
           JOIN blood_unit AS bu
               ON bu.donation_id = bd.donation_id
           WHERE d.donation_id = v_result.donation_id
             AND d.donation_type = 'BLOOD'
             AND bd.collection_bank_id = 1
             AND bu.blood_unit_id = v_result.blood_unit_id
             AND bu.status = 'COLLECTED'
       ) OR NOT EXISTS (
           SELECT 1
           FROM audit_log
           WHERE table_name = 'donation'
             AND record_id = v_result.donation_id::TEXT
             AND action = 'DONATION_REGISTERED'
       ) THEN
        RAISE EXCEPTION 'P01 failed: donation hierarchy or audit row is incomplete';
    END IF;

    RAISE NOTICE
        'P01 PASS — donation %, blood unit %, status %',
        v_result.donation_id,
        v_result.blood_unit_id,
        v_result.unit_status;
END;
$register_positive$;

-- Force the deferred total/disjoint specialization constraint before rollback.
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;

-- P02 — valid COLLECTED -> TESTING -> AVAILABLE lifecycle after PASS results.
BEGIN;

DO $screening_positive$
DECLARE
    v_audit_before BIGINT;
    v_audit_after BIGINT;
BEGIN
    SELECT COUNT(*)
    INTO v_audit_before
    FROM audit_log
    WHERE table_name = 'blood_unit'
      AND record_id = '15';

    PERFORM set_config('lifelink.app_user_id', '10', TRUE);

    UPDATE blood_unit
    SET status = 'TESTING'
    WHERE blood_unit_id = 15
      AND status = 'COLLECTED';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'P02 failed: blood unit 15 was not in COLLECTED state';
    END IF;

    INSERT INTO medical_test_result (
        donation_id, test_no, test_name, result, test_date, remarks
    )
    VALUES
        (15, 1, 'Rollback infectious screening', 'PASS', CURRENT_DATE, 'Test-only row.'),
        (15, 2, 'Rollback group confirmation',   'PASS', CURRENT_DATE, 'Test-only row.');

    UPDATE blood_unit
    SET status = 'AVAILABLE'
    WHERE blood_unit_id = 15
      AND status = 'TESTING';

    IF NOT FOUND OR NOT EXISTS (
        SELECT 1
        FROM available_blood_units_view
        WHERE blood_unit_id = 15
          AND all_tests_passed
    ) THEN
        RAISE EXCEPTION 'P02 failed: screened unit did not become view-visible AVAILABLE stock';
    END IF;

    SELECT COUNT(*)
    INTO v_audit_after
    FROM audit_log
    WHERE table_name = 'blood_unit'
      AND record_id = '15';

    IF v_audit_after <> v_audit_before + 2 THEN
        RAISE EXCEPTION 'P02 failed: expected two lifecycle audit rows';
    END IF;

    RAISE NOTICE 'P02 PASS — COLLECTED -> TESTING -> AVAILABLE with two audit events';
END;
$screening_positive$;

ROLLBACK;

-- P03 — valid emergency reservation selects the only usable AB- unit (12).
BEGIN;

DO $reservation_positive$
DECLARE
    v_result RECORD;
    v_audit_before BIGINT;
    v_audit_after BIGINT;
BEGIN
    SELECT COUNT(*) INTO v_audit_before FROM audit_log;

    SELECT *
    INTO STRICT v_result
    FROM reserve_emergency_blood(9, 8, 120);

    IF v_result.blood_unit_id <> 12
       OR v_result.blood_group <> 'AB-'
       OR v_result.blood_bank_id <> 2
       OR v_result.request_status <> 'RESERVED'
       OR NOT EXISTS (
           SELECT 1 FROM blood_unit
           WHERE blood_unit_id = 12 AND status = 'RESERVED'
       ) OR NOT EXISTS (
           SELECT 1 FROM blood_reservation
           WHERE reservation_id = v_result.reservation_id
             AND status = 'ACTIVE'
       ) OR NOT EXISTS (
           SELECT 1 FROM emergency_request
           WHERE request_id = 9 AND status = 'RESERVED'
       ) THEN
        RAISE EXCEPTION 'P03 failed: reservation, unit, or request state is inconsistent';
    END IF;

    SELECT COUNT(*) INTO v_audit_after FROM audit_log;

    IF v_audit_after <> v_audit_before + 3 THEN
        RAISE EXCEPTION 'P03 failed: expected reservation, unit, and request audit events';
    END IF;

    RAISE NOTICE
        'P03 PASS — reservation % atomically reserved AB- unit 12',
        v_result.reservation_id;
END;
$reservation_positive$;

ROLLBACK;

-- P04 — recalculate an existing organ candidate and expose derived priority.
BEGIN;

DO $organ_match_positive$
DECLARE
    v_result RECORD;
    v_audit_before BIGINT;
BEGIN
    SELECT COUNT(*) INTO v_audit_before FROM audit_log;

    SELECT *
    INTO STRICT v_result
    FROM calculate_organ_match(10, 1, 93.00, 4);

    IF v_result.match_id <> 1
       OR v_result.compatibility_score <> 93.00
       OR v_result.academic_priority_score NOT BETWEEN 0 AND 100
       OR v_result.candidate_rank < 1
       OR v_result.match_status <> 'CANDIDATE'
       OR (SELECT COUNT(*) FROM audit_log) <> v_audit_before + 1 THEN
        RAISE EXCEPTION 'P04 failed: recalculated candidate or audit output is invalid';
    END IF;

    RAISE NOTICE
        'P04 PASS — match %, derived priority %, rank %',
        v_result.match_id,
        v_result.academic_priority_score,
        v_result.candidate_rank;
END;
$organ_match_positive$;

ROLLBACK;

-- P05 — parameterized report returns the one seeded AVAILABLE AB- unit.
DO $report_positive$
DECLARE
    v_row RECORD;
BEGIN
    SELECT *
    INTO STRICT v_row
    FROM generate_inventory_report(2, 'AB-', 'AVAILABLE');

    IF v_row.unit_count <> 1
       OR v_row.usable_available_count <> 1
       OR v_row.active_reservation_count <> 0 THEN
        RAISE EXCEPTION 'P05 failed: AB- inventory report did not match seed facts';
    END IF;

    RAISE NOTICE 'P05 PASS — parameterized inventory report returned usable AB- stock';
END;
$report_positive$;

-- P06 — procedure call. It may release elapsed holds, but ROLLBACK preserves
-- the database. The returned row contains released/available/expired counters.
BEGIN;
CALL release_expired_reservations(1, 0, 0, 0);
ROLLBACK;

-- ========================================================================== 
-- 4. Negative tests — each expected error is caught and asserted
-- ========================================================================== 

DO $negative_tests$
DECLARE
    v_rejected BOOLEAN;
BEGIN
    -- N01 — domain CHECK rejects an invalid donor blood group (23514).
    v_rejected := FALSE;
    BEGIN
        UPDATE donor SET blood_group = 'X+' WHERE donor_id = 1;
    EXCEPTION
        WHEN check_violation THEN
            v_rejected := TRUE;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'N01 failed: invalid blood group was accepted';
    END IF;
    RAISE NOTICE 'N01 PASS — CHECK constraint rejected invalid blood group (23514)';

    -- N02 — referential integrity rejects a missing condition (23503).
    v_rejected := FALSE;
    BEGIN
        INSERT INTO donor_condition (
            donor_id, condition_id, diagnosed_date, condition_status
        )
        VALUES (1, -999999, CURRENT_DATE, 'MONITORED');
    EXCEPTION
        WHEN foreign_key_violation THEN
            v_rejected := TRUE;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'N02 failed: missing condition foreign key was accepted';
    END IF;
    RAISE NOTICE 'N02 PASS — foreign key rejected missing condition (23503)';

    -- N03 — alternate key rejects a duplicate username (23505).
    v_rejected := FALSE;
    BEGIN
        INSERT INTO user_account (
            user_id, person_id, blood_bank_id, organ_bank_id,
            username, password_hash, role, status
        ) OVERRIDING SYSTEM VALUE
        VALUES (
            -900003, NULL, NULL, NULL,
            'admin.demo', 'test-only-not-a-real-hash', 'ADMIN', 'ACTIVE'
        );
    EXCEPTION
        WHEN unique_violation THEN
            v_rejected := TRUE;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'N03 failed: duplicate username was accepted';
    END IF;
    RAISE NOTICE 'N03 PASS — UNIQUE constraint rejected duplicate username (23505)';

    -- N04 — role/subtype trigger rejects a donor person as DOCTOR (23514).
    v_rejected := FALSE;
    BEGIN
        INSERT INTO user_account (
            user_id, person_id, username, password_hash, role, status
        ) OVERRIDING SYSTEM VALUE
        VALUES (
            -900004, 1, 'mismatch.test',
            'test-only-not-a-real-hash', 'DOCTOR', 'ACTIVE'
        );
    EXCEPTION
        WHEN check_violation THEN
            v_rejected := TRUE;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'N04 failed: mismatched account subtype was accepted';
    END IF;
    RAISE NOTICE 'N04 PASS — role/subtype trigger rejected mismatched DOCTOR (23514)';

    -- N05 — deferred total specialization rejects a parent without subtype.
    v_rejected := FALSE;
    BEGIN
        INSERT INTO donation (
            donation_id, donor_id, donation_date, donation_type, record_status
        ) OVERRIDING SYSTEM VALUE
        VALUES (-900005, 10, CURRENT_DATE, 'BLOOD', 'ACTIVE');

        SET CONSTRAINTS ALL IMMEDIATE;
    EXCEPTION
        WHEN check_violation THEN
            v_rejected := TRUE;
    END;
    SET CONSTRAINTS ALL DEFERRED;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'N05 failed: donation parent without BLOOD subtype was accepted';
    END IF;
    RAISE NOTICE 'N05 PASS — deferred specialization rejected missing subtype (23514)';

    -- N06 — a PENDING screening result blocks TESTING -> AVAILABLE.
    v_rejected := FALSE;
    BEGIN
        UPDATE blood_unit SET status = 'AVAILABLE' WHERE blood_unit_id = 7;
    EXCEPTION
        WHEN check_violation THEN
            v_rejected := TRUE;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'N06 failed: pending-screening unit became AVAILABLE';
    END IF;
    RAISE NOTICE 'N06 PASS — pending screening blocked AVAILABLE (23514)';

    -- N07 — a FAIL screening result blocks a rejected unit becoming AVAILABLE.
    v_rejected := FALSE;
    BEGIN
        UPDATE blood_unit SET status = 'AVAILABLE' WHERE blood_unit_id = 8;
    EXCEPTION
        WHEN check_violation THEN
            v_rejected := TRUE;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'N07 failed: failed-screening unit became AVAILABLE';
    END IF;
    RAISE NOTICE 'N07 PASS — failed screening blocked AVAILABLE (23514)';

    -- N08 — a REJECTED unit cannot be directly reserved.
    v_rejected := FALSE;
    BEGIN
        INSERT INTO blood_reservation (
            reservation_id, request_id, blood_unit_id,
            expires_at, status, created_by
        ) OVERRIDING SYSTEM VALUE
        VALUES (
            -900008, 9, 8,
            CURRENT_TIMESTAMP + INTERVAL '60 minutes', 'ACTIVE', 8
        );
    EXCEPTION
        WHEN check_violation THEN
            v_rejected := TRUE;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'N08 failed: REJECTED unit was reserved';
    END IF;
    RAISE NOTICE 'N08 PASS — rejected unit reservation was blocked (23514)';

    -- N09 — an EXPIRED unit cannot be directly reserved.
    v_rejected := FALSE;
    BEGIN
        INSERT INTO blood_reservation (
            reservation_id, request_id, blood_unit_id,
            expires_at, status, created_by
        ) OVERRIDING SYSTEM VALUE
        VALUES (
            -900009, 1, 9,
            CURRENT_TIMESTAMP + INTERVAL '60 minutes', 'ACTIVE', 1
        );
    EXCEPTION
        WHEN check_violation THEN
            v_rejected := TRUE;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'N09 failed: EXPIRED unit was reserved';
    END IF;
    RAISE NOTICE 'N09 PASS — expired unit reservation was blocked (23514)';

    -- N10 — a DOCTOR application actor cannot reserve bank stock (42501).
    v_rejected := FALSE;
    BEGIN
        PERFORM 1 FROM reserve_emergency_blood(9, 2, 120);
    EXCEPTION
        WHEN insufficient_privilege THEN
            v_rejected := TRUE;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'N10 failed: DOCTOR actor reserved blood';
    END IF;
    RAISE NOTICE 'N10 PASS — invalid application actor was rejected (42501)';

    -- N11 — reservation hold outside 5..1440 minutes is invalid (22023).
    v_rejected := FALSE;
    BEGIN
        PERFORM 1 FROM reserve_emergency_blood(9, 8, 1);
    EXCEPTION
        WHEN invalid_parameter_value THEN
            v_rejected := TRUE;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'N11 failed: invalid one-minute hold was accepted';
    END IF;
    RAISE NOTICE 'N11 PASS — invalid hold minutes were rejected (22023)';

    -- N12 — inactive donor 12 cannot register a donation (23514).
    v_rejected := FALSE;
    BEGIN
        PERFORM 1
        FROM register_donation(
            12, 'BLOOD', 1, 3, CURRENT_DATE, NULL, 450,
            CURRENT_DATE + 35, NULL, 'Negative inactive-donor test.'
        );
    EXCEPTION
        WHEN check_violation THEN
            v_rejected := TRUE;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'N12 failed: inactive donor registered a donation';
    END IF;
    RAISE NOTICE 'N12 PASS — inactive donor was rejected (23514)';

    -- N13 — KIDNEY request cannot be matched with a CORNEA unit (23514).
    v_rejected := FALSE;
    BEGIN
        PERFORM 1 FROM calculate_organ_match(10, 4, 90.00, 1);
    EXCEPTION
        WHEN check_violation THEN
            v_rejected := TRUE;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'N13 failed: mismatched organ type was accepted';
    END IF;
    RAISE NOTICE 'N13 PASS — mismatched organ type was rejected (23514)';

    -- N14 — academic compatibility score must remain in 0..100 (22023).
    v_rejected := FALSE;
    BEGIN
        PERFORM 1 FROM calculate_organ_match(10, 1, 101.00, 4);
    EXCEPTION
        WHEN invalid_parameter_value THEN
            v_rejected := TRUE;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'N14 failed: score above 100 was accepted';
    END IF;
    RAISE NOTICE 'N14 PASS — invalid compatibility score was rejected (22023)';

    -- N15 — report function validates filter domains (22023).
    v_rejected := FALSE;
    BEGIN
        PERFORM 1 FROM generate_inventory_report(NULL, 'X+', NULL);
    EXCEPTION
        WHEN invalid_parameter_value THEN
            v_rejected := TRUE;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'N15 failed: invalid report blood group was accepted';
    END IF;
    RAISE NOTICE 'N15 PASS — invalid report parameter was rejected (22023)';
END;
$negative_tests$;

-- N16 — a second allocation attempt cannot create a duplicate active hold.
-- The first call succeeds only inside this rollback-only transaction; the
-- second call must fail because the request is already fulfilled and locked.
BEGIN;

DO $duplicate_allocation_test$
DECLARE
    v_first RECORD;
    v_rejected BOOLEAN := FALSE;
BEGIN
    SELECT *
    INTO STRICT v_first
    FROM reserve_emergency_blood(9, 8, 120);

    BEGIN
        PERFORM 1 FROM reserve_emergency_blood(9, 8, 120);
    EXCEPTION
        WHEN check_violation THEN
            v_rejected := TRUE;
    END;

    IF NOT v_rejected THEN
        RAISE EXCEPTION 'N16 failed: second allocation attempt succeeded';
    END IF;

    IF (
        SELECT COUNT(*)
        FROM blood_reservation
        WHERE blood_unit_id = 12
          AND status = 'ACTIVE'
    ) <> 1 THEN
        RAISE EXCEPTION 'N16 failed: active reservation cardinality is not one';
    END IF;

    RAISE NOTICE
        'N16 PASS — first reservation % succeeded; duplicate allocation failed safely',
        v_first.reservation_id;
END;
$duplicate_allocation_test$;

ROLLBACK;

-- ========================================================================== 
-- 5. PostgreSQL RBAC verification queries
-- ========================================================================== 

-- Visible privilege matrix for the report/viva.
SELECT *
FROM (
    VALUES
        (
            'doctor reads active request view',
            TRUE,
            has_table_privilege(
                'lifelink_doctor',
                'lifelink.active_emergency_requests_view',
                'SELECT'
            )
        ),
        (
            'doctor inserts emergency request',
            TRUE,
            has_table_privilege(
                'lifelink_doctor',
                'lifelink.emergency_request',
                'INSERT'
            )
        ),
        (
            'doctor updates blood unit',
            FALSE,
            has_table_privilege(
                'lifelink_doctor',
                'lifelink.blood_unit',
                'UPDATE'
            )
        ),
        (
            'doctor reads user accounts',
            FALSE,
            has_table_privilege(
                'lifelink_doctor',
                'lifelink.user_account',
                'SELECT'
            )
        ),
        (
            'blood staff reads account role column',
            TRUE,
            has_column_privilege(
                'lifelink_blood_bank_staff',
                'lifelink.user_account',
                'role',
                'SELECT'
            )
        ),
        (
            'blood staff reads password_hash column',
            FALSE,
            has_column_privilege(
                'lifelink_blood_bank_staff',
                'lifelink.user_account',
                'password_hash',
                'SELECT'
            )
        ),
        (
            'donor reads all donation rows',
            FALSE,
            has_table_privilege(
                'lifelink_donor',
                'lifelink.donation',
                'SELECT'
            )
        ),
        (
            'recipient reads all emergency rows',
            FALSE,
            has_table_privilege(
                'lifelink_recipient',
                'lifelink.emergency_request',
                'SELECT'
            )
        )
) AS permission_check(test_name, expected, actual)
ORDER BY test_name;

DO $rbac_assert$
BEGIN
    IF NOT has_schema_privilege('lifelink_doctor', 'lifelink', 'USAGE')
       OR has_schema_privilege('lifelink_doctor', 'lifelink', 'CREATE')
       OR NOT has_table_privilege(
           'lifelink_doctor', 'lifelink.active_emergency_requests_view', 'SELECT'
       )
       OR NOT has_table_privilege(
           'lifelink_doctor', 'lifelink.emergency_request', 'INSERT'
       )
       OR has_table_privilege(
           'lifelink_doctor', 'lifelink.blood_unit', 'UPDATE'
       )
       OR has_table_privilege(
           'lifelink_doctor', 'lifelink.user_account', 'SELECT'
       )
       OR NOT has_column_privilege(
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
       OR NOT has_function_privilege(
           'lifelink_blood_bank_staff',
           'lifelink.reserve_emergency_blood(integer,integer,integer)',
           'EXECUTE'
       )
       OR has_table_privilege(
           'lifelink_donor', 'lifelink.donation', 'SELECT'
       )
       OR has_table_privilege(
           'lifelink_recipient', 'lifelink.emergency_request', 'SELECT'
       ) THEN
        RAISE EXCEPTION 'RBAC test failed: one or more effective privileges differ';
    END IF;

    RAISE NOTICE 'RBAC PASS — allowed capabilities exist and sensitive operations remain denied';
END;
$rbac_assert$;

/*
 * Optional live denial demo (run separately as an administrator allowed to
 * SET ROLE). Each marked statement is intentionally expected to fail with
 * SQLSTATE 42501; do not place it in the executable suite above.
 *
 *   BEGIN;
 *   SET LOCAL ROLE lifelink_doctor;
 *   SELECT COUNT(*) FROM lifelink.active_emergency_requests_view; -- succeeds
 *   SELECT password_hash FROM lifelink.user_account;              -- 42501
 *   UPDATE lifelink.blood_unit SET status = 'EXPIRED'
 *   WHERE blood_unit_id = 1;                                      -- 42501
 *   ROLLBACK;
 */

-- ========================================================================== 
-- 6. Restore non-transactional sequence state and prove zero residue
-- ========================================================================== 

DO $restore_sequences$
DECLARE
    v_state RECORD;
BEGIN
    FOR v_state IN
        SELECT sequence_name, last_value, is_called
        FROM lifelink_test_sequence_state
        ORDER BY sequence_name
    LOOP
        PERFORM pg_catalog.setval(
            v_state.sequence_name::REGCLASS,
            v_state.last_value,
            v_state.is_called
        );
    END LOOP;

    RAISE NOTICE 'SEQUENCE PASS — rollback-test identity sequences restored';
END;
$restore_sequences$;

DROP TABLE lifelink_test_sequence_state;

DO $final_state$
BEGIN
    IF EXISTS (
        SELECT 1 FROM address WHERE address_id IN (-900001, -900002)
    ) OR EXISTS (
        SELECT 1 FROM user_account WHERE user_id IN (-900003, -900004)
    ) OR EXISTS (
        SELECT 1 FROM donation WHERE donation_id = -900005
    ) OR EXISTS (
        SELECT 1 FROM blood_reservation
        WHERE reservation_id IN (-900008, -900009)
    ) OR NOT EXISTS (
        SELECT 1 FROM blood_unit WHERE blood_unit_id = 7 AND status = 'TESTING'
    ) OR NOT EXISTS (
        SELECT 1 FROM blood_unit WHERE blood_unit_id = 8 AND status = 'REJECTED'
    ) OR NOT EXISTS (
        SELECT 1 FROM blood_unit WHERE blood_unit_id = 12 AND status = 'AVAILABLE'
    ) OR NOT EXISTS (
        SELECT 1 FROM blood_unit WHERE blood_unit_id = 15 AND status = 'COLLECTED'
    ) OR NOT EXISTS (
        SELECT 1 FROM emergency_request WHERE request_id = 9 AND status = 'PENDING'
    ) OR EXISTS (
        SELECT 1 FROM blood_reservation
        WHERE blood_unit_id = 12 AND status = 'ACTIVE'
    ) OR NOT EXISTS (
        SELECT 1
        FROM organ_match
        WHERE match_id = 1
          AND compatibility_score = 92.00
          AND match_status = 'CANDIDATE'
    ) THEN
        RAISE EXCEPTION 'Final-state test failed: a rollback-only change survived';
    END IF;

    RAISE NOTICE 'FINAL PASS — all executable tests completed with seed rows unchanged';
END;
$final_state$;

SELECT
    'PASS' AS suite_status,
    'SQL syllabus, reports, routines, constraints, triggers, indexes, and RBAC verified' AS summary;

