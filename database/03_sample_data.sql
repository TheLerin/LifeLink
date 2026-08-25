/*
 * LifeLink — Multi-Hospital Blood and Organ Allocation System
 * Phase 6: Realistic fictional demonstration data
 *
 * Prerequisites:
 *   1. 01_schema.sql
 *   2. 02_constraints.sql
 *
 * All people and organizations in this file are fictional. Dates are relative
 * to the day the script is executed so expiry and active-request examples stay
 * useful during later demonstrations.
 *
 * Important demo records:
 *   blood_unit  7  -> TESTING with a PENDING result
 *   blood_unit  8  -> REJECTED after a FAIL result
 *   blood_unit  9  -> EXPIRED
 *   blood_unit 12  -> only AVAILABLE AB- unit (concurrency case)
 *   blood_unit 15  -> COLLECTED with no screening rows yet
 *   request     1  -> CRITICAL and PARTIALLY_RESERVED (2 units requested)
 *   request     9  -> CRITICAL AB- request for the last-unit concurrency demo
 *   reservation 8 -> EXPIRED reservation whose unit returned to AVAILABLE
 *   organ_unit  1 -> candidate for multiple recipients
 *
 * Development-only demo password for every seeded account: Demo@123
 */

BEGIN;

SET search_path TO lifelink, public;

-- --------------------------------------------------------------------------
-- Addresses
-- --------------------------------------------------------------------------

INSERT INTO address (
    address_id, line1, line2, city, district, state, pincode
) OVERRIDING SYSTEM VALUE
VALUES
    (1,  '12 Harbour Road',       NULL,              'Kochi',             'Ernakulam',      'Kerala', '682001'),
    (2,  '44 Lake View Avenue',   NULL,              'Ernakulam',         'Ernakulam',      'Kerala', '682011'),
    (3,  '8 Green Valley Road',   NULL,              'Alappuzha',         'Alappuzha',      'Kerala', '688001'),
    (4,  '21 Marine Drive',       'Second Floor',    'Kochi',             'Ernakulam',      'Kerala', '682031'),
    (5,  '77 Airport Road',       NULL,              'Aluva',             'Ernakulam',      'Kerala', '683101'),
    (6,  '16 Beach Road',         NULL,              'Alappuzha',         'Alappuzha',      'Kerala', '688012'),
    (7,  '5 Hope Street',         NULL,              'Kochi',             'Ernakulam',      'Kerala', '682018'),
    (8,  '90 Life Avenue',        NULL,              'Thiruvananthapuram','Thiruvananthapuram','Kerala','695001'),
    (9,  'Municipal Town Hall',   NULL,              'Mavelikara',        'Alappuzha',      'Kerala', '690101'),
    (10, 'Community Centre Road', NULL,              'Kollam',            'Kollam',         'Kerala', '691001'),
    (11, 'Public Library Hall',   NULL,              'Kottayam',          'Kottayam',       'Kerala', '686001'),
    (12, 'Rose Villa',            'Temple Road',     'Mavelikara',        'Alappuzha',      'Kerala', '690101'),
    (13, 'River View House',      'North Junction',  'Alappuzha',         'Alappuzha',      'Kerala', '688001'),
    (14, 'Palm Grove',            'College Road',    'Kochi',             'Ernakulam',      'Kerala', '682016'),
    (15, 'Sunrise Apartments',    'Block B',         'Kottayam',          'Kottayam',       'Kerala', '686002'),
    (16, 'Hill Crest',            'Station Road',    'Kollam',            'Kollam',         'Kerala', '691013'),
    (17, 'Bluebell Residency',    'Canal Road',      'Aluva',             'Ernakulam',      'Kerala', '683102'),
    (18, 'Coconut Grove',         'West Gate',       'Thiruvananthapuram','Thiruvananthapuram','Kerala','695014');

-- --------------------------------------------------------------------------
-- Hospitals, blood banks, organ banks, camps, and condition reference data
-- --------------------------------------------------------------------------

INSERT INTO hospital (
    hospital_id, name, address_id, contact_phone, email, status
) OVERRIDING SYSTEM VALUE
VALUES
    (1, 'Harbourview Medical Centre', 1, '+91 484 4001001', 'contact@harbourview.example', 'ACTIVE'),
    (2, 'Lakeside General Hospital',  2, '+91 484 4001002', 'care@lakeside.example',       'ACTIVE'),
    (3, 'Green Valley Hospital',      3, '+91 477 4001003', 'help@greenvalley.example',    'ACTIVE');

INSERT INTO blood_bank (
    blood_bank_id, name, address_id, contact_phone, email, status
) OVERRIDING SYSTEM VALUE
VALUES
    (1, 'LifeStream Central Blood Bank', 4, '+91 484 4102001', 'central@lifestream.example', 'ACTIVE'),
    (2, 'RedDrop Regional Blood Bank',   5, '+91 484 4102002', 'support@reddrop.example',    'ACTIVE'),
    (3, 'Coastal Care Blood Bank',       6, '+91 477 4102003', 'desk@coastalcare.example',   'ACTIVE');

INSERT INTO organ_bank (
    organ_bank_id, name, address_id, contact_phone, email, status
) OVERRIDING SYSTEM VALUE
VALUES
    (1, 'HopeBridge Organ Bank',      7, '+91 484 4203001', 'coordination@hopebridge.example', 'ACTIVE'),
    (2, 'Kerala Life Organ Centre',   8, '+91 471 4203002', 'contact@keralalife.example',      'ACTIVE');

