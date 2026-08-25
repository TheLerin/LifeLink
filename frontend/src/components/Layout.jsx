/**
 * Page-level presentation pieces: headers, stat cards, key/value detail lists
 * and the blood-unit style timeline.
 */

import { Link } from "react-router-dom";
import { ArrowLeft } from "./icons.js";
import { DASH, formatNumber } from "../utils/format.js";

/** Standard page heading with optional breadcrumb-style back link. */
export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
  backTo,
  backLabel = "Back",
  className = "",
}) {
  return (
    <header className={`mb-5 ${className}`}>
      {backTo ? (
        <Link
          to={backTo}
          className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {backLabel}
        </Link>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span className="mt-0.5 rounded-lg bg-navy-800 p-2 text-white">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-slate-900">
              {title}
            </h1>
            {description ? (
              <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>
            ) : null}
          </div>
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

const ACCENT_CLASS = {
  blood: "bg-blood-50 text-blood-600",
  navy: "bg-navy-50 text-navy-800",
  green: "bg-emerald-50 text-emerald-600",
  orange: "bg-orange-50 text-orange-600",
  blue: "bg-sky-50 text-sky-600",
  amber: "bg-amber-50 text-amber-700",
  slate: "bg-slate-100 text-slate-600",
};

/** A single headline metric. Wrap in `to` to make it a shortcut into a list. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = "navy",
  to,
  loading = false,
}) {
  const body = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </p>
        {loading ? (
          <div className="mt-2 h-7 w-16 animate-pulse rounded bg-slate-100" />
        ) : (
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {typeof value === "number" ? formatNumber(value) : (value ?? DASH)}
          </p>
        )}
        {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      </div>
      {Icon ? (
        <span
          className={`rounded-lg p-2 ${ACCENT_CLASS[accent] || ACCENT_CLASS.navy}`}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      ) : null}
    </div>
  );

  if (to) {
    return (
      <Link
        to={to}
        className="ll-card block p-4 transition-shadow hover:shadow-md focus:shadow-md"
      >
        {body}
      </Link>
    );
  }
  return <div className="ll-card p-4">{body}</div>;
}

/**
 * Key/value list for detail pages.
 * Pass items as [{ label, value }]; falsy values render as an em dash.
 */
export function DetailList({ items, columns = 2, className = "" }) {
  const cols = {
    1: "sm:grid-cols-1",
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
  };
  return (
    <dl
      className={`grid grid-cols-1 gap-x-6 gap-y-4 ${cols[columns] || cols[2]} ${className}`}
    >
      {items
        .filter((item) => item && !item.hidden)
        .map((item) => (
          <div key={item.label} className={item.span ? "sm:col-span-2" : undefined}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {item.label}
            </dt>
            <dd className="mt-1 break-words text-sm text-slate-800">
              {item.value === null || item.value === undefined || item.value === ""
                ? DASH
                : item.value}
            </dd>
          </div>
        ))}
    </dl>
  );
}

/**
 * Vertical event timeline, used for the blood-unit audit trail.
 * Items: [{ title, timestamp, actor, description, badge, tone }]
 */
export function Timeline({ items, className = "" }) {
  const TONE_DOT = {
    green: "bg-emerald-500",
    orange: "bg-orange-500",
    blue: "bg-sky-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
    slate: "bg-slate-400",
  };

  return (
    <ol className={`relative space-y-0 ${className}`}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <li key={item.key ?? index} className="relative flex gap-4 pb-6 last:pb-0">
            {/* Connector line, omitted on the final entry. */}
            {!isLast ? (
              <span
                className="absolute left-[7px] top-4 h-full w-px bg-slate-200"
                aria-hidden="true"
              />
            ) : null}
            <span
              className={`relative mt-1 h-[15px] w-[15px] shrink-0 rounded-full ring-4 ring-white ${
                TONE_DOT[item.tone] || TONE_DOT.slate
              }`}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-slate-800">{item.title}</p>
                {item.badge}
              </div>
              {item.timestamp ? (
                <p className="mt-0.5 text-xs text-slate-500">{item.timestamp}</p>
              ) : null}
              {item.actor ? (
                <p className="mt-0.5 text-xs text-slate-500">{item.actor}</p>
              ) : null}
              {item.description ? (
                <p className="mt-1 text-sm text-slate-600">{item.description}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Simple tab strip for detail pages with several panels. */
export function Tabs({ tabs, active, onChange, className = "" }) {
  return (
    <div className={`border-b border-slate-200 ${className}`}>
      <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Sections">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              aria-current={isActive ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "border-blood-600 text-blood-700"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
              }`}
            >
              {tab.label}
              {typeof tab.count === "number" ? (
                <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-600">
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
