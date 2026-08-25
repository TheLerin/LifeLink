/*
 * LifeLink — Multi-Hospital Blood and Organ Allocation System
 * Phase 11: Workload-driven PostgreSQL indexes
 *
 * Run after:
 *   1. 01_schema.sql
 *   2. 02_constraints.sql
 *   3. 03_sample_data.sql       (recommended for demonstration)
 *   4. 04_views.sql
 *   5. 05_trigger_functions.sql
 *   6. 06_triggers.sql
 *   7. 07_functions_procedures.sql
 *
 * Design rules:
 *   - Index actual filtering, joining, ordering, and maintenance workloads.
 *   - Put equality columns before range/order columns in composite B-trees.
 *   - Use partial indexes only when the workload repeatedly targets a stable
 *     subset such as AVAILABLE units or ACTIVE reservations.
 *   - Do not duplicate indexes already supplied by primary keys, UNIQUE
 *     constraints, or the integrity indexes in 02_constraints.sql.
 *
 * All indexes in this file are non-unique performance indexes. Uniqueness and
 * business integrity remain the responsibility of 01_schema.sql and
 * 02_constraints.sql.
 */

BEGIN;

SET search_path TO lifelink, public;

-- ========================================================================== 
-- 1. Emergency exact-group blood selection in FEFO order
-- ========================================================================== 
-- Benefits:
--   reserve_emergency_blood(), available_blood_units_view, and the
--   "Reserve Best Unit" API workflow.
--
-- Column order:
--   blood_group is tested for equality; expiry_date and blood_unit_id match
--   ORDER BY expiry_date, blood_unit_id. The ID gives deterministic ordering.
--
-- Why partial:
--   Operational allocation searches only AVAILABLE rows. Keeping terminal,
--   testing, rejected, and reserved rows out makes the index smaller.

DROP INDEX IF EXISTS idx_blood_unit_available_fefo;
CREATE INDEX idx_blood_unit_available_fefo
    ON blood_unit (blood_group, expiry_date, blood_unit_id)
    WHERE status = 'AVAILABLE';

COMMENT ON INDEX idx_blood_unit_available_fefo IS
    'Partial FEFO index for exact-group AVAILABLE emergency blood selection.';

-- ========================================================================== 
-- 2. Blood-bank inventory and expiry reporting
-- ========================================================================== 
-- Benefits:
--   generate_inventory_report(), bank inventory screens, and bank-specific
--   expiring-unit reports.
--
-- Column order:
--   The bank is normally selected first, then lifecycle status and blood
--   group; expiry_date supports range filtering and ordering inside that set.
--
-- Why full/non-unique:
--   Inventory reports intentionally include every lifecycle state, and many
--   units may share the same bank, status, group, and expiry date.

DROP INDEX IF EXISTS idx_blood_unit_bank_status_group_expiry;
CREATE INDEX idx_blood_unit_bank_status_group_expiry
    ON blood_unit (
        current_blood_bank_id,
        status,
        blood_group,
        expiry_date,
        blood_unit_id
    );

COMMENT ON INDEX idx_blood_unit_bank_status_group_expiry IS
    'Bank-first inventory index for status/group filters and expiry ranges.';

-- ========================================================================== 
-- 3. Global active-emergency dashboard
-- ========================================================================== 
-- Benefits:
--   active_emergency_requests_view and dashboard queries such as
--   "show CRITICAL active requests, oldest first".
--
-- Column order:
--   priority is an equality filter; requested_at then provides chronological
--   order; request_id is a deterministic tie-breaker.
--
-- Why partial:
--   Completed and cancelled requests never appear on the active dashboard.

DROP INDEX IF EXISTS idx_emergency_request_active_priority;
CREATE INDEX idx_emergency_request_active_priority
    ON emergency_request (priority, requested_at, request_id)
    WHERE status IN ('PENDING', 'PARTIALLY_RESERVED', 'RESERVED', 'MATCHED');

COMMENT ON INDEX idx_emergency_request_active_priority IS
    'Partial priority/time index for active emergency dashboard queries.';

-- ========================================================================== 
-- 4. Active requests by doctor and therefore by hospital
-- ========================================================================== 
-- Benefits:
--   A hospital is derived through emergency_request.requested_by -> doctor ->
--   hospital. This index supports request lookups after the relevant doctors
--   have been selected for a hospital.
--
-- Column order:
--   requested_by is the join/equality key, followed by newest request time and
--   a deterministic ID.
--
-- Normalization note:
--   The earlier conceptual candidate recipient(hospital_id) is intentionally
--   not created. RECIPIENT has no hospital_id in the approved 3NF schema;
--   storing it there would duplicate the request/doctor hospital relationship.

