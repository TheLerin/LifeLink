/**
 * ReportDetailPage - renders any one of the seven reports.
 *
 * One page, seven configurations. The slug in the URL selects three things: the
 * fetcher (REPORT_FETCHERS in api/endpoints.js), the column set, and the chart -
 * so adding a report later means adding a definition, not another page.
 *
 * Reports return plain arrays rather than paged envelopes, so there is no
 * pagination here. Charts are derived from the SAME rows shown in the table, by
 * simple aggregation, so the picture and the numbers can never disagree.
 *
 * Access is checked twice: the route allows [ADMIN, BLOOD_BANK_STAFF,
 * ORGAN_BANK_STAFF], and this page additionally refuses to fetch a report whose
 * backend guard would reject the caller, explaining why instead of showing a
 * bare 403.
 *
 * Only blood-inventory takes filters, and they are passed to
 * generate_inventory_report() so PostgreSQL does the filtering.
 */

import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageHeader } from "../components/Layout.jsx";
import { Section, Callout, ErrorState } from "../components/States.jsx";
import DataTable from "../components/DataTable.jsx";
import FilterBar from "../components/FilterBar.jsx";
import Button from "../components/Button.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { REPORT_FETCHERS } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";
import { useBloodBankOptions } from "../hooks/useLookups.js";
import { useAuth } from "../context/AuthContext.jsx";
import { reportBySlug } from "../constants/reports.js";
import {
  BLOOD_GROUPS,
  BLOOD_UNIT_STATUSES,
  ORGAN_SCORE_NOTE,
} from "../constants/lifelink.js";
import { iconFor, BarChart3, Download } from "../components/icons.js";
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatScore,
  DASH,
} from "../utils/format.js";

const CHART_COLOURS = [
  "#dc2626",
  "#16203a",
  "#0ea5e9",
  "#f97316",
  "#10b981",
  "#a855f7",
  "#eab308",
  "#64748b",
];

const AXIS_TICK = { fontSize: 12, fill: "#64748b" };

/* -------------------------------------------------------------------------- */
/* CSV export                                                                 */
/* -------------------------------------------------------------------------- */

