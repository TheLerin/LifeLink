/**
 * Role-aware navigation.
 *
 * Every `roles` array below was derived from the actual `require_roles(...)`
 * guards in backend/app/routes/*.py. A nav item is shown only if the signed-in
 * role can actually call the endpoints behind it - so the user never meets a
 * 403 by clicking the sidebar.
 *
 * The backend and the database still enforce authorisation independently. This
 * file only decides what is worth showing.
 */

import { ROLES } from "./lifelink.js";

const { ADMIN, DOCTOR, BLOOD_BANK_STAFF, ORGAN_BANK_STAFF, DONOR, RECIPIENT } =
  ROLES;

/** Endpoints with no role guard - readable by any signed-in user. */
const EVERYONE = [
  ADMIN,
  DOCTOR,
  BLOOD_BANK_STAFF,
  ORGAN_BANK_STAFF,
  DONOR,
  RECIPIENT,
];

/**
 * Sidebar definition. Groups render as labelled sections; a group disappears
 * entirely when none of its items are visible to the current role.
 *
 * `selfPath` lets donor/recipient accounts point at their own record: the
 * backend keys ownership off the JWT's person_id, and donor_id / recipient_id
 * are the same value as person_id in the schema.
 */
export const NAV_GROUPS = [
  {
    label: null,
    items: [
      { to: "/", label: "Dashboard", icon: "dashboard", roles: EVERYONE, end: true },
    ],
  },
  {
    label: "People",
    items: [
      {
        to: "/donors",
        label: "Donors",
        icon: "donors",
        roles: [ADMIN, BLOOD_BANK_STAFF, ORGAN_BANK_STAFF],
      },
      {
        label: "My donor profile",
        icon: "donors",
        roles: [DONOR],
        selfPath: (user) => `/donors/${user.person_id}`,
      },
      {
        to: "/recipients",
        label: "Recipients",
        icon: "recipients",
        roles: [ADMIN, DOCTOR, BLOOD_BANK_STAFF, ORGAN_BANK_STAFF],
      },
      {
        label: "My recipient profile",
        icon: "recipients",
        roles: [RECIPIENT],
        selfPath: (user) => `/recipients/${user.person_id}`,
      },
      { to: "/doctors", label: "Doctors", icon: "doctors", roles: [ADMIN, DOCTOR] },
    ],
  },
  {
    label: "Blood operations",
    items: [
      {
        to: "/donations",
        label: "Donations",
        icon: "donations",
        roles: [ADMIN, BLOOD_BANK_STAFF, ORGAN_BANK_STAFF, DONOR],
      },
      {
        to: "/blood-units",
        label: "Blood inventory",
        icon: "bloodUnits",
        roles: [ADMIN, BLOOD_BANK_STAFF],
      },
      {
        to: "/emergency-requests",
        label: "Emergency requests",
        icon: "emergency",
        roles: [ADMIN, DOCTOR, BLOOD_BANK_STAFF, ORGAN_BANK_STAFF, RECIPIENT],
      },
      {
        to: "/reservations",
        label: "Reservations",
        icon: "reservations",
        roles: [ADMIN, DOCTOR, BLOOD_BANK_STAFF, RECIPIENT],
      },
    ],
  },
  {
    label: "Organ operations",
    items: [
      {
        to: "/organs",
        label: "Organ units",
        icon: "organs",
        roles: [ADMIN, ORGAN_BANK_STAFF],
      },
    ],
  },
  {
    label: "Network",
    items: [
      { to: "/hospitals", label: "Hospitals", icon: "hospitals", roles: EVERYONE },
      {
        to: "/blood-banks",
        label: "Blood banks",
        icon: "bloodBanks",
        roles: EVERYONE,
      },
      {
        to: "/organ-banks",
        label: "Organ banks",
        icon: "organBanks",
        roles: EVERYONE,
      },
      { to: "/camps", label: "Donation camps", icon: "camps", roles: EVERYONE },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        to: "/reports",
        label: "Reports",
        icon: "reports",
        roles: [ADMIN, BLOOD_BANK_STAFF, ORGAN_BANK_STAFF],
      },
      { to: "/audit", label: "Audit log", icon: "audit", roles: [ADMIN] },
      { to: "/users", label: "User accounts", icon: "users", roles: [ADMIN] },
    ],
  },
];

