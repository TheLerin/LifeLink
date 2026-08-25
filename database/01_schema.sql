/*
 * LifeLink — Multi-Hospital Blood and Organ Allocation System
 * Phase 5: Base PostgreSQL schema
 *
 * Run order:
 *   1. 01_schema.sql
 *   2. 02_constraints.sql
 *
 * This file creates the normalized 24-relation schema. Primary keys,
 * identity columns, nullability, and defaults are defined here. Foreign keys,
 * alternate keys, CHECK constraints, and integrity-focused partial unique
 * indexes are added by 02_constraints.sql.
 *
 * Target database: PostgreSQL
 */

BEGIN;

CREATE SCHEMA IF NOT EXISTS lifelink;
SET search_path TO lifelink, public;

-- --------------------------------------------------------------------------
-- Reference, person, and organization relations
-- --------------------------------------------------------------------------

CREATE TABLE address (
    address_id  INTEGER GENERATED ALWAYS AS IDENTITY,
    line1       VARCHAR(150) NOT NULL,
    line2       VARCHAR(150),
    city        VARCHAR(80) NOT NULL,
    district    VARCHAR(80) NOT NULL,
    state       VARCHAR(80) NOT NULL,
    pincode     VARCHAR(10) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_address PRIMARY KEY (address_id)
);

CREATE TABLE person (
    person_id      INTEGER GENERATED ALWAYS AS IDENTITY,
    full_name      VARCHAR(120) NOT NULL,
    date_of_birth  DATE NOT NULL,
    gender         VARCHAR(20) NOT NULL,
    address_id     INTEGER NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_person PRIMARY KEY (person_id)
);

CREATE TABLE hospital (
    hospital_id    INTEGER GENERATED ALWAYS AS IDENTITY,
    name           VARCHAR(150) NOT NULL,
    address_id     INTEGER NOT NULL,
    contact_phone  VARCHAR(20) NOT NULL,
    email          VARCHAR(254),
    status         VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_hospital PRIMARY KEY (hospital_id)
);

CREATE TABLE blood_bank (
    blood_bank_id  INTEGER GENERATED ALWAYS AS IDENTITY,
    name           VARCHAR(150) NOT NULL,
    address_id     INTEGER NOT NULL,
    contact_phone  VARCHAR(20) NOT NULL,
    email          VARCHAR(254),
    status         VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_blood_bank PRIMARY KEY (blood_bank_id)
);

CREATE TABLE organ_bank (
    organ_bank_id  INTEGER GENERATED ALWAYS AS IDENTITY,
    name           VARCHAR(150) NOT NULL,
    address_id     INTEGER NOT NULL,
    contact_phone  VARCHAR(20) NOT NULL,
    email          VARCHAR(254),
    status         VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_organ_bank PRIMARY KEY (organ_bank_id)
);

CREATE TABLE donation_camp (
    camp_id        INTEGER GENERATED ALWAYS AS IDENTITY,
    address_id     INTEGER NOT NULL,
    camp_date      DATE NOT NULL,
    organizer      VARCHAR(150) NOT NULL,
    contact_phone  VARCHAR(20),
    status         VARCHAR(20) NOT NULL,

    CONSTRAINT pk_donation_camp PRIMARY KEY (camp_id)
);

CREATE TABLE medical_condition (
    condition_id    INTEGER GENERATED ALWAYS AS IDENTITY,
    condition_name  VARCHAR(120) NOT NULL,
    description     TEXT,

    CONSTRAINT pk_medical_condition PRIMARY KEY (condition_id)
);

-- --------------------------------------------------------------------------
-- Person specializations and supporting relations
-- --------------------------------------------------------------------------

CREATE TABLE donor (
    donor_id    INTEGER NOT NULL,
    weight_kg   NUMERIC(5,2) NOT NULL,
    blood_group VARCHAR(3) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT pk_donor PRIMARY KEY (donor_id)
);

CREATE TABLE recipient (
    recipient_id INTEGER NOT NULL,
    blood_group  VARCHAR(3) NOT NULL,
    status       VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT pk_recipient PRIMARY KEY (recipient_id)
);

CREATE TABLE doctor (
    doctor_id      INTEGER NOT NULL,
    hospital_id    INTEGER NOT NULL,
    specialization VARCHAR(100) NOT NULL,
    license_no     VARCHAR(60) NOT NULL,

    CONSTRAINT pk_doctor PRIMARY KEY (doctor_id)
);

CREATE TABLE donor_phone (
    phone_id     INTEGER GENERATED ALWAYS AS IDENTITY,
    donor_id     INTEGER NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    is_primary   BOOLEAN NOT NULL DEFAULT FALSE,

    CONSTRAINT pk_donor_phone PRIMARY KEY (phone_id)
);

CREATE TABLE donor_condition (
    donor_id        INTEGER NOT NULL,
    condition_id    INTEGER NOT NULL,
    diagnosed_date  DATE,
    condition_status VARCHAR(20),

    CONSTRAINT pk_donor_condition PRIMARY KEY (donor_id, condition_id)
);

