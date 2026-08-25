/*
 * LifeLink — Multi-Hospital Blood and Organ Allocation System
 * Phase 14: Two-session PostgreSQL concurrency demonstration
 *
 * Prerequisites:
 *   Run database/01_schema.sql through database/10_test_queries.sql.
 *
 * Purpose:
 *   Prove that two hospitals cannot reserve the same final compatible blood
 *   unit. Session A obtains PostgreSQL's row lock and succeeds. Session B waits
 *   for that lock, rechecks the row after Session A commits, then fails safely
 *   because the unit is no longer AVAILABLE.
 *
 * This file is intentionally NOT a one-click script. True concurrency requires
 * two independent connections to the same PostgreSQL database. Open two Query
 * Tool tabs in pgAdmin (or two psql terminals), then execute only the marked
 * blocks in the stated order.
 *
 * Demo records:
 *   Hospital A request  : request_id 9, Green Valley Hospital
 *   Hospital B request  : request_id -910002, Harbourview Medical Centre
 *   Contended unit      : blood_unit_id 12, the only usable AVAILABLE AB- unit
 *   Reserving app actor : user_id 8, staff of blood bank 2
 *
 * Safety and repeatability:
 *   - The setup request uses an explicit negative ID, so no identity sequence
 *     is advanced.
 *   - Session B must ROLLBACK after its expected error.
 *   - The cleanup restores request 9 and unit 12 to their initial operational
 *     states, deletes the temporary Hospital B request, and retains the
 *     CANCELLED reservation plus audit rows as legitimate demo history.
 *   - Run this only in the fictional development/demo database.
 */

-- ========================================================================== 
-- EXECUTION ORDER
-- ========================================================================== 
--
--   1. Run SETUP once in Session A.
--   2. Run SESSION A — START, but do not commit.
--   3. Run SESSION B — START. Its final SELECT must visibly wait.
--   4. While B waits, run LOCK OBSERVER in Session A.
--   5. Run SESSION A — COMMIT.
--   6. B resumes and raises the expected P0002 error; run B — ROLLBACK.
--   7. Run PROOF in either session.
--   8. Run CLEANUP once in either session.
--
-- Do not use one pgAdmin tab for both sessions: that is sequential execution,
-- not a concurrency demonstration.

-- >>> SETUP_BEGIN
-- ========================================================================== 
-- STEP 1 — SETUP (run once in Session A)
-- ========================================================================== 

BEGIN;
SET LOCAL search_path TO lifelink, public;

DO $setup_preflight$
DECLARE
    v_available_ab_negative INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM emergency_request AS er
        JOIN doctor AS d
            ON d.doctor_id = er.requested_by
        JOIN hospital AS h
            ON h.hospital_id = d.hospital_id
        WHERE er.request_id = 9
          AND er.request_type = 'BLOOD'
          AND er.blood_group = 'AB-'
          AND er.units_required = 1
          AND er.status = 'PENDING'
          AND h.name = 'Green Valley Hospital'
    ) THEN
        RAISE EXCEPTION
            'Setup requires seed request 9 as the PENDING Green Valley AB- request';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM blood_unit AS bu
        JOIN blood_bank AS bb
            ON bb.blood_bank_id = bu.current_blood_bank_id
        WHERE bu.blood_unit_id = 12
          AND bu.blood_group = 'AB-'
          AND bu.status = 'AVAILABLE'
          AND bu.expiry_date >= CURRENT_DATE
          AND bu.current_blood_bank_id = 2
          AND bb.status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION
            'Setup requires seed blood unit 12 as non-expired AVAILABLE AB- stock at bank 2';
    END IF;

    SELECT COUNT(*)::INTEGER
    INTO v_available_ab_negative
    FROM available_blood_units_view
    WHERE blood_group = 'AB-';

    IF v_available_ab_negative <> 1 THEN
        RAISE EXCEPTION
            'Setup requires exactly one usable AVAILABLE AB- unit; found %',
            v_available_ab_negative;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM blood_reservation
        WHERE status = 'ACTIVE'
          AND (request_id = 9 OR blood_unit_id = 12)
    ) THEN
        RAISE EXCEPTION
            'Setup found an existing ACTIVE hold for request 9 or unit 12; run CLEANUP first';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM emergency_request
        WHERE request_id = -910002
    ) THEN
        RAISE EXCEPTION
            'Temporary request -910002 already exists; finish or clean the earlier demo first';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM user_account
        WHERE user_id = 8
          AND role = 'BLOOD_BANK_STAFF'
          AND status = 'ACTIVE'
          AND blood_bank_id = 2
    ) THEN
        RAISE EXCEPTION
            'Setup requires ACTIVE blood-bank application user 8 assigned to bank 2';
    END IF;

    RAISE NOTICE
        'SETUP PRECHECK PASS — request 9 and the only usable AB- unit 12 are ready';