INSERT INTO donation_camp (
    camp_id, address_id, camp_date, organizer, contact_phone, status
) OVERRIDING SYSTEM VALUE
VALUES
    (1, 9,  CURRENT_DATE - 30, 'LifeLink Student Health Collective', '+91 90000 11001', 'COMPLETED'),
    (2, 10, CURRENT_DATE - 20, 'Coastal Community Welfare Forum',    '+91 90000 11002', 'COMPLETED'),
    (3, 11, CURRENT_DATE + 14, 'Kottayam Youth Volunteer Network',   '+91 90000 11003', 'SCHEDULED');

INSERT INTO medical_condition (
    condition_id, condition_name, description
) OVERRIDING SYSTEM VALUE
VALUES
    (1, 'Hypertension',     'Fictional demo reference for elevated blood pressure history.'),
    (2, 'Diabetes',         'Fictional demo reference for diabetes history.'),
    (3, 'Asthma',           'Fictional demo reference for asthma history.'),
    (4, 'Anaemia',          'Fictional demo reference for anaemia history.'),
    (5, 'Thyroid Disorder', 'Fictional demo reference for thyroid-related history.');

-- --------------------------------------------------------------------------
-- People and person specializations
-- --------------------------------------------------------------------------

INSERT INTO person (
    person_id, full_name, date_of_birth, gender, address_id
) OVERRIDING SYSTEM VALUE
VALUES
    (1,  'Ananya Nair',       DATE '1998-04-12', 'FEMALE', 12),
    (2,  'Arjun Menon',       DATE '1995-11-03', 'MALE',   13),
    (3,  'Diya Thomas',       DATE '2001-07-19', 'FEMALE', 14),
    (4,  'Rohit Varma',       DATE '1992-02-28', 'MALE',   15),
    (5,  'Meera Pillai',      DATE '1999-09-14', 'FEMALE', 16),
    (6,  'Nikhil Raj',        DATE '1994-05-21', 'MALE',   17),
    (7,  'Sana Basheer',      DATE '2000-12-08', 'FEMALE', 18),
    (8,  'Vivek Krishnan',    DATE '1991-06-17', 'MALE',   12),
    (9,  'Asha Joseph',       DATE '1997-03-25', 'FEMALE', 13),
    (10, 'Kiran Kumar',       DATE '1993-10-11', 'MALE',   14),
    (11, 'Neha Suresh',       DATE '2002-01-30', 'FEMALE', 15),
    (12, 'Farhan Ali',        DATE '1996-08-06', 'MALE',   16),
    (13, 'Isha Nambiar',      DATE '1989-05-15', 'FEMALE', 17),
    (14, 'Adithya Bose',      DATE '1986-12-01', 'MALE',   18),
    (15, 'Fathima Rahman',    DATE '1998-10-22', 'FEMALE', 12),
    (16, 'Joel Mathew',       DATE '1984-07-09', 'MALE',   13),
    (17, 'Kavya R Nair',      DATE '1995-02-18', 'FEMALE', 14),
    (18, 'Manu George',       DATE '1988-11-27', 'MALE',   15),
    (19, 'Riya Das',          DATE '2000-06-04', 'FEMALE', 16),
    (20, 'Sandeep Mohan',     DATE '1990-09-13', 'MALE',   17),
    (21, 'Dr Maya Iyer',      DATE '1979-03-07', 'FEMALE', 18),
    (22, 'Dr Alan John',      DATE '1982-08-16', 'MALE',   12),
    (23, 'Dr Priya Menon',    DATE '1981-01-24', 'FEMALE', 13),
    (24, 'Dr Dev Anand',      DATE '1977-05-10', 'MALE',   14),
    (25, 'Dr Lakshmi Rao',    DATE '1983-12-19', 'FEMALE', 15),
    (26, 'Devika Rao',        DATE '1987-04-08', 'FEMALE', 16),
    (27, 'Arun S',            DATE '1990-02-11', 'MALE',   17),
    (28, 'Nandana P',         DATE '1992-07-23', 'FEMALE', 18),
    (29, 'Binoy K',           DATE '1988-10-31', 'MALE',   12),
    (30, 'Shreya T',          DATE '1993-06-26', 'FEMALE', 13),
    (31, 'Ajmal Hameed',      DATE '1991-09-02', 'MALE',   14);

INSERT INTO donor (donor_id, weight_kg, blood_group, is_active)
VALUES
    (1,  58.50, 'O+',  TRUE),
    (2,  72.00, 'A+',  TRUE),
    (3,  65.25, 'B+',  TRUE),
    (4,  80.00, 'AB+', TRUE),
    (5,  55.75, 'O-',  TRUE),
    (6,  75.00, 'A-',  TRUE),
    (7,  62.50, 'B-',  TRUE),
    (8,  68.00, 'AB-', TRUE),
    (9,  60.00, 'O+',  TRUE),
    (10, 77.25, 'A+',  TRUE),
    (11, 53.00, 'B+',  TRUE),
    (12, 70.00, 'O+',  FALSE);

INSERT INTO recipient (recipient_id, blood_group, status)
VALUES
    (13, 'O+',  'ACTIVE'),
    (14, 'A+',  'ACTIVE'),
    (15, 'B+',  'ACTIVE'),
    (16, 'AB+', 'ACTIVE'),
    (17, 'O-',  'ACTIVE'),
    (18, 'A-',  'ACTIVE'),
    (19, 'B-',  'ACTIVE'),
    (20, 'AB-', 'ACTIVE');