CREATE TABLE donation_registration (
    registration_id     INTEGER GENERATED ALWAYS AS IDENTITY,
    camp_id             INTEGER NOT NULL,
    donor_id            INTEGER NOT NULL,
    registration_status VARCHAR(20) NOT NULL,
    registered_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_donation_registration PRIMARY KEY (registration_id)
);

CREATE TABLE user_account (
    user_id        INTEGER GENERATED ALWAYS AS IDENTITY,
    person_id      INTEGER,
    blood_bank_id  INTEGER,
    organ_bank_id  INTEGER,
    username       VARCHAR(80) NOT NULL,
    password_hash  TEXT NOT NULL,
    role           VARCHAR(30) NOT NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at  TIMESTAMPTZ,

    CONSTRAINT pk_user_account PRIMARY KEY (user_id)
);

-- --------------------------------------------------------------------------
-- Donation hierarchy, units, and screening
-- --------------------------------------------------------------------------

CREATE TABLE donation (
    donation_id   INTEGER GENERATED ALWAYS AS IDENTITY,
    donor_id      INTEGER NOT NULL,
    camp_id       INTEGER,
    donation_date DATE NOT NULL,
    donation_type VARCHAR(10) NOT NULL,
    record_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_donation PRIMARY KEY (donation_id)
);

CREATE TABLE blood_donation (
    donation_id           INTEGER NOT NULL,
    collection_bank_id    INTEGER NOT NULL,
    quantity_collected_ml INTEGER NOT NULL,
    notes                 TEXT,

    CONSTRAINT pk_blood_donation PRIMARY KEY (donation_id)
);

CREATE TABLE organ_donation (
    donation_id              INTEGER NOT NULL,
    collection_organ_bank_id INTEGER NOT NULL,
    notes                    TEXT,

    CONSTRAINT pk_organ_donation PRIMARY KEY (donation_id)
);

CREATE TABLE blood_unit (
    blood_unit_id         INTEGER GENERATED ALWAYS AS IDENTITY,
    donation_id           INTEGER NOT NULL,
    current_blood_bank_id INTEGER NOT NULL,
    blood_group           VARCHAR(3) NOT NULL,
    expiry_date           DATE NOT NULL,
    status                VARCHAR(20) NOT NULL DEFAULT 'COLLECTED',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_blood_unit PRIMARY KEY (blood_unit_id)
);

CREATE TABLE organ_unit (
    organ_unit_id         INTEGER GENERATED ALWAYS AS IDENTITY,
    donation_id           INTEGER NOT NULL,
    current_organ_bank_id INTEGER NOT NULL,
    organ_type            VARCHAR(50) NOT NULL,
    status                VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_organ_unit PRIMARY KEY (organ_unit_id)
);

CREATE TABLE medical_test_result (
    donation_id INTEGER NOT NULL,
    test_no     SMALLINT NOT NULL,
    test_name   VARCHAR(120) NOT NULL,
    result      VARCHAR(10) NOT NULL,
    test_date   DATE NOT NULL,
    remarks     TEXT,

    CONSTRAINT pk_medical_test_result PRIMARY KEY (donation_id, test_no)
);

-- --------------------------------------------------------------------------
-- Emergency coordination and allocation
-- --------------------------------------------------------------------------

CREATE TABLE emergency_request (
    request_id     INTEGER GENERATED ALWAYS AS IDENTITY,
    recipient_id   INTEGER NOT NULL,
    requested_by   INTEGER NOT NULL,
    request_type   VARCHAR(10) NOT NULL,
    blood_group    VARCHAR(3),
    organ_type     VARCHAR(50),
    units_required SMALLINT,
    priority       VARCHAR(10) NOT NULL,
    requested_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status         VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    notes          TEXT,

    CONSTRAINT pk_emergency_request PRIMARY KEY (request_id)
);

CREATE TABLE blood_reservation (
    reservation_id INTEGER GENERATED ALWAYS AS IDENTITY,
    request_id     INTEGER NOT NULL,
    blood_unit_id  INTEGER NOT NULL,
    reserved_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at     TIMESTAMPTZ,
    status         VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_by     INTEGER NOT NULL,

    CONSTRAINT pk_blood_reservation PRIMARY KEY (reservation_id)
);

CREATE TABLE organ_match (
    match_id            INTEGER GENERATED ALWAYS AS IDENTITY,
    request_id          INTEGER NOT NULL,
    organ_unit_id       INTEGER NOT NULL,
    compatibility_score NUMERIC(5,2) NOT NULL,
    match_status        VARCHAR(20) NOT NULL DEFAULT 'CANDIDATE',
    calculated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_organ_match PRIMARY KEY (match_id)
);

CREATE TABLE audit_log (
    audit_id    BIGINT GENERATED ALWAYS AS IDENTITY,
    user_id     INTEGER,
    table_name  VARCHAR(80) NOT NULL,
    record_id   VARCHAR(100) NOT NULL,
    action      VARCHAR(40) NOT NULL,
    old_status  VARCHAR(30),
    new_status  VARCHAR(30),
    action_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    details     TEXT,

    CONSTRAINT pk_audit_log PRIMARY KEY (audit_id)
);

COMMIT;
