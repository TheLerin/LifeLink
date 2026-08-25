/**
 * Report catalogue - one source of truth for the seven reports.
 *
 * Kept deliberately free of JSX so both the index page and the detail page can
 * import it: ReportsPage renders these as cards, ReportDetailPage looks up the
 * slug and pairs it with its column and chart definitions.
 *
 * `roles` mirrors each endpoint's backend guard exactly, so a blood-bank staff
 * member never sees a card for a report that would answer 403:
 *
 *   admin_blood  (ADMIN + BLOOD_BANK_STAFF) -> blood-inventory, expiring-units, reservations
 *   admin_organ  (ADMIN + ORGAN_BANK_STAFF) -> organ-matches
 *   admin        (ADMIN only)               -> emergency-summary, donation-trends,
 *                                             hospital-response-time
 *
 * `source` names the view or function that produces the rows. This is a DBMS
 * project, so being explicit about where a number comes from is the point.
 */

import { ROLES } from "./lifelink.js";

const { ADMIN, BLOOD_BANK_STAFF, ORGAN_BANK_STAFF } = ROLES;

export const REPORTS = [
  {
    slug: "blood-inventory",
    title: "Blood inventory",
    summary:
      "Unit counts by bank, blood group and status, with earliest expiry and how many lapse within a week.",
    icon: "bloodUnits",
    accent: "blood",
    roles: [ADMIN, BLOOD_BANK_STAFF],
    source: "lifelink.generate_inventory_report(...)",
    sourceNote:
      "A parameterised stored function, so the filters below are applied inside PostgreSQL rather than in the browser.",
    filterable: true,
  },
  {
    slug: "expiring-units",
    title: "Expiring units",
    summary:
      "The FEFO watchlist: allocatable units closest to expiry, soonest first.",
    icon: "clock",
    accent: "amber",
    roles: [ADMIN, BLOOD_BANK_STAFF],
    source: "lifelink.expiring_blood_units_view",
    sourceNote:
      "Ordered by days to expiry, which is the same order the reservation function allocates in.",
    filterable: false,
  },
  {
    slug: "emergency-summary",
    title: "Emergency request summary",
    summary:
      "Request counts grouped by hospital, request type, priority and status.",
    icon: "emergency",
    accent: "orange",
    roles: [ADMIN],
    source: "lifelink.emergency_request joined to doctor and hospital",
    sourceNote:
      "An aggregate GROUP BY across four dimensions; the hospital comes from the requesting doctor's posting.",
    filterable: false,
  },
  {
    slug: "donation-trends",
    title: "Donation trends",
    summary: "Blood and organ donations per month, for the trend chart.",
    icon: "trends",
    accent: "green",
    roles: [ADMIN],
    source: "lifelink.donation grouped by month",
    sourceNote:
      "Months are produced by date_trunc, so a month with no donations of a type is simply absent.",
    filterable: false,
  },
  {
    slug: "reservations",
    title: "Reservation summary",
    summary: "Reservation counts by blood bank and reservation status.",
    icon: "reservations",
    accent: "blue",
    roles: [ADMIN, BLOOD_BANK_STAFF],
    source: "lifelink.blood_reservation joined to blood_unit and blood_bank",
    sourceNote:
      "Shows how holds resolved: still ACTIVE, COMPLETED (issued), CANCELLED or EXPIRED.",
    filterable: false,
  },
  {
    slug: "organ-matches",
    title: "Organ match ranking",
    summary:
      "Every academic candidate ranking across all organ units, best-ranked first.",
    icon: "organs",
    accent: "navy",
    roles: [ADMIN, ORGAN_BANK_STAFF],
    source: "lifelink.organ_match_priority_view",
    sourceNote:
      "The Academic Priority Score and its three components come straight from the view; nothing is computed in the browser.",
    filterable: false,
  },
  {
    slug: "hospital-response-time",
    title: "Hospital response time",
    summary:
      "Average minutes from raising a blood request to its first reservation, per hospital.",
    icon: "hospitals",
    accent: "slate",
    roles: [ADMIN],
    source: "lifelink.emergency_request joined to blood_reservation",
    sourceNote:
      "Only requests that reached a reservation are counted, so a hospital with no reservations does not appear.",
    filterable: false,
  },
];

/** Look up one report by its URL slug. */
export function reportBySlug(slug) {
  return REPORTS.find((report) => report.slug === slug) || null;
}

/** The reports a given role is allowed to open. */
export function reportsForRole(role) {
  if (!role) return [];
  return REPORTS.filter((report) => report.roles.includes(role));
}
