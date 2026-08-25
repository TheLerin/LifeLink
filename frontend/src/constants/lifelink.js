/**
 * LifeLink shared domain constants.
 *
 * Every enum here mirrors the PostgreSQL CHECK constraints and the FastAPI
 * Pydantic StrEnum definitions exactly. If the database changes, change it
 * here too - the UI must never invent a status the database will reject.
 */

export const ROLES = {
  ADMIN: "ADMIN",
  DOCTOR: "DOCTOR",
  BLOOD_BANK_STAFF: "BLOOD_BANK_STAFF",
  ORGAN_BANK_STAFF: "ORGAN_BANK_STAFF",
  DONOR: "DONOR",
  RECIPIENT: "RECIPIENT",
};

export const ALL_ROLES = Object.values(ROLES);

export const ROLE_LABELS = {
  ADMIN: "Administrator",
  DOCTOR: "Doctor",
  BLOOD_BANK_STAFF: "Blood bank staff",
  ORGAN_BANK_STAFF: "Organ bank staff",
  DONOR: "Donor",
  RECIPIENT: "Recipient",
};

export const USER_STATUSES = ["ACTIVE", "DISABLED", "LOCKED"];
export const GENDERS = ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"];
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
export const DONATION_TYPES = ["BLOOD", "ORGAN"];
export const DONATION_RECORD_STATUSES = ["ACTIVE", "VOIDED"];
export const DONOR_CONDITION_STATUSES = ["ACTIVE", "RESOLVED", "MONITORED"];
export const FACILITY_STATUSES = ["ACTIVE", "INACTIVE"];
export const RECIPIENT_STATUSES = ["ACTIVE", "INACTIVE"];

export const BLOOD_UNIT_STATUSES = [
  "COLLECTED",
  "TESTING",
  "AVAILABLE",
  "RESERVED",
  "ISSUED",
  "REJECTED",
  "EXPIRED",
];

export const ORGAN_UNIT_STATUSES = [
  "AVAILABLE",
  "MATCHING",
  "ALLOCATED",
  "UNAVAILABLE",
];

export const TEST_RESULTS = ["PASS", "FAIL", "PENDING"];
export const REQUEST_TYPES = ["BLOOD", "ORGAN"];
export const REQUEST_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export const REQUEST_STATUSES = [
  "PENDING",
  "PARTIALLY_RESERVED",
  "RESERVED",
  "MATCHED",
  "COMPLETED",
  "CANCELLED",
];

export const RESERVATION_STATUSES = [
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
];

export const ORGAN_MATCH_STATUSES = [
  "CANDIDATE",
  "SELECTED",
  "REJECTED",
  "COMPLETED",
];

export const CAMP_STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED"];

export const REGISTRATION_STATUSES = [
  "REGISTERED",
  "ATTENDED",
  "CANCELLED",
  "NO_SHOW",
];

/**
 * The blood-unit lifecycle transitions the DATABASE will accept.
 *
 * This mirrors validate_blood_unit_status_transition() in
 * database/05_trigger_functions.sql. The UI uses it only to decide which
 * buttons to offer - PostgreSQL remains the authority that enforces it.
 *
 * RESERVED is deliberately absent as a manual target: a unit may only become
 * RESERVED through POST /api/emergency-requests/{id}/reserve so the database
 * performs the locking, FEFO allocation and audit write atomically.
 */
export const BLOOD_UNIT_MANUAL_TRANSITIONS = {
  COLLECTED: ["TESTING"],
  TESTING: ["AVAILABLE", "REJECTED"],
  AVAILABLE: ["EXPIRED"],
  RESERVED: [],
  ISSUED: [],
  REJECTED: [],
  EXPIRED: [],
};

/** Ordered happy-path lifecycle used by the blood-unit timeline display. */
export const BLOOD_UNIT_LIFECYCLE = [
  "COLLECTED",
  "TESTING",
  "AVAILABLE",
  "RESERVED",
  "ISSUED",
];

/**
 * Status -> badge tone. Colours follow blueprint section 28:
 * green AVAILABLE, orange RESERVED, blue TESTING, grey ISSUED,
 * red EXPIRED/REJECTED.
 */
export const STATUS_TONES = {
  // Blood unit lifecycle
  COLLECTED: "slate",
  TESTING: "blue",
  AVAILABLE: "green",
  RESERVED: "orange",
  ISSUED: "slate",
  REJECTED: "red",
  EXPIRED: "red",

  // Requests
  PENDING: "amber",
  PARTIALLY_RESERVED: "orange",
  MATCHED: "blue",
  COMPLETED: "green",
  CANCELLED: "slate",

  // Reservations / generic
  ACTIVE: "green",
  INACTIVE: "slate",
  DISABLED: "slate",
  LOCKED: "red",
  VOIDED: "red",

  // Priorities
  LOW: "slate",
  MEDIUM: "blue",
  HIGH: "amber",
  CRITICAL: "red",

  // Test results
  PASS: "green",
  FAIL: "red",

  // Organ units / matches
  MATCHING: "blue",
  ALLOCATED: "green",
  UNAVAILABLE: "slate",
  CANDIDATE: "blue",
  SELECTED: "green",

  // Camps / registrations
  SCHEDULED: "blue",
  REGISTERED: "blue",
  ATTENDED: "green",
  NO_SHOW: "red",

  // Donor conditions
  RESOLVED: "green",
  MONITORED: "amber",
};

/** Tailwind classes for each badge tone. */
export const TONE_CLASSES = {
  green: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  orange: "bg-orange-100 text-orange-800 ring-orange-200",
  blue: "bg-sky-100 text-sky-800 ring-sky-200",
  amber: "bg-amber-100 text-amber-900 ring-amber-200",
  red: "bg-red-100 text-red-800 ring-red-200",
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
};

/**
 * A short, plain-language academic disclaimer. The organ score is an
 * educational ranking model, never clinical guidance.
 */
export const ORGAN_SCORE_NOTE =
  "Academic Priority Score = 0.50 x compatibility + 0.30 x urgency + " +
  "0.20 x waiting time. This is an educational ranking model for a college " +
  "DBMS project. It is not medical advice and not clinical transplant guidance.";

/** Demo accounts seeded by database/03_sample_data.sql (development only). */
export const DEMO_ACCOUNTS = [
  { username: "admin.demo", role: "ADMIN" },
  { username: "doctor.maya", role: "DOCTOR" },
  { username: "blood.central", role: "BLOOD_BANK_STAFF" },
  { username: "organ.hopebridge", role: "ORGAN_BANK_STAFF" },
  { username: "donor.ananya", role: "DONOR" },
  { username: "recipient.isha", role: "RECIPIENT" },
];

export const DEMO_PASSWORD = "Demo@123";
