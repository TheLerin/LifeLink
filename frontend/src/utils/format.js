/**
 * Display formatting helpers.
 *
 * The API returns ISO timestamps, plain numbers and SCREAMING_SNAKE enums.
 * These turn them into something a human reads comfortably, and always fail
 * soft: a missing value renders as an em dash rather than "null".
 */

const DASH = "—";

/** "BLOOD_BANK_STAFF" -> "Blood bank staff" */
export function humanise(value) {
  if (value === null || value === undefined || value === "") return DASH;
  const text = String(value).replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "PARTIALLY_RESERVED" -> "Partially reserved", but keeps blood groups intact. */
export function formatEnum(value) {
  if (value === null || value === undefined || value === "") return DASH;
  const raw = String(value);
  // Blood groups and short codes are already readable.
  if (/^(A|B|AB|O)[+-]$/.test(raw)) return raw;
  return humanise(raw);
}

export function formatDate(value) {
  if (!value) return DASH;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(value) {
  if (!value) return DASH;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Short form for dense tables: "12 Mar, 14:30". */
export function formatShortDateTime(value) {
  if (!value) return DASH;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "in 3 days" / "2 hours ago" - used for expiry and hold countdowns. */
export function formatRelative(value) {
  if (!value) return DASH;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const diffMs = date.getTime() - Date.now();
  const future = diffMs >= 0;
  const abs = Math.abs(diffMs);

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  let text;
  if (abs < minute) text = "less than a minute";
  else if (abs < hour) {
    const n = Math.round(abs / minute);
    text = `${n} minute${n === 1 ? "" : "s"}`;
  } else if (abs < day) {
    const n = Math.round(abs / hour);
    text = `${n} hour${n === 1 ? "" : "s"}`;
  } else {
    const n = Math.round(abs / day);
    text = `${n} day${n === 1 ? "" : "s"}`;
  }

  return future ? `in ${text}` : `${text} ago`;
}

/** Whole days until a date; negative when already past. */
export function daysUntil(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const startOfDay = (d) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round(
    (startOfDay(date) - startOfDay(new Date())) / (24 * 60 * 60 * 1000),
  );
}

export function formatNumber(value, options) {
  if (value === null || value === undefined || value === "") return DASH;
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  return num.toLocaleString(undefined, options);
}

/** Scores come back as numeric strings from psycopg; show 2 decimals. */
export function formatScore(value) {
  if (value === null || value === undefined || value === "") return DASH;
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  return num.toFixed(2);
}

export function formatVolume(ml) {
  if (ml === null || ml === undefined || ml === "") return DASH;
  const num = Number(ml);
  if (Number.isNaN(num)) return String(ml);
  return `${formatNumber(num)} mL`;
}

/** "Ananya Rao" -> "AR", for avatar initials. */
export function initials(name) {
  if (!name) return "?";
  return String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

/** Today's date as yyyy-mm-dd, for date-input defaults and max values. */
export function todayIso() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Turn "" into null so optional API fields are omitted rather than blanked. */
export function blankToNull(value) {
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}

/** Strip empty strings/nulls from a payload before POST/PATCH. */
export function compactPayload(payload) {
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (value === null) continue;
    out[key] = typeof value === "string" ? value.trim() : value;
  }
  return out;
}

export { DASH };