INSERT INTO doctor (
    doctor_id, hospital_id, specialization, license_no
)
VALUES
    (21, 1, 'Emergency Medicine',       'KL-MED-10021'),
    (22, 1, 'Haematology',              'KL-MED-10022'),
    (23, 2, 'Nephrology',               'KL-MED-10023'),
    (24, 2, 'Cardiothoracic Medicine',  'KL-MED-10024'),
    (25, 3, 'Transplant Medicine',      'KL-MED-10025');

-- --------------------------------------------------------------------------
-- Donor phones, conditions, and camp registrations
-- --------------------------------------------------------------------------

INSERT INTO donor_phone (
    phone_id, donor_id, phone_number, is_primary
) OVERRIDING SYSTEM VALUE
VALUES
    (1,  1,  '+91 90000 20001', TRUE),
    (2,  1,  '+91 90000 21001', FALSE),
    (3,  2,  '+91 90000 20002', TRUE),
    (4,  3,  '+91 90000 20003', TRUE),
    (5,  4,  '+91 90000 20004', TRUE),
    (6,  5,  '+91 90000 20005', TRUE),
    (7,  6,  '+91 90000 20006', TRUE),
    (8,  7,  '+91 90000 20007', TRUE),
    (9,  8,  '+91 90000 20008', TRUE),
    (10, 9,  '+91 90000 20009', TRUE),
    (11, 9,  '+91 90000 21009', FALSE),
    (12, 10, '+91 90000 20010', TRUE),
    (13, 11, '+91 90000 20011', TRUE),
    (14, 12, '+91 90000 20012', TRUE);

INSERT INTO donor_condition (
    donor_id, condition_id, diagnosed_date, condition_status
)
VALUES
    (4,  1, CURRENT_DATE - 900,  'MONITORED'),
    (6,  4, CURRENT_DATE - 500,  'RESOLVED'),
    (8,  3, CURRENT_DATE - 1200, 'ACTIVE'),
    (11, 5, CURRENT_DATE - 700,  'MONITORED'),
    (12, 2, CURRENT_DATE - 1000, 'ACTIVE');

INSERT INTO donation_registration (
    registration_id, camp_id, donor_id, registration_status, registered_at
) OVERRIDING SYSTEM VALUE
VALUES
    (1,  1, 1,  'ATTENDED',   CURRENT_TIMESTAMP - INTERVAL '35 days'),
    (2,  1, 2,  'ATTENDED',   CURRENT_TIMESTAMP - INTERVAL '34 days'),
    (3,  1, 3,  'ATTENDED',   CURRENT_TIMESTAMP - INTERVAL '33 days'),
    (4,  1, 4,  'ATTENDED',   CURRENT_TIMESTAMP - INTERVAL '32 days'),
    (5,  2, 5,  'ATTENDED',   CURRENT_TIMESTAMP - INTERVAL '25 days'),
    (6,  2, 6,  'ATTENDED',   CURRENT_TIMESTAMP - INTERVAL '24 days'),
    (7,  2, 7,  'ATTENDED',   CURRENT_TIMESTAMP - INTERVAL '23 days'),
    (8,  2, 8,  'ATTENDED',   CURRENT_TIMESTAMP - INTERVAL '22 days'),
    (9,  2, 9,  'CANCELLED',  CURRENT_TIMESTAMP - INTERVAL '22 days'),
    (10, 3, 9,  'REGISTERED', CURRENT_TIMESTAMP - INTERVAL '2 days'),
    (11, 3, 10, 'REGISTERED', CURRENT_TIMESTAMP - INTERVAL '2 days'),
    (12, 3, 11, 'REGISTERED', CURRENT_TIMESTAMP - INTERVAL '1 day'),
    (13, 3, 12, 'REGISTERED', CURRENT_TIMESTAMP - INTERVAL '1 day');

-- --------------------------------------------------------------------------
-- Application accounts
-- --------------------------------------------------------------------------

INSERT INTO user_account (
    user_id,
    person_id,
    blood_bank_id,
    organ_bank_id,
    username,
    password_hash,
    role,
    status
) OVERRIDING SYSTEM VALUE
VALUES
    (1,  26, NULL, NULL, 'admin.demo',       '$2b$12$L/U6RlnuP6mcJ7TtM9bYn.I8JG/qVFU6it2PXkCcXJaV50SRY6SdW', 'ADMIN',            'ACTIVE'),
    (2,  21, NULL, NULL, 'doctor.maya',      '$2b$12$L/U6RlnuP6mcJ7TtM9bYn.I8JG/qVFU6it2PXkCcXJaV50SRY6SdW', 'DOCTOR',           'ACTIVE'),
    (3,  27, 1,    NULL, 'blood.central',    '$2b$12$L/U6RlnuP6mcJ7TtM9bYn.I8JG/qVFU6it2PXkCcXJaV50SRY6SdW', 'BLOOD_BANK_STAFF', 'ACTIVE'),
    (4,  28, NULL, 1,    'organ.hopebridge', '$2b$12$L/U6RlnuP6mcJ7TtM9bYn.I8JG/qVFU6it2PXkCcXJaV50SRY6SdW', 'ORGAN_BANK_STAFF', 'ACTIVE'),
    (5,  1,  NULL, NULL, 'donor.ananya',     '$2b$12$L/U6RlnuP6mcJ7TtM9bYn.I8JG/qVFU6it2PXkCcXJaV50SRY6SdW', 'DONOR',            'ACTIVE'),
    (6,  13, NULL, NULL, 'recipient.isha',   '$2b$12$L/U6RlnuP6mcJ7TtM9bYn.I8JG/qVFU6it2PXkCcXJaV50SRY6SdW', 'RECIPIENT',        'ACTIVE'),
    (7,  23, NULL, NULL, 'doctor.priya',     '$2b$12$L/U6RlnuP6mcJ7TtM9bYn.I8JG/qVFU6it2PXkCcXJaV50SRY6SdW', 'DOCTOR',           'ACTIVE'),
    (8,  29, 2,    NULL, 'blood.regional',   '$2b$12$L/U6RlnuP6mcJ7TtM9bYn.I8JG/qVFU6it2PXkCcXJaV50SRY6SdW', 'BLOOD_BANK_STAFF', 'ACTIVE'),
    (9,  30, NULL, 2,    'organ.keralalife', '$2b$12$L/U6RlnuP6mcJ7TtM9bYn.I8JG/qVFU6it2PXkCcXJaV50SRY6SdW', 'ORGAN_BANK_STAFF', 'ACTIVE'),
    (10, 31, 3,    NULL, 'blood.coastal',    '$2b$12$L/U6RlnuP6mcJ7TtM9bYn.I8JG/qVFU6it2PXkCcXJaV50SRY6SdW', 'BLOOD_BANK_STAFF', 'ACTIVE');