END;
$setup_preflight$;

-- Hospital B gets a separate request row. Because the two transactions do not
-- share a request row, their common contested row is blood_unit 12 itself.

INSERT INTO emergency_request (
    request_id,
    recipient_id,
    requested_by,
    request_type,
    blood_group,
    organ_type,
    units_required,
    priority,
    requested_at,
    status,
    notes
) OVERRIDING SYSTEM VALUE
VALUES (
    -910002,
    20,
    21,
    'BLOOD',
    'AB-',
    NULL,
    1,
    'CRITICAL',
    CURRENT_TIMESTAMP,
    'PENDING',
    'Temporary fictional Hospital B request for the two-session lock demo.'
);

COMMIT;

SELECT
    er.request_id,
    h.name AS hospital_name,
    er.blood_group,
    er.priority,
    er.status
FROM lifelink.emergency_request AS er
JOIN lifelink.doctor AS d
    ON d.doctor_id = er.requested_by
JOIN lifelink.hospital AS h
    ON h.hospital_id = d.hospital_id
WHERE er.request_id IN (9, -910002)
ORDER BY er.request_id DESC;

-- Expected: two PENDING CRITICAL AB- requests belonging to different hospitals.
-- <<< SETUP_END

-- >>> SESSION_A_START_BEGIN
-- ========================================================================== 
-- STEP 2 — SESSION A: START AND HOLD THE WINNING TRANSACTION OPEN
-- ========================================================================== 
-- Run this block in Session A. STOP after the final SELECT. Do not COMMIT yet.

BEGIN;
SET LOCAL search_path TO lifelink, public;
SET LOCAL application_name = 'lifelink_demo_session_a';
SET LOCAL statement_timeout = '2min';

SELECT
    'SESSION A' AS session_name,
    pg_backend_pid() AS backend_pid,
    txid_current() AS transaction_id,
    clock_timestamp() AS started_at;

SELECT *
FROM reserve_emergency_blood(
    p_request_id => 9,
    p_user_id => 8,
    p_hold_minutes => 120
);

-- These changes are visible to Session A but remain uncommitted and invisible
-- to other sessions. PostgreSQL retains the request and blood-unit row locks.

SELECT
    bu.blood_unit_id,
    bu.status AS unit_status_inside_a,
    er.request_id,
    er.status AS request_status_inside_a,
    br.reservation_id,
    br.status AS reservation_status_inside_a
FROM blood_unit AS bu
JOIN blood_reservation AS br
    ON br.blood_unit_id = bu.blood_unit_id
JOIN emergency_request AS er
    ON er.request_id = br.request_id
WHERE bu.blood_unit_id = 12
  AND br.status = 'ACTIVE';

-- Expected inside A:
--   unit 12 = RESERVED, request 9 = RESERVED, one ACTIVE reservation.
--   Leave this transaction open and move to Session B.
-- <<< SESSION_A_START_END

-- >>> SESSION_B_START_BEGIN
-- ========================================================================== 
-- STEP 3 — SESSION B: START THE COMPETING RESERVATION
-- ========================================================================== 
-- Run this block in a DIFFERENT pgAdmin tab / psql connection.
-- The last SELECT should remain "running" because Session A owns unit 12's
-- row lock. Do not cancel it; return to Session A and run LOCK OBSERVER.

BEGIN;
SET LOCAL search_path TO lifelink, public;
SET LOCAL application_name = 'lifelink_demo_session_b';
SET LOCAL statement_timeout = '2min';

SELECT
    'SESSION B' AS session_name,
    pg_backend_pid() AS backend_pid,
    txid_current() AS transaction_id,
    clock_timestamp() AS started_at;

SELECT *
FROM reserve_emergency_blood(
    p_request_id => -910002,
    p_user_id => 8,
    p_hold_minutes => 120
);

-- Expected now: this SELECT waits. It must not return a reservation row.
-- <<< SESSION_B_START_END

-- >>> LOCK_OBSERVER_BEGIN
-- ========================================================================== 
-- STEP 4 — LOCK OBSERVER (run in Session A while Session B is waiting)
-- ========================================================================== 

SELECT
    activity.pid,
    activity.application_name,
    activity.state,
    activity.wait_event_type,
    activity.wait_event,
    pg_blocking_pids(activity.pid) AS blocked_by_backend_pids,
    activity.query_start,
    clock_timestamp() - activity.query_start AS waiting_duration
