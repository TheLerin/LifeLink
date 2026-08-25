/**
 * StatusBadge - a coloured pill for any enum value.
 *
 * The colour comes from STATUS_TONES (blueprint section 28), so AVAILABLE is
 * always green, RESERVED always orange and so on, everywhere in the app.
 */

import { STATUS_TONES, TONE_CLASSES } from "../constants/lifelink.js";
import { formatEnum } from "../utils/format.js";

export default function StatusBadge({ value, tone, className = "" }) {
  if (value === null || value === undefined || value === "") return null;
  const resolvedTone = tone || STATUS_TONES[value] || "slate";
  const toneClass = TONE_CLASSES[resolvedTone] || TONE_CLASSES.slate;

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${toneClass} ${className}`}
    >
      {formatEnum(value)}
    </span>
  );
}