/** Resolve the sidebar for one user, dropping empty groups. */
export function navigationForUser(user) {
  if (!user) return [];
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items
      .filter((item) => item.roles.includes(user.role))
      .map((item) => ({
        ...item,
        to: item.selfPath ? item.selfPath(user) : item.to,
      }))
      .filter((item) => Boolean(item.to)),
  })).filter((group) => group.items.length > 0);
}

/**
 * Report catalogue. Each entry maps to one GET /api/reports/* endpoint and
 * carries the exact roles that endpoint allows.
 */
export const REPORT_CATALOGUE = [
  {
    slug: "blood-inventory",
    title: "Blood inventory summary",
    description:
      "Stock counted by blood group and status across every blood bank, with expiry pressure.",
    icon: "bloodUnits",
    roles: [ADMIN, BLOOD_BANK_STAFF],
  },
  {
    slug: "expiring-units",
    title: "Expiring units",
    description:
      "Available units nearing expiry, oldest first, so they can be used before they are wasted.",
    icon: "clock",
    roles: [ADMIN, BLOOD_BANK_STAFF],
  },
  {
    slug: "reservations",
    title: "Reservation activity",
    description:
      "Active, completed, cancelled and expired holds, with the units and requests involved.",
    icon: "reservations",
    roles: [ADMIN, BLOOD_BANK_STAFF],
  },
  {
    slug: "emergency-summary",
    title: "Emergency request summary",
    description:
      "Request volume and fulfilment broken down by priority, type and status.",
    icon: "emergency",
    roles: [ADMIN],
  },
  {
    slug: "donation-trends",
    title: "Donation trends",
    description:
      "Donations over time by month and type, showing collection momentum.",
    icon: "trends",
    roles: [ADMIN],
  },
  {
    slug: "hospital-response-time",
    title: "Hospital response time",
    description:
      "How quickly each hospital's requests move from raised to reserved.",
    icon: "hospitals",
    roles: [ADMIN],
  },
  {
    slug: "organ-matches",
    title: "Organ match outcomes",
    description:
      "Candidate rankings and allocation outcomes per organ unit, with Academic Priority Scores.",
    icon: "organs",
    roles: [ADMIN, ORGAN_BANK_STAFF],
  },
];

export function reportsForRole(role) {
  return REPORT_CATALOGUE.filter((report) => report.roles.includes(role));
}

/**
 * Route-level access map. ProtectedRoute reads this so a hand-typed URL is
 * refused the same way the sidebar would have hidden it.
 */
export const ROUTE_ROLES = {
  "/donors": [ADMIN, BLOOD_BANK_STAFF, ORGAN_BANK_STAFF],
  "/donors/:donorId": [ADMIN, BLOOD_BANK_STAFF, ORGAN_BANK_STAFF, DONOR],
  "/recipients": [ADMIN, DOCTOR, BLOOD_BANK_STAFF, ORGAN_BANK_STAFF],
  "/recipients/:recipientId": [
    ADMIN,
    DOCTOR,
    BLOOD_BANK_STAFF,
    ORGAN_BANK_STAFF,
    RECIPIENT,
  ],
  "/doctors": [ADMIN, DOCTOR],
  "/donations": [ADMIN, BLOOD_BANK_STAFF, ORGAN_BANK_STAFF, DONOR],
  "/blood-units": [ADMIN, BLOOD_BANK_STAFF],
  "/emergency-requests": [
    ADMIN,
    DOCTOR,
    BLOOD_BANK_STAFF,
    ORGAN_BANK_STAFF,
    RECIPIENT,
  ],
  "/reservations": [ADMIN, DOCTOR, BLOOD_BANK_STAFF, RECIPIENT],
  "/organs": [ADMIN, ORGAN_BANK_STAFF],
  "/reports": [ADMIN, BLOOD_BANK_STAFF, ORGAN_BANK_STAFF],
  "/audit": [ADMIN],
  "/users": [ADMIN],
};
