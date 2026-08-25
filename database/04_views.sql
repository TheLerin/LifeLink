/*
 * LifeLink — Multi-Hospital Blood and Organ Allocation System
 * Phase 7: PostgreSQL views
 *
 * Prerequisites:
 *   1. 01_schema.sql
 *   2. 02_constraints.sql
 *   3. 03_sample_data.sql (recommended for demonstration)
 *
 * These are standard, non-materialized views. Date-sensitive values such as
 * age, days to expiry, request age, waiting score, and final organ priority
 * are calculated whenever the view is queried.
 */

BEGIN;

SET search_path TO lifelink, public;

-- --------------------------------------------------------------------------
-- 1. Eligible donors
-- --------------------------------------------------------------------------
-- Simplified academic rule only:
--   * active donor
--   * age from 18 through 65
--   * weight at least 50 kg
--   * no ACTIVE recorded donor condition
--   * no blood donation during the previous 90 days
--
-- This view must never be described as medical clearance.

CREATE OR REPLACE VIEW eligible_donors_view AS
WITH last_blood_donation AS (
    SELECT
        d.donor_id,
        MAX(dn.donation_date) AS last_blood_donation_date
    FROM donor AS d
    LEFT JOIN donation AS dn
        ON dn.donor_id = d.donor_id
       AND dn.donation_type = 'BLOOD'
       AND dn.record_status = 'ACTIVE'
    GROUP BY d.donor_id
),
active_conditions AS (
    SELECT
        dc.donor_id,
        COUNT(*)::INTEGER AS active_condition_count
    FROM donor_condition AS dc
    WHERE dc.condition_status = 'ACTIVE'
    GROUP BY dc.donor_id
),
donor_facts AS (
    SELECT
        d.donor_id,
        p.full_name,
        d.blood_group,
        d.weight_kg,
        EXTRACT(YEAR FROM AGE(CURRENT_DATE, p.date_of_birth))::INTEGER AS age_years,
        lbd.last_blood_donation_date,
        COALESCE(ac.active_condition_count, 0) AS active_condition_count
    FROM donor AS d
    JOIN person AS p
        ON p.person_id = d.donor_id
    LEFT JOIN last_blood_donation AS lbd
        ON lbd.donor_id = d.donor_id
    LEFT JOIN active_conditions AS ac
        ON ac.donor_id = d.donor_id
    WHERE d.is_active
)
SELECT
    donor_id,
    full_name,
    blood_group,
    weight_kg,
    age_years,
    last_blood_donation_date,
    active_condition_count,
    'ELIGIBLE_DEMO'::TEXT AS eligibility_status,
    'Simplified academic rule; not medical clearance'::TEXT AS eligibility_note
FROM donor_facts
WHERE age_years BETWEEN 18 AND 65
  AND weight_kg >= 50
  AND active_condition_count = 0
  AND (
      last_blood_donation_date IS NULL
      OR last_blood_donation_date <= CURRENT_DATE - 90
  );

COMMENT ON VIEW eligible_donors_view IS
    'Donors passing simplified academic criteria; not medical clearance.';

-- --------------------------------------------------------------------------
-- 2. Available, usable blood units
-- --------------------------------------------------------------------------
-- An exposed unit must be marked AVAILABLE, unexpired, attached to an active
-- donation and active current bank, and have at least one screening result
-- with every recorded result equal to PASS.

CREATE OR REPLACE VIEW available_blood_units_view AS
WITH screening_summary AS (
    SELECT
        mtr.donation_id,
        COUNT(*)::INTEGER AS screening_test_count,
        BOOL_AND(mtr.result = 'PASS') AS all_tests_passed
    FROM medical_test_result AS mtr
    GROUP BY mtr.donation_id
)
SELECT
    bu.blood_unit_id,
    bu.donation_id,
    dn.donor_id,
    dp.full_name AS donor_name,
    bu.blood_group,
    bd.collection_bank_id,
    collection_bank.name AS collection_bank_name,
    bu.current_blood_bank_id,
    current_bank.name AS current_blood_bank_name,
    dn.donation_date AS collection_date,
    bu.expiry_date,
    (bu.expiry_date - CURRENT_DATE)::INTEGER AS days_to_expiry,
    bu.status,
    ss.screening_test_count,
    ss.all_tests_passed
FROM blood_unit AS bu
JOIN blood_donation AS bd
    ON bd.donation_id = bu.donation_id
JOIN donation AS dn
    ON dn.donation_id = bd.donation_id