FROM pg_stat_activity AS activity
WHERE activity.application_name IN (
    'lifelink_demo_session_a',
    'lifelink_demo_session_b'
)
ORDER BY activity.application_name;

-- Required observation for Session B:
--   wait_event_type = Lock
--   blocked_by_backend_pids contains Session A's backend PID

SELECT
    locks.pid,
    activity.application_name,
    locks.locktype,
    locks.mode,
    locks.granted,
    CASE
        WHEN locks.relation IS NULL THEN NULL
        ELSE locks.relation::REGCLASS::TEXT
    END AS locked_relation,
    locks.transactionid
FROM pg_locks AS locks
JOIN pg_stat_activity AS activity
    ON activity.pid = locks.pid
WHERE activity.application_name IN (
    'lifelink_demo_session_a',
    'lifelink_demo_session_b'
)
ORDER BY activity.application_name, locks.granted, locks.locktype, locks.mode;

-- Turn the visual observation into an executable pass/fail assertion.

DO $lock_assertion$
DECLARE
    v_session_a_pid INTEGER;
    v_session_b_pid INTEGER;
    v_session_b_wait_type TEXT;
    v_session_b_blockers INTEGER[];
BEGIN
    SELECT pid
    INTO STRICT v_session_a_pid
    FROM pg_stat_activity
    WHERE application_name = 'lifelink_demo_session_a';

    SELECT
        pid,
        wait_event_type,
        pg_blocking_pids(pid)
    INTO STRICT
        v_session_b_pid,
        v_session_b_wait_type,
        v_session_b_blockers
    FROM pg_stat_activity
    WHERE application_name = 'lifelink_demo_session_b';

    IF v_session_b_wait_type <> 'Lock'
       OR NOT (v_session_a_pid = ANY(v_session_b_blockers)) THEN
        RAISE EXCEPTION
            'LOCK PROOF FAILED — Session B PID % is not blocked by Session A PID % (wait type %, blockers %)',
            v_session_b_pid,
            v_session_a_pid,
            v_session_b_wait_type,
            v_session_b_blockers;
    END IF;

    RAISE NOTICE
        'LOCK PASS — Session B PID % is waiting on Session A PID %',
        v_session_b_pid,
        v_session_a_pid;
END;
$lock_assertion$;

-- The non-granted transaction/tuple-related lock, blocker PID, and LOCK PASS
-- notice provide database evidence; an application-side JavaScript flag cannot.
-- <<< LOCK_OBSERVER_END

-- >>> SESSION_A_COMMIT_BEGIN
-- ========================================================================== 
-- STEP 5 — SESSION A: COMMIT THE WINNER
-- ========================================================================== 
-- Run this in Session A only after the observer query proves Session B waits.

COMMIT;

SELECT
    'SESSION A COMMITTED' AS outcome,
    clock_timestamp() AS committed_at;
-- <<< SESSION_A_COMMIT_END

-- ========================================================================== 
-- EXPECTED AUTOMATIC RESULT IN SESSION B
-- ========================================================================== 
-- After Session A commits, Session B wakes. Under READ COMMITTED, PostgreSQL
-- rechecks the row after the wait, observes unit 12 as RESERVED, finds no other
-- usable AB- unit, and reserve_emergency_blood raises:
--
--   ERROR: No reservable AB- blood unit is available to this user
--   SQLSTATE: P0002 (no_data_found)
--
-- Session B is now in an aborted transaction and must be rolled back.

-- >>> SESSION_B_ROLLBACK_BEGIN
-- ========================================================================== 
-- STEP 6 — SESSION B: ROLLBACK AFTER THE EXPECTED ERROR
-- ========================================================================== 
-- Run this in Session B after the P0002 error appears.

ROLLBACK;

SELECT
    'SESSION B ROLLED BACK AFTER EXPECTED P0002' AS outcome,
    clock_timestamp() AS rolled_back_at;
-- <<< SESSION_B_ROLLBACK_END

-- >>> PROOF_BEGIN
-- ========================================================================== 
-- STEP 7 — FINAL PROOF (run in either session)
-- ========================================================================== 

SET search_path TO lifelink, public;

SELECT
    bu.blood_unit_id,
    bu.blood_group,
    bu.status AS unit_status,
    br.reservation_id,
    br.request_id AS winning_request_id,
    winner_hospital.name AS winning_hospital,
    br.status AS reservation_status,
    br.created_by,
    br.reserved_at,
    br.expires_at
