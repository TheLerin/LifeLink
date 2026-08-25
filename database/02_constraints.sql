/*
 * LifeLink — Multi-Hospital Blood and Organ Allocation System
 * Phase 5: Relational constraints
 *
 * Prerequisite: run 01_schema.sql first.
 *
 * This file adds alternate keys, foreign keys, CHECK constraints, and the
 * small set of partial unique indexes whose purpose is data integrity rather
 * than query performance. Cross-table and lifecycle rules that require
 * PL/pgSQL are deliberately deferred to the trigger/function phases.
 */

BEGIN;

SET search_path TO lifelink, public;

-- --------------------------------------------------------------------------
-- Alternate and candidate keys
-- --------------------------------------------------------------------------

ALTER TABLE hospital
    ADD CONSTRAINT uq_hospital_name_address UNIQUE (name, address_id);

ALTER TABLE blood_bank
    ADD CONSTRAINT uq_blood_bank_name_address UNIQUE (name, address_id);

ALTER TABLE organ_bank
    ADD CONSTRAINT uq_organ_bank_name_address UNIQUE (name, address_id);

ALTER TABLE medical_condition
    ADD CONSTRAINT uq_medical_condition_name UNIQUE (condition_name);

ALTER TABLE doctor
    ADD CONSTRAINT uq_doctor_license_no UNIQUE (license_no);

ALTER TABLE donor_phone
    ADD CONSTRAINT uq_donor_phone_number UNIQUE (donor_id, phone_number);

ALTER TABLE donation_registration
    ADD CONSTRAINT uq_camp_donor_registration UNIQUE (camp_id, donor_id);

ALTER TABLE user_account
    ADD CONSTRAINT uq_user_account_username UNIQUE (username),
    ADD CONSTRAINT uq_user_account_person_role UNIQUE (person_id, role);

ALTER TABLE blood_unit
    ADD CONSTRAINT uq_blood_unit_donation UNIQUE (donation_id);

ALTER TABLE organ_unit
    ADD CONSTRAINT uq_organ_unit_donation UNIQUE (donation_id);

ALTER TABLE organ_match
    ADD CONSTRAINT uq_organ_match_request_unit UNIQUE (request_id, organ_unit_id);

-- Integrity-focused partial unique indexes. Workload/performance indexes are
-- intentionally reserved for database/08_indexes.sql.

CREATE UNIQUE INDEX uq_donor_phone_one_primary
    ON donor_phone (donor_id)
    WHERE is_primary;

CREATE UNIQUE INDEX uq_blood_reservation_one_active_unit
    ON blood_reservation (blood_unit_id)
    WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX uq_organ_match_one_allocation_per_unit
    ON organ_match (organ_unit_id)
    WHERE match_status IN ('SELECTED', 'COMPLETED');

CREATE UNIQUE INDEX uq_organ_match_one_allocation_per_request
    ON organ_match (request_id)
    WHERE match_status IN ('SELECTED', 'COMPLETED');

-- --------------------------------------------------------------------------
-- Foreign keys and referential actions
-- --------------------------------------------------------------------------

ALTER TABLE person
    ADD CONSTRAINT fk_person_address
        FOREIGN KEY (address_id) REFERENCES address(address_id)
        ON DELETE RESTRICT;

ALTER TABLE hospital
    ADD CONSTRAINT fk_hospital_address
        FOREIGN KEY (address_id) REFERENCES address(address_id)
        ON DELETE RESTRICT;

ALTER TABLE blood_bank
    ADD CONSTRAINT fk_blood_bank_address
        FOREIGN KEY (address_id) REFERENCES address(address_id)
        ON DELETE RESTRICT;

ALTER TABLE organ_bank
    ADD CONSTRAINT fk_organ_bank_address
        FOREIGN KEY (address_id) REFERENCES address(address_id)
        ON DELETE RESTRICT;

ALTER TABLE donation_camp
    ADD CONSTRAINT fk_donation_camp_address
        FOREIGN KEY (address_id) REFERENCES address(address_id)
        ON DELETE RESTRICT;

ALTER TABLE donor
    ADD CONSTRAINT fk_donor_person
        FOREIGN KEY (donor_id) REFERENCES person(person_id)
        ON DELETE CASCADE;

