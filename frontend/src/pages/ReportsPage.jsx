/**
 * ReportsPage - the report gallery (ADMIN, blood-bank staff, organ-bank staff).
 *
 * Each card links to /reports/{slug}. The gallery only shows reports the signed
 * in role may actually open, using the same allow-lists the backend guards
 * enforce (see constants/reports.js), so nobody is offered a card that would
 * answer 403.
 *
 * The route itself is guarded to [ADMIN, BLOOD_BANK_STAFF, ORGAN_BANK_STAFF];
 * this page adds the finer per-report filtering on top.
 */

import { Link } from "react-router-dom";
import { PageHeader } from "../components/Layout.jsx";
import { Callout, EmptyState } from "../components/States.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { reportsForRole } from "../constants/reports.js";
import { iconFor, BarChart3, ArrowRight } from "../components/icons.js";

const ACCENT_CLASS = {
  blood: "bg-blood-50 text-blood-600",
  navy: "bg-navy-50 text-navy-800",
  green: "bg-emerald-50 text-emerald-600",
  orange: "bg-orange-50 text-orange-600",
  blue: "bg-sky-50 text-sky-600",
  amber: "bg-amber-50 text-amber-700",
  slate: "bg-slate-100 text-slate-600",
};

export default function ReportsPage() {
  const { user } = useAuth();
  const reports = reportsForRole(user?.role);

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Read-only summaries built directly on SQL views and functions. Each report names the view or function it comes from."
        icon={BarChart3}
      />

      <Callout tone="neutral" className="mb-5">
        Every figure here is produced by the database - a view, an aggregate or a
        stored function - not recomputed in the browser. You are shown only the
        reports your role is permitted to run.
      </Callout>

      {reports.length === 0 ? (
        <EmptyState
          title="No reports available"
          message="Your role does not have access to any reports."
          icon={BarChart3}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((report) => {
            const Icon = iconFor(report.icon);
            return (
              <Link
                key={report.slug}
                to={`/reports/${report.slug}`}
                className="ll-card group flex h-full flex-col p-5 transition-shadow hover:shadow-md focus:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={`rounded-lg p-2 ${ACCENT_CLASS[report.accent] || ACCENT_CLASS.navy}`}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <ArrowRight
                    className="h-4 w-4 text-slate-300 transition-colors group-hover:text-slate-500"
                    aria-hidden="true"
                  />
                </div>
                <h2 className="mt-3 text-base font-semibold text-slate-900">
                  {report.title}
                </h2>
                <p className="mt-1 flex-1 text-sm text-slate-500">
                  {report.summary}
                </p>
                <p className="mt-3 font-mono text-xs text-slate-400">
                  {report.source}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