DROP INDEX IF EXISTS idx_emergency_request_requester_active;
CREATE INDEX idx_emergency_request_requester_active
    ON emergency_request (requested_by, requested_at DESC, request_id)
    WHERE status IN ('PENDING', 'PARTIALLY_RESERVED', 'RESERVED', 'MATCHED');

COMMENT ON INDEX idx_emergency_request_requester_active IS
    'Partial requester/time index supporting active doctor and hospital request lists.';

-- ========================================================================== 
-- 5. Organ availability and matching lookup
-- ========================================================================== 
-- Benefits:
--   Organ inventory screens and candidate selection by organ type and status.
--
-- Column order:
--   organ_type and status are equality predicates; organ_unit_id makes result
--   order deterministic and helps joins to organ_match.
--
-- Why full/non-unique:
--   Reports may inspect any organ lifecycle status, and multiple units may
--   have the same type and state.

DROP INDEX IF EXISTS idx_organ_unit_type_status;
CREATE INDEX idx_organ_unit_type_status
    ON organ_unit (organ_type, status, organ_unit_id);

COMMENT ON INDEX idx_organ_unit_type_status IS
    'Organ-type/status index for availability and academic matching workflows.';

-- ========================================================================== 
-- 6. Reservation progress for one emergency request
-- ========================================================================== 
-- Benefits:
--   reserve_emergency_blood(), release_expired_reservations(),
--   active_emergency_requests_view, and request-detail pages.
--
-- Column order:
--   request_id is always known first; status narrows active/completed rows;
--   reserved_at supports MIN(), history order, and first-reservation lookup.
--
-- Why non-unique:
--   A multi-unit request legitimately has several reservation rows.

DROP INDEX IF EXISTS idx_blood_reservation_request_status;
CREATE INDEX idx_blood_reservation_request_status
    ON blood_reservation (
        request_id,
        status,
        reserved_at,
        reservation_id
    );

COMMENT ON INDEX idx_blood_reservation_request_status IS
    'Request/status index for allocation counts, first reservation, and history.';

-- ========================================================================== 
-- 7. Expired ACTIVE hold maintenance
-- ========================================================================== 
-- Benefits:
--   release_expired_reservations(), which searches ACTIVE holds at or before
--   CURRENT_TIMESTAMP and processes them in expiry order.
--
-- Column order:
--   expires_at is the range and order key; reservation_id is a stable tie-break.
--
-- Why partial:
--   Terminal reservation history is irrelevant to timeout maintenance.

DROP INDEX IF EXISTS idx_blood_reservation_active_expiry;
CREATE INDEX idx_blood_reservation_active_expiry
    ON blood_reservation (expires_at, reservation_id)
    WHERE status = 'ACTIVE';

COMMENT ON INDEX idx_blood_reservation_active_expiry IS
    'Partial time-ordered index for releasing elapsed ACTIVE reservation holds.';

-- ========================================================================== 
-- 8. Source rows for per-organ academic ranking
-- ========================================================================== 
-- Benefits:
--   organ_match_priority_view and per-organ candidate screens.
--
-- Column order:
--   organ_unit_id selects one ranking group; match_status narrows visible
--   candidates; compatibility_score supplies the stored score component.
--   calculated_at and match_id provide stable secondary ordering/lookups.
--
-- Important limitation:
--   final_priority also depends on request urgency and waiting time, so this
--   index narrows source rows but cannot replace the view's final computed sort.

DROP INDEX IF EXISTS idx_organ_match_rank_source;
CREATE INDEX idx_organ_match_rank_source
    ON organ_match (
        organ_unit_id,
        match_status,
        compatibility_score DESC,
        calculated_at,
        match_id
    )
    WHERE match_status IN ('CANDIDATE', 'SELECTED', 'COMPLETED');

COMMENT ON INDEX idx_organ_match_rank_source IS
    'Partial source index for visible per-organ academic match rankings.';