-- --------------------------------------------------------------------------
-- Donation supertype and subtypes
-- --------------------------------------------------------------------------

INSERT INTO donation (
    donation_id, donor_id, camp_id, donation_date, donation_type, record_status
) OVERRIDING SYSTEM VALUE
VALUES
    (1,  2,  1,    CURRENT_DATE - 30, 'BLOOD', 'ACTIVE'),
    (2,  1,  1,    CURRENT_DATE - 30, 'BLOOD', 'ACTIVE'),
    (3,  3,  1,    CURRENT_DATE - 30, 'BLOOD', 'ACTIVE'),
    (4,  4,  1,    CURRENT_DATE - 30, 'BLOOD', 'ACTIVE'),
    (5,  6,  2,    CURRENT_DATE - 20, 'BLOOD', 'ACTIVE'),
    (6,  5,  2,    CURRENT_DATE - 20, 'BLOOD', 'ACTIVE'),
    (7,  7,  2,    CURRENT_DATE - 20, 'BLOOD', 'ACTIVE'),
    (8,  8,  2,    CURRENT_DATE - 20, 'BLOOD', 'ACTIVE'),
    (9,  9,  NULL, CURRENT_DATE - 60, 'BLOOD', 'ACTIVE'),
    (10, 2,  NULL, CURRENT_DATE - 16, 'BLOOD', 'ACTIVE'),
    (11, 1,  NULL, CURRENT_DATE - 15, 'BLOOD', 'ACTIVE'),
    (12, 8,  NULL, CURRENT_DATE - 14, 'BLOOD', 'ACTIVE'),
    (13, 11, NULL, CURRENT_DATE - 13, 'BLOOD', 'ACTIVE'),
    (14, 12, NULL, CURRENT_DATE - 12, 'BLOOD', 'ACTIVE'),
    (15, 4,  NULL, CURRENT_DATE - 2,  'BLOOD', 'ACTIVE'),
    (16, 6,  NULL, CURRENT_DATE - 11, 'BLOOD', 'ACTIVE'),
    (17, 5,  NULL, CURRENT_DATE - 10, 'BLOOD', 'ACTIVE'),
    (18, 4,  NULL, CURRENT_DATE - 9,  'BLOOD', 'ACTIVE'),
    (19, 7,  NULL, CURRENT_DATE - 8,  'BLOOD', 'ACTIVE'),
    (20, 9,  NULL, CURRENT_DATE - 7,  'BLOOD', 'ACTIVE'),
    (21, 10, NULL, CURRENT_DATE - 6,  'ORGAN', 'ACTIVE'),
    (22, 11, NULL, CURRENT_DATE - 5,  'ORGAN', 'ACTIVE'),
    (23, 12, NULL, CURRENT_DATE - 4,  'ORGAN', 'ACTIVE'),
    (24, 3,  NULL, CURRENT_DATE - 3,  'ORGAN', 'ACTIVE'),
    (25, 6,  NULL, CURRENT_DATE - 2,  'ORGAN', 'ACTIVE');

INSERT INTO blood_donation (
    donation_id, collection_bank_id, quantity_collected_ml, notes
)
VALUES
    (1,  1, 450, 'Collected during completed Mavelikara camp.'),
    (2,  1, 450, 'Collected during completed Mavelikara camp.'),
    (3,  1, 350, 'Collected during completed Mavelikara camp.'),
    (4,  1, 450, 'Collected during completed Mavelikara camp.'),
    (5,  1, 450, 'Collected during completed Kollam camp.'),
    (6,  1, 350, 'Collected during completed Kollam camp.'),
    (7,  1, 450, 'Screening is still pending.'),
    (8,  1, 450, 'Rejected after fictional academic screening failure.'),
    (9,  2, 450, 'Historical unit that has now expired.'),
    (10, 2, 450, 'Reserved for an active hospital request.'),
    (11, 2, 350, 'Issued for a completed request.'),
    (12, 2, 450, 'Rare-group unit retained for concurrency demonstration.'),
    (13, 2, 450, 'Reserved for an active hospital request.'),
    (14, 2, 450, 'Available routine stock.'),
    (15, 3, 450, 'Recently collected; screening not started.'),
    (16, 3, 350, 'Available routine stock.'),
    (17, 3, 450, 'Issued for a completed request.'),
    (18, 3, 450, 'Reserved for an active hospital request.'),
    (19, 3, 450, 'Available routine stock.'),
    (20, 3, 450, 'Reserved for a partially fulfilled critical request.');