JOIN donor AS d
    ON d.donor_id = dn.donor_id
JOIN person AS dp
    ON dp.person_id = d.donor_id
JOIN blood_bank AS collection_bank
    ON collection_bank.blood_bank_id = bd.collection_bank_id
JOIN blood_bank AS current_bank
    ON current_bank.blood_bank_id = bu.current_blood_bank_id
JOIN screening_summary AS ss
    ON ss.donation_id = bu.donation_id
WHERE bu.status = 'AVAILABLE'
  AND bu.expiry_date >= CURRENT_DATE
  AND dn.record_status = 'ACTIVE'
  AND current_bank.status = 'ACTIVE'
  AND ss.screening_test_count > 0
  AND ss.all_tests_passed;

COMMENT ON VIEW available_blood_units_view IS
    'Non-expired, screened AVAILABLE blood units held by active blood banks.';

-- --------------------------------------------------------------------------
-- 3. Active emergency requests
-- --------------------------------------------------------------------------
-- hospital_id is normalized out of emergency_request. It is derived through
-- the requesting doctor's hospital association.

CREATE OR REPLACE VIEW active_emergency_requests_view AS
WITH reservation_totals AS (
    SELECT
        br.request_id,
        COUNT(*) FILTER (
            WHERE br.status IN ('ACTIVE', 'COMPLETED')
        )::INTEGER AS allocated_units,
        MIN(br.reserved_at) FILTER (
            WHERE br.status IN ('ACTIVE', 'COMPLETED')
        ) AS first_reserved_at
    FROM blood_reservation AS br
    GROUP BY br.request_id
),
selected_organ_matches AS (
    SELECT
        om.request_id,
        MAX(om.organ_unit_id) AS selected_organ_unit_id
    FROM organ_match AS om
    WHERE om.match_status IN ('SELECTED', 'COMPLETED')
    GROUP BY om.request_id
)
SELECT
    er.request_id,
    h.hospital_id,
    h.name AS hospital_name,
    er.recipient_id,
    recipient_person.full_name AS recipient_name,
    r.blood_group AS recipient_blood_group,
    er.requested_by AS doctor_id,
    doctor_person.full_name AS doctor_name,
    er.request_type,
    er.blood_group AS requested_blood_group,
    er.organ_type AS requested_organ_type,
    er.units_required,
    er.priority,
    er.requested_at,
    ROUND(
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - er.requested_at)) / 3600.0,
        2
    ) AS request_age_hours,
    er.status,
    CASE
        WHEN er.request_type = 'BLOOD'
            THEN COALESCE(rt.allocated_units, 0)
        ELSE NULL
    END AS allocated_units,
    CASE
        WHEN er.request_type = 'BLOOD'
            THEN GREATEST(er.units_required - COALESCE(rt.allocated_units, 0), 0)
        ELSE NULL
    END AS units_remaining,
    rt.first_reserved_at,
    som.selected_organ_unit_id,
    er.notes
FROM emergency_request AS er
JOIN recipient AS r
    ON r.recipient_id = er.recipient_id
JOIN person AS recipient_person
    ON recipient_person.person_id = r.recipient_id
JOIN doctor AS d
    ON d.doctor_id = er.requested_by
JOIN person AS doctor_person
    ON doctor_person.person_id = d.doctor_id
JOIN hospital AS h
    ON h.hospital_id = d.hospital_id
LEFT JOIN reservation_totals AS rt
    ON rt.request_id = er.request_id
LEFT JOIN selected_organ_matches AS som
    ON som.request_id = er.request_id
WHERE er.status IN ('PENDING', 'PARTIALLY_RESERVED', 'RESERVED', 'MATCHED');

COMMENT ON VIEW active_emergency_requests_view IS
    'Active blood and organ requests with hospital, people, and allocation progress.';

-- --------------------------------------------------------------------------
-- 4. Transparent academic organ-match priorities
-- --------------------------------------------------------------------------
-- Stored base fact:
--   compatibility_score — specific to one request/unit pair
--
-- Derived academic components:
--   urgency: LOW=25, MEDIUM=50, HIGH=75, CRITICAL=100
--   waiting: one point per whole waiting day, capped at 100
--   final:   50% compatibility + 30% urgency + 20% waiting