-- ========================================================================== 
-- 9. Donor history and simplified eligibility checks
-- ========================================================================== 
-- Benefits:
--   eligible_donors_view, donor history pages, and register_donation() checking
--   whether an ACTIVE blood donation exists in the preceding 90-day window.
--
-- Column order:
--   donor_id and donation_type are equality keys; descending donation_date
--   supports MAX/latest-date and recent-date range queries.
--
-- Why partial:
--   VOIDED records must not affect active history or the academic interval rule.

DROP INDEX IF EXISTS idx_donation_donor_type_date;
CREATE INDEX idx_donation_donor_type_date
    ON donation (donor_id, donation_type, donation_date DESC, donation_id)
    WHERE record_status = 'ACTIVE';

COMMENT ON INDEX idx_donation_donor_type_date IS
    'Partial active donation-history index for latest date and interval checks.';

-- ========================================================================== 
-- 10. Entity-specific audit timeline
-- ========================================================================== 
-- Benefits:
--   The audit page shown after reservation, release, issue, and match actions.
--
-- Column order:
--   table_name and record_id identify one business record; descending time and
--   audit ID return its newest events first with deterministic ties.
--
-- Why full/non-unique:
--   Audit history is retained for all entities and many events may belong to
--   the same record.

DROP INDEX IF EXISTS idx_audit_log_entity_time;
CREATE INDEX idx_audit_log_entity_time
    ON audit_log (table_name, record_id, action_time DESC, audit_id DESC);

COMMENT ON INDEX idx_audit_log_entity_time IS
    'Entity/time index for newest-first audit history.';

COMMIT;

/*
 * Existing indexes deliberately not duplicated
 * --------------------------------------------------------------------------
 * PostgreSQL already creates B-tree indexes for every PRIMARY KEY and UNIQUE
 * constraint. In particular:
 *
 *   uq_user_account_username
 *       already supports login lookup by username.
 *
 *   pk_medical_test_result (donation_id, test_no)
 *       already supports screening lookup by donation_id because it is the
 *       leading key; a separate donation_id index would be redundant.
 *
 *   uq_organ_match_request_unit (request_id, organ_unit_id)
 *       already supports calculate_organ_match() upsert/conflict lookup.
 *
 * Integrity-focused partial UNIQUE indexes from 02_constraints.sql are kept:
 *
 *   uq_donor_phone_one_primary
 *   uq_blood_reservation_one_active_unit
 *   uq_organ_match_one_allocation_per_unit
 *   uq_organ_match_one_allocation_per_request
 *
 * The performance indexes above complement those guarantees; they do not
 * replace them.
 */

/*
 * Optional viva EXPLAIN demonstrations
 * --------------------------------------------------------------------------
 * The fictional seed contains only about twenty units. PostgreSQL may correctly
 * prefer a sequential scan for such a tiny table, because reading one small
 * page can be cheaper than using an index. That does not mean the index design
 * is wrong. Use realistic larger test data for a performance comparison.
 *
 * EXPLAIN only (safe; does not execute the query):
 *
 *   EXPLAIN (COSTS, VERBOSE)
 *   SELECT blood_unit_id
 *   FROM lifelink.blood_unit
 *   WHERE blood_group = 'AB-'
 *     AND status = 'AVAILABLE'
 *     AND expiry_date >= CURRENT_DATE
 *   ORDER BY expiry_date, blood_unit_id
 *   LIMIT 1;
 *
 *   EXPLAIN (COSTS, VERBOSE)
 *   SELECT reservation_id
 *   FROM lifelink.blood_reservation
 *   WHERE status = 'ACTIVE'
 *     AND expires_at <= CURRENT_TIMESTAMP
 *   ORDER BY expires_at, reservation_id;
 *
 * To prove index eligibility on the small demo dataset without claiming a
 * real speedup, use a transaction-local planner setting and then roll it back:
 *
 *   BEGIN;
 *   SET LOCAL enable_seqscan = off;
 *
 *   EXPLAIN (COSTS OFF)
 *   SELECT blood_unit_id
 *   FROM lifelink.blood_unit
 *   WHERE blood_group = 'AB-'
 *     AND status = 'AVAILABLE'
 *     AND expiry_date >= CURRENT_DATE
 *   ORDER BY expiry_date, blood_unit_id
 *   LIMIT 1;
 *
 *   ROLLBACK;
 *
 * For an actual performance comparison on a disposable larger dataset, use
 * EXPLAIN (ANALYZE, BUFFERS). Do not run write queries with ANALYZE merely for
 * presentation.
 */