INSERT INTO organ_donation (
    donation_id, collection_organ_bank_id, notes
)
VALUES
    (21, 1, 'Academic kidney donation record; fictional data only.'),
    (22, 1, 'Academic kidney donation record selected for a match.'),
    (23, 2, 'Academic liver donation record with completed match.'),
    (24, 2, 'Academic cornea donation record available for matching.'),
    (25, 1, 'Academic kidney donation record marked unavailable.');

-- --------------------------------------------------------------------------
-- Individual blood and organ units
-- --------------------------------------------------------------------------

INSERT INTO blood_unit (
    blood_unit_id,
    donation_id,
    current_blood_bank_id,
    blood_group,
    expiry_date,
    status
) OVERRIDING SYSTEM VALUE
VALUES
    (1,  1,  1, 'A+',  CURRENT_DATE + 12, 'AVAILABLE'),
    (2,  2,  1, 'O+',  CURRENT_DATE + 5,  'AVAILABLE'),
    (3,  3,  1, 'B+',  CURRENT_DATE + 20, 'AVAILABLE'),
    (4,  4,  1, 'AB+', CURRENT_DATE + 18, 'AVAILABLE'),
    (5,  5,  1, 'A-',  CURRENT_DATE + 10, 'AVAILABLE'),
    (6,  6,  1, 'O-',  CURRENT_DATE + 15, 'AVAILABLE'),
    (7,  7,  1, 'B-',  CURRENT_DATE + 22, 'TESTING'),
    (8,  8,  1, 'AB-', CURRENT_DATE + 20, 'REJECTED'),
    (9,  9,  2, 'O+',  CURRENT_DATE - 2,  'EXPIRED'),
    (10, 10, 2, 'A+',  CURRENT_DATE + 9,  'RESERVED'),
    (11, 11, 2, 'O+',  CURRENT_DATE + 14, 'ISSUED'),
    (12, 12, 2, 'AB-', CURRENT_DATE + 7,  'AVAILABLE'),
    (13, 13, 2, 'B+',  CURRENT_DATE + 11, 'RESERVED'),
    (14, 14, 2, 'O+',  CURRENT_DATE + 16, 'AVAILABLE'),
    (15, 15, 3, 'AB+', CURRENT_DATE + 30, 'COLLECTED'),
    (16, 16, 3, 'A-',  CURRENT_DATE + 13, 'AVAILABLE'),
    (17, 17, 3, 'O-',  CURRENT_DATE + 8,  'ISSUED'),
    (18, 18, 3, 'AB+', CURRENT_DATE + 12, 'RESERVED'),
    (19, 19, 3, 'B-',  CURRENT_DATE + 19, 'AVAILABLE'),
    (20, 20, 3, 'O+',  CURRENT_DATE + 17, 'RESERVED');

INSERT INTO organ_unit (
    organ_unit_id,
    donation_id,
    current_organ_bank_id,
    organ_type,
    status
) OVERRIDING SYSTEM VALUE
VALUES
    (1, 21, 1, 'KIDNEY', 'AVAILABLE'),
    (2, 22, 1, 'KIDNEY', 'ALLOCATED'),
    (3, 23, 2, 'LIVER',  'ALLOCATED'),
    (4, 24, 2, 'CORNEA', 'AVAILABLE'),
    (5, 25, 1, 'KIDNEY', 'UNAVAILABLE');

-- --------------------------------------------------------------------------
-- Academic medical screening results
-- --------------------------------------------------------------------------