/** RFC-4180-ish escaping: quote anything containing a comma, quote or newline. */
function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Export the RAW api rows, so the download matches the database, not the UI. */
function downloadCsv(slug, rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(",")),
  ];
  const blob = new Blob([lines.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `lifelink-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/* -------------------------------------------------------------------------- */
/* Small shared cells                                                        */
/* -------------------------------------------------------------------------- */

const groupCell = (row) => (
  <span className="inline-flex items-center rounded bg-blood-50 px-2 py-0.5 text-sm font-bold text-blood-700">
    {row.blood_group}
  </span>
);

const countCell = (key) => (row) => (
  <span className="tabular-nums text-slate-800">{formatNumber(row[key])}</span>
);

/* -------------------------------------------------------------------------- */
/* Column sets, one per slug                                                 */
/* -------------------------------------------------------------------------- */

const COLUMNS = {
  "blood-inventory": [
    {
      key: "blood_bank_name",
      header: "Blood bank",
      render: (row) => (
        <span>
          <span className="block font-medium text-slate-900">
            {row.blood_bank_name}
          </span>
          <span className="text-xs text-slate-500">
            #{row.blood_bank_id} · {row.bank_status}
          </span>
        </span>
      ),
    },
    { key: "blood_group", header: "Group", render: groupCell },
    {
      key: "unit_status",
      header: "Unit status",
      render: (row) => <StatusBadge value={row.unit_status} />,
    },
    {
      key: "unit_count",
      header: "Units",
      align: "right",
      render: countCell("unit_count"),
    },
    {
      key: "usable_available_count",
      header: "Usable available",
      align: "right",
      render: (row) => (
        <span className="tabular-nums font-semibold text-emerald-700">
          {formatNumber(row.usable_available_count)}
        </span>
      ),
    },
    {
      key: "active_reservation_count",
      header: "Active holds",
      align: "right",
      render: countCell("active_reservation_count"),
    },
    {
      key: "earliest_expiry_date",
      header: "Earliest expiry",
      render: (row) => formatDate(row.earliest_expiry_date),
    },
    {
      key: "latest_expiry_date",
      header: "Latest expiry",
      render: (row) => formatDate(row.latest_expiry_date),
    },
    {
      key: "expiring_within_7_days",
      header: "Expiring ≤ 7d",
      align: "right",
      render: (row) => (
        <span
          className={`tabular-nums font-semibold ${
            row.expiring_within_7_days > 0 ? "text-amber-700" : "text-slate-400"
          }`}
        >
          {formatNumber(row.expiring_within_7_days)}
        </span>
      ),
    },
  ],

  "expiring-units": [
    {
      key: "blood_unit_id",
      header: "Unit",
      render: (row) => (
        <Link
          to={`/blood-units/${row.blood_unit_id}`}
          className="font-medium text-navy-800 hover:underline"
        >
          #{row.blood_unit_id}
        </Link>
      ),
    },
    { key: "blood_group", header: "Group", render: groupCell },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge value={row.status} />,
    },
    { key: "current_blood_bank_name", header: "Held at" },
    {
      key: "collection_date",
      header: "Collected",
      render: (row) => formatDate(row.collection_date),
    },
    {
      key: "expiry_date",
      header: "Expiry",
      render: (row) => formatDate(row.expiry_date),
    },
    {
      key: "days_to_expiry",
      header: "Days left",
      align: "right",
      render: (row) => {
        const days = row.days_to_expiry;
        if (days === null || days === undefined) return DASH;
        const tone =
          days < 0
            ? "text-red-700"
            : days <= 7
              ? "text-amber-700"
              : "text-slate-700";
        return (
          <span className={`tabular-nums font-semibold ${tone}`}>{days}</span>
        );
      },
    },
  ],

  "emergency-summary": [
    {
      key: "hospital_name",
      header: "Hospital",
      render: (row) => (
        <span className="font-medium text-slate-900">{row.hospital_name}</span>
      ),
    },
    {
      key: "request_type",
      header: "Type",
      render: (row) => <StatusBadge value={row.request_type} tone="blue" />,
    },
    {
      key: "priority",
      header: "Priority",
      render: (row) => <StatusBadge value={row.priority} />,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge value={row.status} />,
    },
    {
      key: "request_count",
      header: "Requests",
      align: "right",
      render: countCell("request_count"),
    },
  ],

  "donation-trends": [
    {
      key: "month",
      header: "Month",
      render: (row) => (
        <span className="font-medium text-slate-900">
          {monthLabel(row.month)}
        </span>
      ),
    },
    {
      key: "donation_type",
      header: "Type",
      render: (row) => <StatusBadge value={row.donation_type} tone="blue" />,
    },
    {
      key: "donation_count",
      header: "Donations",
      align: "right",
      render: countCell("donation_count"),
    },
  ],

  reservations: [
    {
      key: "blood_bank_name",
      header: "Blood bank",
      render: (row) => (
        <span>
          <span className="block font-medium text-slate-900">
            {row.blood_bank_name}
          </span>
          <span className="text-xs text-slate-500">#{row.blood_bank_id}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge value={row.status} />,
    },
    {
      key: "reservation_count",
      header: "Reservations",
      align: "right",
      render: countCell("reservation_count"),
    },
  ],

  "organ-matches": [
    {
      key: "candidate_rank",
      header: "Rank",
      render: (row) => (
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-navy-800 text-xs font-semibold text-white">
          {row.candidate_rank}
        </span>
      ),
    },
    {
      key: "organ_unit_id",
      header: "Organ unit",
      render: (row) => (
        <Link
          to={`/organs/${row.organ_unit_id}`}
          className="font-medium text-navy-800 hover:underline"
        >
          #{row.organ_unit_id}
        </Link>
      ),
    },
    {
      key: "organ_type",
      header: "Organ",
      render: (row) => (
        <span className="font-semibold text-navy-800">
          {row.organ_type || DASH}
        </span>
      ),
    },
    {
      key: "recipient_name",
      header: "Candidate",
      render: (row) => (
        <span>
          <span className="block font-medium text-slate-900">
            {row.recipient_name || DASH}
          </span>
          <span className="text-xs text-slate-500">{row.hospital_name}</span>
        </span>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      render: (row) =>
        row.priority ? <StatusBadge value={row.priority} /> : DASH,
    },
    {
      key: "compatibility_score",
      header: "Compat. (0.50)",
      align: "right",
      render: (row) => (
        <span className="tabular-nums text-slate-700">
          {formatScore(row.compatibility_score)}
        </span>
      ),
    },
    {
      key: "urgency_score",
      header: "Urgency (0.30)",
      align: "right",
      render: (row) => (
        <span className="tabular-nums text-slate-700">
          {formatScore(row.urgency_score)}
        </span>
      ),
    },
    {
      key: "waiting_time_score",
      header: "Waiting (0.20)",
      align: "right",
      render: (row) => (
        <span className="tabular-nums text-slate-700">
          {formatScore(row.waiting_time_score)}
        </span>
      ),
    },
    {
      key: "academic_priority_score",
      header: "Academic Priority Score",
      align: "right",
      render: (row) => (
        <span className="tabular-nums font-semibold text-slate-900">
          {formatScore(row.academic_priority_score)}
        </span>
      ),
    },
    {
      key: "match_status",
      header: "Match status",
      render: (row) => <StatusBadge value={row.match_status} />,
    },
    {
      key: "calculated_at",
      header: "Scored",
      render: (row) => formatDateTime(row.calculated_at),
    },
  ],

  "hospital-response-time": [
    {
      key: "hospital_name",
      header: "Hospital",
      render: (row) => (
        <span>
          <span className="block font-medium text-slate-900">
            {row.hospital_name}
          </span>
          <span className="text-xs text-slate-500">#{row.hospital_id}</span>
        </span>
      ),
    },
    {
      key: "reserved_request_count",
      header: "Requests reserved",
      align: "right",
      render: countCell("reserved_request_count"),
    },
    {
      key: "average_response_minutes",
      header: "Avg. response (min)",
      align: "right",
      render: (row) =>
        row.average_response_minutes === null ||
        row.average_response_minutes === undefined ? (
          DASH
        ) : (
          <span className="tabular-nums font-semibold text-slate-900">
            {formatScore(row.average_response_minutes)}
          </span>
        ),
    },
  ],
};

const ROW_KEYS = {
  "blood-inventory": (row) =>
    `${row.blood_bank_id}-${row.blood_group}-${row.unit_status}`,
  "expiring-units": (row) => row.blood_unit_id,
  "emergency-summary": (row) =>
    `${row.hospital_id}-${row.request_type}-${row.priority}-${row.status}`,
  "donation-trends": (row) => `${row.month}-${row.donation_type}`,
  reservations: (row) => `${row.blood_bank_id}-${row.status}`,
  "organ-matches": (row) => row.match_id,
  "hospital-response-time": (row) => row.hospital_id,
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function monthLabel(value) {
  if (!value) return DASH;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

/** Sum `valueKey` grouped by `groupKey`, preserving first-seen order. */
function sumBy(rows, groupKey, valueKey) {
  const totals = new Map();
  for (const row of rows) {
    const name = row[groupKey];
    totals.set(name, (totals.get(name) || 0) + Number(row[valueKey] || 0));
  }
  return [...totals].map(([name, value]) => ({ name, value }));
}

/* -------------------------------------------------------------------------- */
/* Charts                                                                     */
/* -------------------------------------------------------------------------- */

function SimpleBarChart({ data, label, colour = "#dc2626" }) {
  return (
    <div className="h-72 w-full px-2 py-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="name"
            tick={AXIS_TICK}
            interval={0}
            angle={data.length > 6 ? -25 : 0}
            textAnchor={data.length > 6 ? "end" : "middle"}
            height={data.length > 6 ? 64 : 30}
          />
          <YAxis allowDecimals={false} tick={AXIS_TICK} />
          <Tooltip cursor={{ fill: "#f1f5f9" }} formatter={(v) => [v, label]} />
          <Bar dataKey="value" name={label} fill={colour} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function DonationTrendChart({ data }) {
  return (
    <div className="h-72 w-full px-2 py-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} />
          <YAxis allowDecimals={false} tick={AXIS_TICK} />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="BLOOD"
            name="Blood"
            stroke="#dc2626"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="ORGAN"
            name="Organ"
            stroke="#16203a"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Pivot the trend rows to one record per month with a BLOOD and ORGAN series. */
function trendSeries(rows) {
  const byMonth = new Map();
  for (const row of rows) {
    const key = row.month;
    if (!byMonth.has(key)) {
      byMonth.set(key, { month: key, label: monthLabel(key), BLOOD: 0, ORGAN: 0 });
    }
    byMonth.get(key)[row.donation_type] = Number(row.donation_count || 0);
  }
  return [...byMonth.values()].sort((a, b) =>
    String(a.month).localeCompare(String(b.month)),
  );
}

/**
 * Build the chart for a report, or return null when there isn't a useful one.
 *
 * This is a plain function rather than a component on purpose: a component
 * would always produce a truthy element even when it renders nothing, and the
 * caller needs a real null so it can skip the surrounding panel entirely. A
 * single category is not a comparison, so anything under two points is skipped.
 */
function buildChart(slug, rows) {
  if (!rows.length) return null;

  if (slug === "donation-trends") {
    const data = trendSeries(rows);
    return data.length >= 2 ? <DonationTrendChart data={data} /> : null;
  }

  const bar = (data, label, colour) =>
    data.length >= 2 ? (
      <SimpleBarChart data={data} label={label} colour={colour} />
    ) : null;

  if (slug === "blood-inventory") {
    return bar(sumBy(rows, "blood_group", "unit_count"), "Units", CHART_COLOURS[0]);
  }
  if (slug === "emergency-summary") {
    return bar(
      sumBy(rows, "priority", "request_count"),
      "Requests",
      CHART_COLOURS[3],
    );
  }
  if (slug === "reservations") {
    return bar(
      sumBy(rows, "status", "reservation_count"),
      "Reservations",
      CHART_COLOURS[2],
    );
  }
  if (slug === "hospital-response-time") {
    // Hospitals with no reservations have a null average and no bar to draw.
    const data = rows
      .filter((row) => row.average_response_minutes !== null)
      .map((row) => ({
        name: row.hospital_name,
        value: Number(row.average_response_minutes),
      }));
    return bar(data, "Avg. minutes", CHART_COLOURS[1]);
  }

  // expiring-units and organ-matches are already ordered lists; a chart of a
  // ranking would just restate the table.
  return null;
}

const CHART_CAPTION = {
  "blood-inventory": "Total units per blood group, summed across banks and statuses.",
  "emergency-summary": "Requests per priority, summed across hospitals and statuses.",
  "donation-trends": "Donations per month, split by type.",
  reservations: "Reservations per status, summed across banks.",
  "hospital-response-time":
    "Average minutes from request to first reservation, per hospital.",
};

/* -------------------------------------------------------------------------- */
/* Inventory filters (only report that takes any)                             */
/* -------------------------------------------------------------------------- */

function InventoryFilters({ values, onChange, onReset, onRefresh }) {
  const banks = useBloodBankOptions({ activeOnly: false });
  return (
    <FilterBar
      filters={[
        {
          key: "blood_bank_id",
          label: "Blood bank",
          type: "select",
          options: banks.options,
          anyLabel: banks.loading ? "Loading…" : "All banks",
          width: "w-56",
        },
        {
          key: "blood_group",
          label: "Blood group",
          type: "select",
          options: BLOOD_GROUPS,
          width: "w-32",
        },
        {
          key: "status",
          label: "Unit status",
          type: "select",
          options: BLOOD_UNIT_STATUSES,
          width: "w-44",
        },
      ]}
      values={values}
      onChange={onChange}
      onReset={onReset}
      onRefresh={onRefresh}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function ReportDetailPage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const report = reportBySlug(slug);
  const fetcher = REPORT_FETCHERS[slug];

  const [filters, setFilters] = useState({});
  const filterKey = JSON.stringify(filters);

  const allowed = Boolean(report) && report.roles.includes(user?.role);

  const { data, loading, error, reload } = useApi(
    () => {
      const params = {};
      for (const [key, value] of Object.entries(filters)) {
        if (value !== "" && value !== null && value !== undefined) {
          params[key] = value;
        }
      }
      return fetcher(Object.keys(params).length ? params : undefined);
    },
    [slug, filterKey],
    { enabled: allowed && Boolean(fetcher) },
  );

  const rows = Array.isArray(data) ? data : [];
  const columns = COLUMNS[slug] || [];

  /* Unknown slug -------------------------------------------------------- */
  if (!report || !fetcher) {
    return (
      <div>
        <PageHeader
          title="Report not found"
          icon={BarChart3}
          backTo="/reports"
          backLabel="Reports"
        />
        <Callout tone="warning">
          There is no report called <span className="font-mono">{slug}</span>.
          Pick one from the{" "}
          <Link to="/reports" className="font-semibold underline">
            report gallery
          </Link>
          .
        </Callout>
      </div>
    );
  }

  const Icon = iconFor(report.icon);

  /* Not permitted for this role ----------------------------------------- */
  if (!allowed) {
    return (
      <div>
        <PageHeader
          title={report.title}
          icon={Icon}
          backTo="/reports"
          backLabel="Reports"
        />
        <Callout tone="warning" title="Not available to your role">
          This report is restricted to{" "}
          {report.roles.map((role) => role.replaceAll("_", " ").toLowerCase()).join(" and ")}
          . The backend enforces the same rule, so requesting it directly would
          also be refused.
        </Callout>
      </div>
    );
  }

  const chart = buildChart(slug, rows);

  return (
    <div>
      <PageHeader
        title={report.title}
        description={report.summary}
        icon={Icon}
        backTo="/reports"
        backLabel="Reports"
        actions={
          <Button
            variant="secondary"
            icon={Download}
            disabled={!rows.length}
            onClick={() => downloadCsv(slug, rows)}
          >
            Export CSV
          </Button>
        }
      />

      <Callout tone="neutral" className="mb-5">
        <span className="font-semibold">Source:</span>{" "}
        <span className="font-mono text-xs">{report.source}</span>
        <span className="mt-1 block">{report.sourceNote}</span>
      </Callout>

      {slug === "organ-matches" ? (
        <Callout tone="neutral" className="mb-5">
          {ORGAN_SCORE_NOTE}
        </Callout>
      ) : null}

      {error ? <ErrorState error={error} onRetry={reload} /> : null}

      {chart ? (
        <Section
          title="At a glance"
          description={CHART_CAPTION[slug]}
          className="mb-5"
        >
          {chart}
        </Section>
      ) : null}

      <Section
        title="Rows"
        description={
          loading
            ? "Loading…"
            : `${formatNumber(rows.length)} row${rows.length === 1 ? "" : "s"} returned by the database.`
        }
        className="overflow-hidden"
      >
        {report.filterable ? (
          <InventoryFilters
            values={filters}
            onChange={(key, value) =>
              setFilters((prev) => ({ ...prev, [key]: value }))
            }
            onReset={() => setFilters({})}
            onRefresh={reload}
          />
        ) : null}

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={ROW_KEYS[slug] || ((row, index) => index)}
          loading={loading}
          error={null}
          onRetry={reload}
          emptyTitle="No rows"
          emptyMessage={
            report.filterable
              ? "No rows match these filters. Try widening them."
              : "The database returned no rows for this report yet."
          }
          emptyIcon={BarChart3}
        />
      </Section>
    </div>
  );
}