ALTER TABLE recipient
    ADD CONSTRAINT fk_recipient_person
        FOREIGN KEY (recipient_id) REFERENCES person(person_id)
        ON DELETE CASCADE;

ALTER TABLE doctor
    ADD CONSTRAINT fk_doctor_person
        FOREIGN KEY (doctor_id) REFERENCES person(person_id)
        ON DELETE CASCADE,
    ADD CONSTRAINT fk_doctor_hospital
        FOREIGN KEY (hospital_id) REFERENCES hospital(hospital_id)
        ON DELETE RESTRICT;

ALTER TABLE donor_phone
    ADD CONSTRAINT fk_donor_phone_donor
        FOREIGN KEY (donor_id) REFERENCES donor(donor_id)
        ON DELETE CASCADE;

ALTER TABLE donor_condition
    ADD CONSTRAINT fk_donor_condition_donor
        FOREIGN KEY (donor_id) REFERENCES donor(donor_id)
        ON DELETE CASCADE,
    ADD CONSTRAINT fk_donor_condition_condition
        FOREIGN KEY (condition_id) REFERENCES medical_condition(condition_id)
        ON DELETE RESTRICT;

ALTER TABLE donation_registration
    ADD CONSTRAINT fk_donation_registration_camp
        FOREIGN KEY (camp_id) REFERENCES donation_camp(camp_id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT fk_donation_registration_donor
        FOREIGN KEY (donor_id) REFERENCES donor(donor_id)
        ON DELETE CASCADE;

ALTER TABLE user_account
    ADD CONSTRAINT fk_user_account_person
        FOREIGN KEY (person_id) REFERENCES person(person_id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT fk_user_account_blood_bank
        FOREIGN KEY (blood_bank_id) REFERENCES blood_bank(blood_bank_id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT fk_user_account_organ_bank
        FOREIGN KEY (organ_bank_id) REFERENCES organ_bank(organ_bank_id)
        ON DELETE RESTRICT;

ALTER TABLE donation
    ADD CONSTRAINT fk_donation_donor
        FOREIGN KEY (donor_id) REFERENCES donor(donor_id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT fk_donation_camp
        FOREIGN KEY (camp_id) REFERENCES donation_camp(camp_id)
        ON DELETE RESTRICT;

ALTER TABLE blood_donation
    ADD CONSTRAINT fk_blood_donation_donation
        FOREIGN KEY (donation_id) REFERENCES donation(donation_id)
        ON DELETE CASCADE,
    ADD CONSTRAINT fk_blood_donation_collection_bank
        FOREIGN KEY (collection_bank_id) REFERENCES blood_bank(blood_bank_id)
        ON DELETE RESTRICT;

ALTER TABLE organ_donation
    ADD CONSTRAINT fk_organ_donation_donation
        FOREIGN KEY (donation_id) REFERENCES donation(donation_id)
        ON DELETE CASCADE,
    ADD CONSTRAINT fk_organ_donation_collection_bank
        FOREIGN KEY (collection_organ_bank_id) REFERENCES organ_bank(organ_bank_id)
        ON DELETE RESTRICT;

ALTER TABLE blood_unit
    ADD CONSTRAINT fk_blood_unit_donation
        FOREIGN KEY (donation_id) REFERENCES blood_donation(donation_id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT fk_blood_unit_current_bank
        FOREIGN KEY (current_blood_bank_id) REFERENCES blood_bank(blood_bank_id)
        ON DELETE RESTRICT;

ALTER TABLE organ_unit
    ADD CONSTRAINT fk_organ_unit_donation
        FOREIGN KEY (donation_id) REFERENCES organ_donation(donation_id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT fk_organ_unit_current_bank
        FOREIGN KEY (current_organ_bank_id) REFERENCES organ_bank(organ_bank_id)
        ON DELETE RESTRICT;

ALTER TABLE medical_test_result
    ADD CONSTRAINT fk_medical_test_result_donation
        FOREIGN KEY (donation_id) REFERENCES donation(donation_id)
        ON DELETE CASCADE;

ALTER TABLE emergency_request
    ADD CONSTRAINT fk_emergency_request_recipient
        FOREIGN KEY (recipient_id) REFERENCES recipient(recipient_id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT fk_emergency_request_doctor
        FOREIGN KEY (requested_by) REFERENCES doctor(doctor_id)
        ON DELETE RESTRICT;

ALTER TABLE blood_reservation
    ADD CONSTRAINT fk_blood_reservation_request
        FOREIGN KEY (request_id) REFERENCES emergency_request(request_id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT fk_blood_reservation_unit
        FOREIGN KEY (blood_unit_id) REFERENCES blood_unit(blood_unit_id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT fk_blood_reservation_creator
        FOREIGN KEY (created_by) REFERENCES user_account(user_id)
        ON DELETE RESTRICT;

ALTER TABLE organ_match
    ADD CONSTRAINT fk_organ_match_request
        FOREIGN KEY (request_id) REFERENCES emergency_request(request_id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT fk_organ_match_unit
        FOREIGN KEY (organ_unit_id) REFERENCES organ_unit(organ_unit_id)
        ON DELETE RESTRICT;

ALTER TABLE audit_log
    ADD CONSTRAINT fk_audit_log_user
        FOREIGN KEY (user_id) REFERENCES user_account(user_id)
        ON DELETE SET NULL;

-- --------------------------------------------------------------------------
-- Atomic value and domain CHECK constraints
-- --------------------------------------------------------------------------

ALTER TABLE address
    ADD CONSTRAINT ck_address_line1_nonempty
        CHECK (btrim(line1) <> ''),
    ADD CONSTRAINT ck_address_city_nonempty
        CHECK (btrim(city) <> ''),
    ADD CONSTRAINT ck_address_district_nonempty
        CHECK (btrim(district) <> ''),
    ADD CONSTRAINT ck_address_state_nonempty
        CHECK (btrim(state) <> ''),
    ADD CONSTRAINT ck_address_pincode
        CHECK (pincode ~ '^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$');

ALTER TABLE person
    ADD CONSTRAINT ck_person_full_name_nonempty
        CHECK (btrim(full_name) <> ''),
    ADD CONSTRAINT ck_person_gender
        CHECK (gender IN ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'));

ALTER TABLE hospital
    ADD CONSTRAINT ck_hospital_name_nonempty
        CHECK (btrim(name) <> ''),
    ADD CONSTRAINT ck_hospital_phone
        CHECK (contact_phone ~ '^[0-9+() -]{7,20}$'),
    ADD CONSTRAINT ck_hospital_email
        CHECK (email IS NULL OR position('@' IN email) > 1),
    ADD CONSTRAINT ck_hospital_status
        CHECK (status IN ('ACTIVE', 'INACTIVE'));

ALTER TABLE blood_bank
    ADD CONSTRAINT ck_blood_bank_name_nonempty
        CHECK (btrim(name) <> ''),
    ADD CONSTRAINT ck_blood_bank_phone
        CHECK (contact_phone ~ '^[0-9+() -]{7,20}$'),
    ADD CONSTRAINT ck_blood_bank_email
        CHECK (email IS NULL OR position('@' IN email) > 1),
    ADD CONSTRAINT ck_blood_bank_status
        CHECK (status IN ('ACTIVE', 'INACTIVE'));

ALTER TABLE organ_bank
    ADD CONSTRAINT ck_organ_bank_name_nonempty
        CHECK (btrim(name) <> ''),
    ADD CONSTRAINT ck_organ_bank_phone
        CHECK (contact_phone ~ '^[0-9+() -]{7,20}$'),
    ADD CONSTRAINT ck_organ_bank_email
        CHECK (email IS NULL OR position('@' IN email) > 1),
    ADD CONSTRAINT ck_organ_bank_status
        CHECK (status IN ('ACTIVE', 'INACTIVE'));

ALTER TABLE donation_camp
    ADD CONSTRAINT ck_donation_camp_organizer_nonempty
        CHECK (btrim(organizer) <> ''),
    ADD CONSTRAINT ck_donation_camp_phone
        CHECK (contact_phone IS NULL OR contact_phone ~ '^[0-9+() -]{7,20}$'),
    ADD CONSTRAINT ck_donation_camp_status
        CHECK (status IN ('SCHEDULED', 'COMPLETED', 'CANCELLED'));

ALTER TABLE medical_condition
    ADD CONSTRAINT ck_medical_condition_name_nonempty
        CHECK (btrim(condition_name) <> '');

ALTER TABLE donor
    ADD CONSTRAINT ck_donor_weight
        CHECK (weight_kg > 0 AND weight_kg <= 500),
    ADD CONSTRAINT ck_donor_blood_group
        CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'));

ALTER TABLE recipient
    ADD CONSTRAINT ck_recipient_blood_group
        CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    ADD CONSTRAINT ck_recipient_status
        CHECK (status IN ('ACTIVE', 'INACTIVE'));

ALTER TABLE doctor
    ADD CONSTRAINT ck_doctor_specialization_nonempty
        CHECK (btrim(specialization) <> ''),
    ADD CONSTRAINT ck_doctor_license_nonempty
        CHECK (btrim(license_no) <> '');

ALTER TABLE donor_phone
    ADD CONSTRAINT ck_donor_phone_format
        CHECK (phone_number ~ '^[0-9+() -]{7,20}$');

ALTER TABLE donor_condition
    ADD CONSTRAINT ck_donor_condition_status
        CHECK (
            condition_status IS NULL
            OR condition_status IN ('ACTIVE', 'RESOLVED', 'MONITORED')
        );

ALTER TABLE donation_registration
    ADD CONSTRAINT ck_donation_registration_status
        CHECK (
            registration_status IN ('REGISTERED', 'ATTENDED', 'CANCELLED', 'NO_SHOW')
        );

ALTER TABLE user_account
    ADD CONSTRAINT ck_user_account_username
        CHECK (
            username = lower(username)
            AND username ~ '^[a-z0-9][a-z0-9._-]{2,79}$'
        ),
    ADD CONSTRAINT ck_user_account_password_hash_nonempty
        CHECK (btrim(password_hash) <> ''),
    ADD CONSTRAINT ck_user_account_role
        CHECK (
            role IN (
                'ADMIN',
                'DOCTOR',
                'BLOOD_BANK_STAFF',
                'ORGAN_BANK_STAFF',
                'DONOR',
                'RECIPIENT'
            )
        ),
    ADD CONSTRAINT ck_user_account_status
        CHECK (status IN ('ACTIVE', 'DISABLED', 'LOCKED')),
    ADD CONSTRAINT ck_user_account_affiliation
        CHECK (
            (
                role = 'ADMIN'
                AND blood_bank_id IS NULL
                AND organ_bank_id IS NULL
            )
            OR
            (
                role IN ('DOCTOR', 'DONOR', 'RECIPIENT')
                AND person_id IS NOT NULL
                AND blood_bank_id IS NULL
                AND organ_bank_id IS NULL
            )
            OR
            (
                role = 'BLOOD_BANK_STAFF'
                AND blood_bank_id IS NOT NULL
                AND organ_bank_id IS NULL
            )
            OR
            (
                role = 'ORGAN_BANK_STAFF'
                AND blood_bank_id IS NULL
                AND organ_bank_id IS NOT NULL
            )
        );

ALTER TABLE donation
    ADD CONSTRAINT ck_donation_type
        CHECK (donation_type IN ('BLOOD', 'ORGAN')),
    ADD CONSTRAINT ck_donation_record_status
        CHECK (record_status IN ('ACTIVE', 'VOIDED'));

ALTER TABLE blood_donation
    ADD CONSTRAINT ck_blood_donation_quantity
        CHECK (quantity_collected_ml > 0 AND quantity_collected_ml <= 1000);

ALTER TABLE blood_unit
    ADD CONSTRAINT ck_blood_unit_blood_group
        CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    ADD CONSTRAINT ck_blood_unit_status
        CHECK (
            status IN (
                'COLLECTED',
                'TESTING',
                'AVAILABLE',
                'RESERVED',
                'ISSUED',
                'REJECTED',
                'EXPIRED'
            )
        );

ALTER TABLE organ_unit
    ADD CONSTRAINT ck_organ_unit_type_nonempty
        CHECK (btrim(organ_type) <> ''),
    ADD CONSTRAINT ck_organ_unit_status
        CHECK (status IN ('AVAILABLE', 'MATCHING', 'ALLOCATED', 'UNAVAILABLE'));

ALTER TABLE medical_test_result
    ADD CONSTRAINT ck_medical_test_number
        CHECK (test_no > 0),
    ADD CONSTRAINT ck_medical_test_name_nonempty
        CHECK (btrim(test_name) <> ''),
    ADD CONSTRAINT ck_medical_test_result
        CHECK (result IN ('PASS', 'FAIL', 'PENDING'));

ALTER TABLE emergency_request
    ADD CONSTRAINT ck_emergency_request_type
        CHECK (request_type IN ('BLOOD', 'ORGAN')),
    ADD CONSTRAINT ck_emergency_request_blood_group
        CHECK (
            blood_group IS NULL
            OR blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')
        ),
    ADD CONSTRAINT ck_emergency_request_priority
        CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    ADD CONSTRAINT ck_emergency_request_type_fields
        CHECK (
            (
                request_type = 'BLOOD'
                AND blood_group IS NOT NULL
                AND organ_type IS NULL
                AND units_required IS NOT NULL
                AND units_required > 0
            )
            OR
            (
                request_type = 'ORGAN'
                AND blood_group IS NULL
                AND organ_type IS NOT NULL
                AND btrim(organ_type) <> ''
                AND units_required IS NULL
            )
        ),
    ADD CONSTRAINT ck_emergency_request_status
        CHECK (
            (
                request_type = 'BLOOD'
                AND status IN (
                    'PENDING',
                    'PARTIALLY_RESERVED',
                    'RESERVED',
                    'COMPLETED',
                    'CANCELLED'
                )
            )
            OR
            (
                request_type = 'ORGAN'
                AND status IN ('PENDING', 'MATCHED', 'COMPLETED', 'CANCELLED')
            )
        );

ALTER TABLE blood_reservation
    ADD CONSTRAINT ck_blood_reservation_status
        CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED')),
    ADD CONSTRAINT ck_blood_reservation_expiry_order
        CHECK (expires_at IS NULL OR expires_at > reserved_at),
    ADD CONSTRAINT ck_active_reservation_has_expiry
        CHECK (status <> 'ACTIVE' OR expires_at IS NOT NULL);

ALTER TABLE organ_match
    ADD CONSTRAINT ck_organ_match_compatibility_score
        CHECK (compatibility_score >= 0 AND compatibility_score <= 100),
    ADD CONSTRAINT ck_organ_match_status
        CHECK (match_status IN ('CANDIDATE', 'SELECTED', 'REJECTED', 'COMPLETED'));

ALTER TABLE audit_log
    ADD CONSTRAINT ck_audit_log_table_name_nonempty
        CHECK (btrim(table_name) <> ''),
    ADD CONSTRAINT ck_audit_log_record_id_nonempty
        CHECK (btrim(record_id) <> ''),
    ADD CONSTRAINT ck_audit_log_action_nonempty
        CHECK (btrim(action) <> '');

COMMIT;

/*
 * Deliberately deferred to later PL/pgSQL function/trigger phases:
 *
 * 1. Enforce total, disjoint DONATION -> BLOOD_DONATION XOR ORGAN_DONATION.
 * 2. Validate USER_ACCOUNT.person_id against the role-specific subtype.
 * 3. Set each unit's initial current bank to its donation's collection bank.
 * 4. Require blood-unit expiry_date to be after its donation_date.
 * 5. Enforce the blood-unit lifecycle transition graph.
 * 6. Block AVAILABLE unless screening exists and every result is PASS.
 * 7. Block reservation/issue of expired, rejected, or unavailable blood.
 * 8. Require BLOOD_RESERVATION.request_id to identify a BLOOD request.
 * 9. Require ORGAN_MATCH.request_id to identify an ORGAN request.
 * 10. Keep reservation count within EMERGENCY_REQUEST.units_required.
 * 11. Keep request, reservation, unit, and match statuses synchronized.
 * 12. Populate audit actor identity from a transaction-local app setting.
 */