INSERT INTO medical_test_result (
    donation_id, test_no, test_name, result, test_date, remarks
)
VALUES
    (1,  1, 'Demo infectious screening',      'PASS',    CURRENT_DATE - 29, 'Academic test value only.'),
    (1,  2, 'Demo blood-group confirmation',  'PASS',    CURRENT_DATE - 29, 'Group confirmed for demo.'),
    (2,  1, 'Demo infectious screening',      'PASS',    CURRENT_DATE - 29, 'Academic test value only.'),
    (2,  2, 'Demo blood-group confirmation',  'PASS',    CURRENT_DATE - 29, 'Group confirmed for demo.'),
    (3,  1, 'Demo infectious screening',      'PASS',    CURRENT_DATE - 29, 'Academic test value only.'),
    (3,  2, 'Demo blood-group confirmation',  'PASS',    CURRENT_DATE - 29, 'Group confirmed for demo.'),
    (4,  1, 'Demo infectious screening',      'PASS',    CURRENT_DATE - 29, 'Academic test value only.'),
    (4,  2, 'Demo blood-group confirmation',  'PASS',    CURRENT_DATE - 29, 'Group confirmed for demo.'),
    (5,  1, 'Demo infectious screening',      'PASS',    CURRENT_DATE - 19, 'Academic test value only.'),
    (5,  2, 'Demo blood-group confirmation',  'PASS',    CURRENT_DATE - 19, 'Group confirmed for demo.'),
    (6,  1, 'Demo infectious screening',      'PASS',    CURRENT_DATE - 19, 'Academic test value only.'),
    (6,  2, 'Demo blood-group confirmation',  'PASS',    CURRENT_DATE - 19, 'Group confirmed for demo.'),
    (7,  1, 'Demo infectious screening',      'PENDING', CURRENT_DATE - 19, 'Pending case for trigger test.'),
    (7,  2, 'Demo blood-group confirmation',  'PASS',    CURRENT_DATE - 19, 'Group confirmed for demo.'),
    (8,  1, 'Demo infectious screening',      'FAIL',    CURRENT_DATE - 19, 'Failure case for trigger test.'),
    (8,  2, 'Demo blood-group confirmation',  'PASS',    CURRENT_DATE - 19, 'Group confirmed for demo.'),
    (9,  1, 'Demo infectious screening',      'PASS',    CURRENT_DATE - 59, 'Historical passing result.'),
    (9,  2, 'Demo blood-group confirmation',  'PASS',    CURRENT_DATE - 59, 'Group confirmed for demo.'),
    (10, 1, 'Demo infectious screening',      'PASS',    CURRENT_DATE - 15, 'Academic test value only.'),
    (10, 2, 'Demo blood-group confirmation',  'PASS',    CURRENT_DATE - 15, 'Group confirmed for demo.'),
    (11, 1, 'Demo infectious screening',      'PASS',    CURRENT_DATE - 14, 'Academic test value only.'),
    (11, 2, 'Demo blood-group confirmation',  'PASS',    CURRENT_DATE - 14, 'Group confirmed for demo.'),
    (12, 1, 'Demo infectious screening',      'PASS',    CURRENT_DATE - 13, 'Academic test value only.'),
    (12, 2, 'Demo blood-group confirmation',  'PASS',    CURRENT_DATE - 13, 'Group confirmed for demo.'),
    (13, 1, 'Demo infectious screening',      'PASS',    CURRENT_DATE - 12, 'Academic test value only.'),
    (13, 2, 'Demo blood-group confirmation',  'PASS',    CURRENT_DATE - 12, 'Group confirmed for demo.'),
    (14, 1, 'Demo infectious screening',      'PASS',    CURRENT_DATE - 11, 'Academic test value only.'),
    (14, 2, 'Demo blood-group confirmation',  'PASS',    CURRENT_DATE - 11, 'Group confirmed for demo.'),
    (16, 1, 'Demo infectious screening',      'PASS',    CURRENT_DATE - 10, 'Academic test value only.'),
    (16, 2, 'Demo blood-group confirmation',  'PASS',    CURRENT_DATE - 10, 'Group confirmed for demo.'),
    (17, 1, 'Demo infectious screening',      'PASS',    CURRENT_DATE - 9,  'Academic test value only.'),
    (17, 2, 'Demo blood-group confirmation',  'PASS',    CURRENT_DATE - 9,  'Group confirmed for demo.'),
    (18, 1, 'Demo infectious screening',      'PASS',    CURRENT_DATE - 8,  'Academic test value only.'),
    (18, 2, 'Demo blood-group confirmation',  'PASS',    CURRENT_DATE - 8,  'Group confirmed for demo.'),
    (19, 1, 'Demo infectious screening',      'PASS',    CURRENT_DATE - 7,  'Academic test value only.'),
    (19, 2, 'Demo blood-group confirmation',  'PASS',    CURRENT_DATE - 7,  'Group confirmed for demo.'),
    (20, 1, 'Demo infectious screening',      'PASS',    CURRENT_DATE - 6,  'Academic test value only.'),
    (20, 2, 'Demo blood-group confirmation',  'PASS',    CURRENT_DATE - 6,  'Group confirmed for demo.'),
    (21, 1, 'Demo organ viability screening', 'PASS',    CURRENT_DATE - 5,  'Academic organ test only.'),
    (22, 1, 'Demo organ viability screening', 'PASS',    CURRENT_DATE - 4,  'Academic organ test only.'),
    (23, 1, 'Demo organ viability screening', 'PASS',    CURRENT_DATE - 3,  'Academic organ test only.'),
    (24, 1, 'Demo organ viability screening', 'PASS',    CURRENT_DATE - 2,  'Academic organ test only.'),
    (25, 1, 'Demo organ viability screening', 'FAIL',    CURRENT_DATE - 1,  'Unavailable academic organ case.');

-- --------------------------------------------------------------------------
-- Blood and organ emergency requests
-- --------------------------------------------------------------------------

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
VALUES
    (1,  13, 21, 'BLOOD', 'O+',  NULL,     2,    'CRITICAL', CURRENT_TIMESTAMP - INTERVAL '3 hours',  'PARTIALLY_RESERVED', 'One of two required units has been reserved.'),
    (2,  14, 21, 'BLOOD', 'A+',  NULL,     1,    'HIGH',     CURRENT_TIMESTAMP - INTERVAL '7 hours',  'RESERVED',           'Active reservation at regional bank.'),
    (3,  15, 23, 'BLOOD', 'B+',  NULL,     1,    'HIGH',     CURRENT_TIMESTAMP - INTERVAL '6 hours',  'RESERVED',           'Active reservation for one B+ unit.'),
    (4,  16, 25, 'BLOOD', 'AB+', NULL,     1,    'MEDIUM',   CURRENT_TIMESTAMP - INTERVAL '5 hours',  'RESERVED',           'Active reservation for one AB+ unit.'),
    (5,  13, 22, 'BLOOD', 'O+',  NULL,     1,    'HIGH',     CURRENT_TIMESTAMP - INTERVAL '3 days',   'COMPLETED',          'Unit issued and request completed.'),
    (6,  17, 25, 'BLOOD', 'O-',  NULL,     1,    'MEDIUM',   CURRENT_TIMESTAMP - INTERVAL '2 days',   'COMPLETED',          'Unit issued and request completed.'),
    (7,  15, 21, 'BLOOD', 'B+',  NULL,     1,    'LOW',      CURRENT_TIMESTAMP - INTERVAL '2 days',   'CANCELLED',          'Request cancelled after reservation release.'),
    (8,  13, 22, 'BLOOD', 'O+',  NULL,     1,    'HIGH',     CURRENT_TIMESTAMP - INTERVAL '2 days',   'PENDING',            'Previous reservation expired; request is pending again.'),
    (9,  20, 25, 'BLOOD', 'AB-', NULL,     1,    'CRITICAL', CURRENT_TIMESTAMP - INTERVAL '20 minutes','PENDING',            'Last-unit two-session concurrency demonstration.'),
    (10, 14, 23, 'ORGAN', NULL,  'KIDNEY', NULL, 'HIGH',     CURRENT_TIMESTAMP - INTERVAL '12 days',  'PENDING',            'Academic matching request; no clinical claim.'),
    (11, 18, 23, 'ORGAN', NULL,  'KIDNEY', NULL, 'CRITICAL', CURRENT_TIMESTAMP - INTERVAL '30 days',  'MATCHED',            'Academic selected kidney match.'),
    (12, 15, 25, 'ORGAN', NULL,  'LIVER',  NULL, 'CRITICAL', CURRENT_TIMESTAMP - INTERVAL '45 days',  'COMPLETED',          'Academic completed liver match.'),
    (13, 16, 25, 'ORGAN', NULL,  'CORNEA', NULL, 'MEDIUM',   CURRENT_TIMESTAMP - INTERVAL '8 days',   'PENDING',            'Academic cornea matching request.'),
    (14, 19, 24, 'ORGAN', NULL,  'KIDNEY', NULL, 'MEDIUM',   CURRENT_TIMESTAMP - INTERVAL '18 days',  'PENDING',            'Academic kidney matching request.');