FROM blood_unit AS bu
JOIN blood_reservation AS br
    ON br.blood_unit_id = bu.blood_unit_id
   AND br.status = 'ACTIVE'
JOIN emergency_request AS er
    ON er.request_id = br.request_id
JOIN doctor AS d
    ON d.doctor_id = er.requested_by
JOIN hospital AS winner_hospital
    ON winner_hospital.hospital_id = d.hospital_id
WHERE bu.blood_unit_id = 12;

SELECT
    er.request_id,
    h.name AS hospital_name,
    er.status,
    COUNT(br.reservation_id) FILTER (
        WHERE br.status = 'ACTIVE'
    ) AS active_reservation_count
FROM emergency_request AS er
JOIN doctor AS d
    ON d.doctor_id = er.requested_by
JOIN hospital AS h
    ON h.hospital_id = d.hospital_id
LEFT JOIN blood_reservation AS br
    ON br.request_id = er.request_id
WHERE er.request_id IN (9, -910002)
GROUP BY er.request_id, h.name, er.status
ORDER BY er.request_id DESC;

-- Expected:
--   request 9       -> RESERVED, one ACTIVE reservation (winner)
--   request -910002 -> PENDING,  zero ACTIVE reservations (safe loser)

DO $concurrency_proof$
DECLARE
    v_active_unit_reservations INTEGER;
    v_winning_request_id INTEGER;
    v_unit_status VARCHAR(20);
    v_winner_status VARCHAR(30);
    v_loser_status VARCHAR(30);
BEGIN
    SELECT
        COUNT(*)::INTEGER,
        MAX(request_id)
    INTO
        v_active_unit_reservations,
        v_winning_request_id
    FROM blood_reservation
    WHERE blood_unit_id = 12
      AND status = 'ACTIVE';

    SELECT status
    INTO STRICT v_unit_status
    FROM blood_unit
    WHERE blood_unit_id = 12;

    SELECT status
    INTO STRICT v_winner_status
    FROM emergency_request
    WHERE request_id = 9;

    SELECT status
    INTO STRICT v_loser_status
    FROM emergency_request
    WHERE request_id = -910002;

    IF v_active_unit_reservations <> 1
       OR v_winning_request_id <> 9
       OR v_unit_status <> 'RESERVED'
       OR v_winner_status <> 'RESERVED'
       OR v_loser_status <> 'PENDING'
       OR EXISTS (
           SELECT 1
           FROM blood_reservation
           WHERE request_id = -910002
             AND status = 'ACTIVE'
       ) THEN
        RAISE EXCEPTION
            'CONCURRENCY PROOF FAILED — winner/loser state is inconsistent';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM audit_log
        WHERE table_name = 'blood_unit'
          AND record_id = '12'
          AND action = 'STATUS_CHANGE'
          AND old_status = 'AVAILABLE'
          AND new_status = 'RESERVED'
    ) OR NOT EXISTS (
        SELECT 1
        FROM audit_log
        WHERE table_name = 'emergency_request'
          AND record_id = '9'
          AND action = 'RESERVATION_PROGRESS'
          AND new_status = 'RESERVED'
    ) THEN
        RAISE EXCEPTION
            'CONCURRENCY PROOF FAILED — required winner audit events are missing';
    END IF;

    RAISE NOTICE
        'CONCURRENCY PASS — exactly one ACTIVE reservation; request 9 won and request -910002 failed safely';
END;
$concurrency_proof$;

WITH winning_reservation AS (
    SELECT reservation_id, reserved_at
    FROM blood_reservation
    WHERE blood_unit_id = 12
      AND request_id = 9
      AND status = 'ACTIVE'
)
SELECT
    al.audit_id,
    al.table_name,
    al.record_id,
    al.action,
    al.old_status,
    al.new_status,
    al.action_time,
    al.details
FROM audit_log AS al
CROSS JOIN winning_reservation AS wr
WHERE al.action_time >= wr.reserved_at
  AND (
      (al.table_name = 'blood_unit' AND al.record_id = '12')
      OR (al.table_name = 'blood_reservation' AND al.record_id = wr.reservation_id::TEXT)
      OR (al.table_name = 'emergency_request' AND al.record_id = '9')
  )
ORDER BY al.action_time, al.audit_id;
-- <<< PROOF_END

-- >>> CLEANUP_BEGIN
-- ========================================================================== 
-- STEP 8 — CLEANUP / RESET OPERATIONAL STATE (run once in either session)
-- ========================================================================== 
-- Cleanup deliberately uses valid lifecycle transitions. It retains a
-- CANCELLED reservation and audit history instead of erasing evidence.