CREATE OR REPLACE VIEW organ_match_priority_view AS
WITH component_scores AS (
    SELECT
        om.match_id,
        om.request_id,
        om.organ_unit_id,
        ou.organ_type,
        er.recipient_id,
        recipient_person.full_name AS recipient_name,
        r.blood_group AS recipient_blood_group,
        d.hospital_id,
        h.name AS hospital_name,
        er.priority,
        er.requested_at,
        er.status AS request_status,
        om.compatibility_score,
        CASE er.priority
            WHEN 'LOW'      THEN 25::NUMERIC
            WHEN 'MEDIUM'   THEN 50::NUMERIC
            WHEN 'HIGH'     THEN 75::NUMERIC
            WHEN 'CRITICAL' THEN 100::NUMERIC
        END AS urgency_score,
        LEAST(
            100::NUMERIC,
            GREATEST(
                0::NUMERIC,
                FLOOR(
                    EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - er.requested_at))
                    / 86400
                )
            )
        ) AS waiting_time_score,
        om.match_status,
        om.calculated_at
    FROM organ_match AS om
    JOIN emergency_request AS er
        ON er.request_id = om.request_id
    JOIN organ_unit AS ou
        ON ou.organ_unit_id = om.organ_unit_id
    JOIN recipient AS r
        ON r.recipient_id = er.recipient_id
    JOIN person AS recipient_person
        ON recipient_person.person_id = r.recipient_id
    JOIN doctor AS d
        ON d.doctor_id = er.requested_by
    JOIN hospital AS h
        ON h.hospital_id = d.hospital_id
    WHERE er.request_type = 'ORGAN'
      AND er.organ_type = ou.organ_type
      AND om.match_status IN ('CANDIDATE', 'SELECTED', 'COMPLETED')
),
scored_matches AS (
    SELECT
        component_scores.*,
        ROUND(
              0.50 * compatibility_score
            + 0.30 * urgency_score
            + 0.20 * waiting_time_score,
            2
        ) AS final_priority
    FROM component_scores
)
SELECT
    match_id,
    request_id,
    organ_unit_id,
    organ_type,
    recipient_id,
    recipient_name,
    recipient_blood_group,
    hospital_id,
    hospital_name,
    priority,
    requested_at,
    request_status,
    compatibility_score,
    urgency_score,
    waiting_time_score,
    final_priority,
    ROW_NUMBER() OVER (
        PARTITION BY organ_unit_id
        ORDER BY final_priority DESC, requested_at, match_id
    ) AS candidate_rank,
    match_status,
    calculated_at
FROM scored_matches;

COMMENT ON VIEW organ_match_priority_view IS
    'Transparent academic organ priority components and per-organ ranking; not clinical guidance.';

-- --------------------------------------------------------------------------
-- 5. Blood units expiring soon
-- --------------------------------------------------------------------------
-- Seven days is the fixed academic demonstration window. The later report API
-- may use a parameterized function when a caller needs a different window.

CREATE OR REPLACE VIEW expiring_blood_units_view AS
SELECT
    blood_unit_id,
    donation_id,
    donor_id,
    donor_name,
    blood_group,
    collection_bank_id,
    collection_bank_name,
    current_blood_bank_id,
    current_blood_bank_name,
    collection_date,
    expiry_date,
    days_to_expiry,
    screening_test_count,
    all_tests_passed
FROM available_blood_units_view
WHERE days_to_expiry BETWEEN 0 AND 7;

COMMENT ON VIEW expiring_blood_units_view IS
    'Screened AVAILABLE blood units expiring today or within the next seven days.';

COMMIT;

/*
 * Example queries
 * --------------------------------------------------------------------------
 *
 * 1. Eligible O+ donors:
 *    SELECT *
 *    FROM lifelink.eligible_donors_view
 *    WHERE blood_group = 'O+'
 *    ORDER BY full_name;
 *
 * 2. FEFO-style available inventory:
 *    SELECT *
 *    FROM lifelink.available_blood_units_view
 *    WHERE blood_group = 'AB-'
 *    ORDER BY expiry_date, blood_unit_id;
 *
 * 3. Critical active requests:
 *    SELECT *
 *    FROM lifelink.active_emergency_requests_view
 *    WHERE priority = 'CRITICAL'
 *    ORDER BY requested_at;
 *
 * 4. Ranked candidates for one organ:
 *    SELECT *
 *    FROM lifelink.organ_match_priority_view
 *    WHERE organ_unit_id = 1
 *    ORDER BY candidate_rank;
 *
 * 5. Expiring inventory:
 *    SELECT *
 *    FROM lifelink.expiring_blood_units_view
 *    ORDER BY days_to_expiry, blood_group;
 */