-- --------------------------------------------------------------------------
-- Reservation history
-- --------------------------------------------------------------------------

INSERT INTO blood_reservation (
    reservation_id,
    request_id,
    blood_unit_id,
    reserved_at,
    expires_at,
    status,
    created_by
) OVERRIDING SYSTEM VALUE
VALUES
    (1, 1, 20, CURRENT_TIMESTAMP - INTERVAL '2 hours',        CURRENT_TIMESTAMP + INTERVAL '2 hours', 'ACTIVE',    10),
    (2, 2, 10, CURRENT_TIMESTAMP - INTERVAL '5 hours',        CURRENT_TIMESTAMP + INTERVAL '1 hour',  'ACTIVE',    8),
    (3, 3, 13, CURRENT_TIMESTAMP - INTERVAL '4 hours',        CURRENT_TIMESTAMP + INTERVAL '2 hours', 'ACTIVE',    8),
    (4, 4, 18, CURRENT_TIMESTAMP - INTERVAL '3 hours',        CURRENT_TIMESTAMP + INTERVAL '3 hours', 'ACTIVE',    10),
    (5, 5, 11, CURRENT_TIMESTAMP - INTERVAL '3 days',         CURRENT_TIMESTAMP - INTERVAL '2 days 18 hours', 'COMPLETED', 8),
    (6, 6, 17, CURRENT_TIMESTAMP - INTERVAL '2 days',         CURRENT_TIMESTAMP - INTERVAL '1 day 18 hours',  'COMPLETED', 10),
    (7, 7, 3,  CURRENT_TIMESTAMP - INTERVAL '2 days',         CURRENT_TIMESTAMP - INTERVAL '1 day 20 hours',  'CANCELLED', 3),
    (8, 8, 2,  CURRENT_TIMESTAMP - INTERVAL '2 days',         CURRENT_TIMESTAMP - INTERVAL '1 day',           'EXPIRED',   3);

-- --------------------------------------------------------------------------
-- Transparent academic organ matches
-- --------------------------------------------------------------------------