BEGIN;
SET LOCAL search_path TO lifelink, public;

DO $concurrency_cleanup$
DECLARE
    v_reservation_id INTEGER;
BEGIN
    SELECT reservation_id
    INTO STRICT v_reservation_id
    FROM blood_reservation
    WHERE request_id = 9
      AND blood_unit_id = 12
      AND status = 'ACTIVE'
    FOR UPDATE;

    PERFORM set_config('lifelink.app_user_id', '8', TRUE);

    -- ACTIVE must become terminal before the RESERVED unit can be released.
    UPDATE blood_reservation
    SET status = 'CANCELLED'
    WHERE reservation_id = v_reservation_id;

    UPDATE blood_unit
    SET status = 'AVAILABLE'
    WHERE blood_unit_id = 12
      AND status = 'RESERVED';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cleanup could not return blood unit 12 to AVAILABLE';
    END IF;

    UPDATE emergency_request
    SET status = 'PENDING'
    WHERE request_id = 9
      AND status = 'RESERVED';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cleanup could not return request 9 to PENDING';
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
        8,
        'emergency_request',
        '9',
        'CONCURRENCY_DEMO_RESET',
        'RESERVED',
        'PENDING',
        format(
            'Demo reservation %s cancelled; unit 12 returned to AVAILABLE.',
            v_reservation_id
        )
    );

    DELETE FROM emergency_request
    WHERE request_id = -910002;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cleanup could not delete temporary request -910002';
    END IF;

    RAISE NOTICE
        'CLEANUP PASS — reservation % cancelled; operational seed state restored',
        v_reservation_id;
END;
$concurrency_cleanup$;

COMMIT;

DO $cleanup_proof$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM blood_unit
        WHERE blood_unit_id = 12
          AND status = 'AVAILABLE'
    ) OR NOT EXISTS (
        SELECT 1
        FROM emergency_request
        WHERE request_id = 9
          AND status = 'PENDING'
    ) OR EXISTS (
        SELECT 1
        FROM emergency_request
        WHERE request_id = -910002
    ) OR EXISTS (
        SELECT 1
        FROM blood_reservation
        WHERE blood_unit_id = 12
          AND status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'CLEANUP PROOF FAILED — operational state was not restored';
    END IF;

    RAISE NOTICE
        'FINAL CLEANUP PASS — unit 12 AVAILABLE, request 9 PENDING, no temporary request or ACTIVE hold';
END;
$cleanup_proof$;

SELECT
    br.reservation_id,
    br.request_id,
    br.blood_unit_id,
    br.status,
    br.reserved_at,
    'Retained as concurrency-demo history' AS retention_reason
FROM blood_reservation AS br
WHERE br.request_id = 9
  AND br.blood_unit_id = 12
ORDER BY br.reservation_id DESC
LIMIT 1;
-- <<< CLEANUP_END

/*
 * VIVA EXPLANATION
 * --------------------------------------------------------------------------
 * Race condition
 *   Without locking, both sessions could read unit 12 as AVAILABLE before
 *   either updates it, then both could attempt to allocate the same real unit.
 *
 * Why SELECT FOR UPDATE works
 *   reserve_emergency_blood first locks its request and then selects the FEFO
 *   candidate with FOR UPDATE OF blood_unit. The two requests are different,
 *   so the contested lock in this demonstration is the shared unit 12 row.
 *   Session B waits for Session A's transaction to finish. At PostgreSQL's
 *   default READ COMMITTED isolation level, B rechecks the row after the wait;
 *   status is now RESERVED, so it no longer satisfies status = 'AVAILABLE'.
 *
 * Atomicity
 *   Reservation insert, unit status update, request status update, and audit
 *   writes succeed together or roll back together.
 *
 * Consistency
 *   Triggers, foreign keys, lifecycle checks, the one-ACTIVE-reservation
 *   partial unique index, and the function preserve valid business states.
 *
 * Isolation
 *   A's uncommitted changes are hidden from B, while row locks serialize the
 *   conflicting allocation attempts.
 *
 * Durability
 *   After A commits, its reservation and audit history survive later sessions.
 *
 * COMMIT and ROLLBACK
 *   COMMIT makes A's winner permanent and releases its locks. B's expected
 *   exception aborts its transaction, so ROLLBACK clears that failed attempt.
 *
 * Why SKIP LOCKED is not used here
 *   SKIP LOCKED is useful for worker queues, but it would skip the locked unit
 *   immediately and hide the visible waiting behavior this academic demo is
 *   designed to prove. Plain FOR UPDATE is clearer for this viva.
 */