INSERT INTO organ_match (
    match_id,
    request_id,
    organ_unit_id,
    compatibility_score,
    match_status,
    calculated_at
) OVERRIDING SYSTEM VALUE
VALUES
    (1,  10, 1, 92.00, 'CANDIDATE', CURRENT_TIMESTAMP - INTERVAL '4 hours'),
    (2,  10, 2, 80.00, 'REJECTED',  CURRENT_TIMESTAMP - INTERVAL '4 hours'),
    (3,  10, 5, 55.00, 'REJECTED',  CURRENT_TIMESTAMP - INTERVAL '4 hours'),
    (4,  11, 1, 88.00, 'REJECTED',  CURRENT_TIMESTAMP - INTERVAL '3 hours'),
    (5,  11, 2, 96.00, 'SELECTED',  CURRENT_TIMESTAMP - INTERVAL '3 hours'),
    (6,  11, 5, 60.00, 'REJECTED',  CURRENT_TIMESTAMP - INTERVAL '3 hours'),
    (7,  12, 3, 94.00, 'COMPLETED', CURRENT_TIMESTAMP - INTERVAL '2 days'),
    (8,  13, 4, 90.00, 'CANDIDATE', CURRENT_TIMESTAMP - INTERVAL '2 hours'),
    (9,  14, 1, 85.00, 'CANDIDATE', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
    (10, 14, 5, 50.00, 'REJECTED',  CURRENT_TIMESTAMP - INTERVAL '1 hour');

-- --------------------------------------------------------------------------
-- Seeded audit examples; later triggers will generate additional rows
-- --------------------------------------------------------------------------

INSERT INTO audit_log (
    audit_id,
    user_id,
    table_name,
    record_id,
    action,
    old_status,
    new_status,
    action_time,
    details
) OVERRIDING SYSTEM VALUE
VALUES
    (1,  10, 'blood_unit',         '20', 'STATUS_CHANGE',      'AVAILABLE', 'RESERVED',  CURRENT_TIMESTAMP - INTERVAL '2 hours',        'Reserved for critical request 1.'),
    (2,  10, 'blood_reservation',  '1',  'INSERT',             NULL,        'ACTIVE',    CURRENT_TIMESTAMP - INTERVAL '2 hours',        'Atomic reservation demonstration record.'),
    (3,  8,  'blood_unit',         '10', 'STATUS_CHANGE',      'AVAILABLE', 'RESERVED',  CURRENT_TIMESTAMP - INTERVAL '5 hours',        'Reserved for request 2.'),
    (4,  8,  'blood_unit',         '13', 'STATUS_CHANGE',      'AVAILABLE', 'RESERVED',  CURRENT_TIMESTAMP - INTERVAL '4 hours',        'Reserved for request 3.'),
    (5,  10, 'blood_unit',         '18', 'STATUS_CHANGE',      'AVAILABLE', 'RESERVED',  CURRENT_TIMESTAMP - INTERVAL '3 hours',        'Reserved for request 4.'),
    (6,  8,  'blood_unit',         '11', 'STATUS_CHANGE',      'RESERVED',  'ISSUED',    CURRENT_TIMESTAMP - INTERVAL '2 days 20 hours','Issued for completed request 5.'),
    (7,  4,  'organ_match',        '5',  'STATUS_CHANGE',      'CANDIDATE', 'SELECTED',  CURRENT_TIMESTAMP - INTERVAL '3 hours',        'Academic match selection only.'),
    (8,  2,  'emergency_request',  '9',  'INSERT',             NULL,        'PENDING',   CURRENT_TIMESTAMP - INTERVAL '20 minutes',     'Critical AB- concurrency-test request created.'),
    (9,  3,  'blood_reservation',  '8',  'STATUS_CHANGE',      'ACTIVE',    'EXPIRED',   CURRENT_TIMESTAMP - INTERVAL '1 day',          'Reservation expired before issue.'),
    (10, 3,  'blood_unit',         '2',  'STATUS_CHANGE',      'RESERVED',  'AVAILABLE', CURRENT_TIMESTAMP - INTERVAL '1 day',          'Unexpired unit returned to available stock.');

-- --------------------------------------------------------------------------
-- Synchronize identity sequences after explicit deterministic seed IDs
-- --------------------------------------------------------------------------

SELECT setval(pg_get_serial_sequence('lifelink.address', 'address_id'), MAX(address_id), TRUE)
FROM address;

SELECT setval(pg_get_serial_sequence('lifelink.person', 'person_id'), MAX(person_id), TRUE)
FROM person;

SELECT setval(pg_get_serial_sequence('lifelink.hospital', 'hospital_id'), MAX(hospital_id), TRUE)
FROM hospital;

SELECT setval(pg_get_serial_sequence('lifelink.blood_bank', 'blood_bank_id'), MAX(blood_bank_id), TRUE)
FROM blood_bank;

SELECT setval(pg_get_serial_sequence('lifelink.organ_bank', 'organ_bank_id'), MAX(organ_bank_id), TRUE)
FROM organ_bank;

SELECT setval(pg_get_serial_sequence('lifelink.donation_camp', 'camp_id'), MAX(camp_id), TRUE)
FROM donation_camp;

SELECT setval(pg_get_serial_sequence('lifelink.medical_condition', 'condition_id'), MAX(condition_id), TRUE)
FROM medical_condition;

SELECT setval(pg_get_serial_sequence('lifelink.donor_phone', 'phone_id'), MAX(phone_id), TRUE)
FROM donor_phone;

SELECT setval(
    pg_get_serial_sequence('lifelink.donation_registration', 'registration_id'),
    MAX(registration_id),
    TRUE
)
FROM donation_registration;

SELECT setval(pg_get_serial_sequence('lifelink.user_account', 'user_id'), MAX(user_id), TRUE)
FROM user_account;

SELECT setval(pg_get_serial_sequence('lifelink.donation', 'donation_id'), MAX(donation_id), TRUE)
FROM donation;

SELECT setval(pg_get_serial_sequence('lifelink.blood_unit', 'blood_unit_id'), MAX(blood_unit_id), TRUE)
FROM blood_unit;

SELECT setval(pg_get_serial_sequence('lifelink.organ_unit', 'organ_unit_id'), MAX(organ_unit_id), TRUE)
FROM organ_unit;

SELECT setval(
    pg_get_serial_sequence('lifelink.emergency_request', 'request_id'),
    MAX(request_id),
    TRUE
)
FROM emergency_request;

SELECT setval(
    pg_get_serial_sequence('lifelink.blood_reservation', 'reservation_id'),
    MAX(reservation_id),
    TRUE
)
FROM blood_reservation;

SELECT setval(pg_get_serial_sequence('lifelink.organ_match', 'match_id'), MAX(match_id), TRUE)
FROM organ_match;

SELECT setval(pg_get_serial_sequence('lifelink.audit_log', 'audit_id'), MAX(audit_id), TRUE)
FROM audit_log;

COMMIT;

/*
 * Expected core row counts:
 *   address                  18
 *   person                   31
 *   donor                    12
 *   recipient                 8
 *   doctor                    5
 *   hospital                  3
 *   blood_bank                3
 *   organ_bank                2
 *   donation                 25
 *   blood_donation           20
 *   organ_donation            5
 *   blood_unit               20
 *   organ_unit                5
 *   medical_test_result      43
 *   emergency_request        14
 *   blood_reservation         8
 *   organ_match              10
 *   donation_camp             3
 *   donation_registration    13
 *   user_account             10
 *   audit_log                10
 */
