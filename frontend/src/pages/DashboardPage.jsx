/**
 * DashboardPage - the landing screen, tailored per role.
 *
 * Rather than one dashboard with permission holes in it, each role gets a panel
 * assembled from endpoints that role can actually call. Admin and blood-bank
 * staff get inventory charts; doctors get their emergency queue; donors and
 * recipients get their own record. Every number is fetched live - nothing here
 * is hardcoded.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useAuth } from "../context/AuthContext.jsx";
import { endpoints } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";
import { ROLES, ROLE_LABELS } from "../constants/lifelink.js";
import { PageHeader, StatCard, DetailList } from "../components/Layout.jsx";
import { AsyncPanel, Callout, LoadingState, Section } from "../components/States.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import DataTable from "../components/DataTable.jsx";
import Button from "../components/Button.jsx";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  Clock,
  Droplet,
  Droplets,
  HeartHandshake,
  LayoutDashboard,
  Plus,
  ClipboardCheck,
  TrendingUp,
  UserRound,
} from "../components/icons.js";
import {
  daysUntil,
  formatDate,
  formatNumber,
  formatShortDateTime,
} from "../utils/format.js";
import { formatAddress } from "../components/AddressFields.jsx";

/** Consistent chart colours, aligned with the status palette. */
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

const BLOOD_GROUP_ORDER = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

function ChartFrame({ title, description, children, height = 260, actions }) {
  return (
    <Section title={title} description={description} actions={actions}>
      <div className="px-2 py-4" style={{ height }}>
        {children}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * Admin + blood bank staff: inventory and emergency posture
 * ------------------------------------------------------------------ */

function InventoryDashboard({ user }) {
  const isAdmin = user.role === ROLES.ADMIN;

  const inventory = useApi(() => endpoints.reports.bloodInventory(), []);
  const expiring = useApi(() => endpoints.reports.expiringUnits(), []);
  const requests = useApi(
    () => endpoints.emergencyRequests.list({ page_size: 100 }),
    [],
  );
  const reservations = useApi(
    () => endpoints.reservations.list({ status: "ACTIVE", page_size: 100 }),
    [],
  );

  const rows = useMemo(
    () => (Array.isArray(inventory.data) ? inventory.data : []),
    [inventory.data],
  );

  // Units that can actually be given out right now.
  const availableUnits = useMemo(
    () =>
      rows
        .filter((row) => row.unit_status === "AVAILABLE")
        .reduce((sum, row) => sum + (row.unit_count || 0), 0),
    [rows],
  );

  const reservedUnits = useMemo(
    () =>
      rows
        .filter((row) => row.unit_status === "RESERVED")
        .reduce((sum, row) => sum + (row.unit_count || 0), 0),
    [rows],
  );

  const expiringSoon = useMemo(
    () =>
      rows.reduce((sum, row) => sum + (row.expiring_within_7_days || 0), 0),
    [rows],
  );

  // Available stock per blood group - the single most useful chart here.
  const byGroup = useMemo(() => {
    const totals = new Map(BLOOD_GROUP_ORDER.map((group) => [group, 0]));
    for (const row of rows) {
      if (row.unit_status !== "AVAILABLE") continue;
      totals.set(row.blood_group, (totals.get(row.blood_group) || 0) + row.unit_count);
    }
    return BLOOD_GROUP_ORDER.map((group) => ({
      group,
      units: totals.get(group) || 0,
    }));
  }, [rows]);

  // Whole-inventory status mix, so wastage is visible next to usable stock.
  const byStatus = useMemo(() => {
    const totals = new Map();
    for (const row of rows) {
      totals.set(row.unit_status, (totals.get(row.unit_status) || 0) + row.unit_count);
    }
    return [...totals.entries()]
      .map(([status, units]) => ({ status, units }))
      .sort((a, b) => b.units - a.units);
  }, [rows]);

  const openRequests = useMemo(() => {
    const items = requests.data?.items || [];
    return items.filter((item) =>
      ["PENDING", "PARTIALLY_RESERVED"].includes(item.status),
    );
  }, [requests.data]);

  const criticalOpen = openRequests.filter(
    (item) => item.priority === "CRITICAL",
  ).length;

  const loadingAny = inventory.loading || requests.loading;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Available units"
          value={availableUnits}
          hint="Ready to reserve"
          icon={Droplets}
          accent="green"
          loading={inventory.loading}
          to="/blood-units?status=AVAILABLE"
        />
        <StatCard
          label="Reserved units"
          value={reservedUnits}
          hint="Held against a request"
          icon={ClipboardCheck}
          accent="orange"
          loading={inventory.loading}
          to="/reservations"
        />
        <StatCard
          label="Open requests"
          value={openRequests.length}
          hint={
            criticalOpen > 0
              ? `${criticalOpen} critical`
              : "Pending or partly reserved"
          }
          icon={AlertTriangle}
          accent={criticalOpen > 0 ? "blood" : "amber"}
          loading={requests.loading}
          to="/emergency-requests"
        />
        <StatCard
          label="Expiring in 7 days"
          value={expiringSoon}
          hint="Use before they are wasted"
          icon={Clock}
          accent={expiringSoon > 0 ? "amber" : "slate"}
          loading={inventory.loading}
          to="/reports/expiring-units"
        />
      </div>

      {inventory.error ? (
        <Callout tone="danger" title="Inventory could not be loaded">
          {inventory.error.message}
        </Callout>
      ) : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartFrame
          title="Available stock by blood group"
          description="Units currently AVAILABLE across every blood bank you can see."
        >
          {loadingAny ? (
            <LoadingState label="Loading inventory…" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byGroup} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="group" tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#64748b" }} />
                <Tooltip
                  cursor={{ fill: "#f1f5f9" }}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(value) => [`${value} units`, "Available"]}
                />
                <Bar dataKey="units" fill="#dc2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartFrame>

        <ChartFrame
          title="Inventory by status"
          description="Where every unit currently sits in the lifecycle."
        >
          {loadingAny ? (
            <LoadingState label="Loading inventory…" />
          ) : byStatus.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              No units recorded yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={byStatus}
                  dataKey="units"
                  nameKey="status"
                  innerRadius={50}
                  outerRadius={85}
                  paddingAngle={2}
                >
                  {byStatus.map((entry, index) => (
                    <Cell
                      key={entry.status}
                      fill={CHART_COLOURS[index % CHART_COLOURS.length]}
                    />
                  ))}
                </Pie>
                <Legend
                  verticalAlign="middle"
                  align="right"
                  layout="vertical"
                  wrapperStyle={{ fontSize: 12 }}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(value, name) => [`${value} units`, name]}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartFrame>
      </div>

      <Section
        title="Open emergency requests"
        description="Requests still waiting on blood or an organ."
        actions={
          <Link to="/emergency-requests">
            <Button variant="secondary" size="sm">
              View all
            </Button>
          </Link>
        }
      >
        <DataTable
          columns={[
            { key: "request_id", header: "ID", render: (row) => `#${row.request_id}` },
            { key: "hospital_name", header: "Hospital" },
            { key: "recipient_name", header: "Recipient" },
            {
              key: "need",
              header: "Needs",
              render: (row) =>
                row.request_type === "BLOOD"
                  ? `${row.units_required ?? "?"} × ${row.requested_blood_group ?? ""}`
                  : row.requested_organ_type,
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
              key: "requested_at",
              header: "Raised",
              render: (row) => formatShortDateTime(row.requested_at),
            },
          ]}
          rows={openRequests.slice(0, 8)}
          rowKey={(row) => row.request_id}
          loading={requests.loading}
          error={requests.error}
          onRetry={requests.reload}
          emptyTitle="No open requests"
          emptyMessage="Every emergency request has been reserved, completed or cancelled."
          emptyIcon={AlertTriangle}
        />
      </Section>

      <Section
        title="Units nearing expiry"
        description="Oldest first — reserve these before newer stock."
        actions={
          <Link to="/reports/expiring-units">
            <Button variant="secondary" size="sm">
              Full report
            </Button>
          </Link>
        }
      >
        <DataTable
          columns={[
            {
              key: "blood_unit_id",
              header: "Unit",
              render: (row) => (
                <Link
                  to={`/blood-units/${row.blood_unit_id}`}
                  className="font-medium text-blood-700 hover:underline"
                >
                  #{row.blood_unit_id}
                </Link>
              ),
              stopPropagation: true,
            },
            { key: "blood_group", header: "Group" },
            { key: "current_blood_bank_name", header: "Blood bank" },
            {
              key: "expiry_date",
              header: "Expires",
              render: (row) => formatDate(row.expiry_date),
            },
            {
              key: "days_to_expiry",
              header: "Days left",
              align: "right",
              render: (row) => {
                const days = row.days_to_expiry ?? daysUntil(row.expiry_date);
                const tone =
                  days <= 2 ? "text-red-700" : days <= 7 ? "text-amber-700" : "text-slate-700";
                return <span className={`font-semibold ${tone}`}>{days}</span>;
              },
            },
            {
              key: "status",
              header: "Status",
              render: (row) => <StatusBadge value={row.status} />,
            },
          ]}
          rows={(expiring.data || []).slice(0, 8)}
          rowKey={(row) => row.blood_unit_id}
          loading={expiring.loading}
          error={expiring.error}
          onRetry={expiring.reload}
          emptyTitle="Nothing expiring soon"
          emptyMessage="No available units are close to their expiry date."
          emptyIcon={Clock}
        />
      </Section>

      {isAdmin ? <DonationTrendPanel /> : null}
    </div>
  );
}

/** Admin-only: donation volume over time. */
function DonationTrendPanel() {
  const trends = useApi(() => endpoints.reports.donationTrends(), []);

  const series = useMemo(() => {
    const rows = Array.isArray(trends.data) ? trends.data : [];
    const byMonth = new Map();
    for (const row of rows) {
      const key = row.month;
      if (!byMonth.has(key)) byMonth.set(key, { month: key, BLOOD: 0, ORGAN: 0 });
      byMonth.get(key)[row.donation_type] = row.donation_count;
    }
    return [...byMonth.values()]
      .sort((a, b) => String(a.month).localeCompare(String(b.month)))
      .map((row) => ({
        ...row,
        label: new Date(row.month).toLocaleDateString(undefined, {
          month: "short",
          year: "2-digit",
        }),
      }));
  }, [trends.data]);

  return (
    <ChartFrame
      title="Donation trends"
      description="Blood and organ donations recorded each month."
      actions={
        <Link to="/reports/donation-trends">
          <Button variant="secondary" size="sm">
            Full report
          </Button>
        </Link>
      }
    >
      {trends.loading ? (
        <LoadingState label="Loading trends…" />
      ) : series.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-slate-500">
          No donations recorded yet.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 5, right: 20, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#64748b" }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#64748b" }} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
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
      )}
    </ChartFrame>
  );
}

/* ------------------------------------------------------------------ *
 * Doctor: the requests they raised
 * ------------------------------------------------------------------ */

function DoctorDashboard() {
  const requests = useApi(
    () => endpoints.emergencyRequests.list({ page_size: 100 }),
    [],
  );

  const items = requests.data?.items || [];
  const open = items.filter((item) =>
    ["PENDING", "PARTIALLY_RESERVED"].includes(item.status),
  );
  const reserved = items.filter((item) =>
    ["RESERVED", "MATCHED"].includes(item.status),
  );
  const completed = items.filter((item) => item.status === "COMPLETED");

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Awaiting allocation"
          value={open.length}
          hint="Pending or partly reserved"
          icon={AlertTriangle}
          accent="amber"
          loading={requests.loading}
        />
        <StatCard
          label="Reserved / matched"
          value={reserved.length}
          hint="Blood or organ secured"
          icon={ClipboardCheck}
          accent="orange"
          loading={requests.loading}
        />
        <StatCard
          label="Completed"
          value={completed.length}
          hint="Fulfilled requests"
          icon={Activity}
          accent="green"
          loading={requests.loading}
        />
      </div>

      <Section
        title="Your emergency requests"
        description="Requests raised for your patients, newest first."
        actions={
          <Link to="/emergency-requests">
            <Button size="sm" icon={Plus}>
              New request
            </Button>
          </Link>
        }
      >
        <DataTable
          columns={[
            { key: "request_id", header: "ID", render: (row) => `#${row.request_id}` },
            { key: "recipient_name", header: "Recipient" },
            {
              key: "need",
              header: "Needs",
              render: (row) =>
                row.request_type === "BLOOD"
                  ? `${row.units_required ?? "?"} × ${row.requested_blood_group ?? ""}`
                  : row.requested_organ_type,
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
              key: "allocated",
              header: "Allocated",
              align: "right",
              render: (row) =>
                row.request_type === "BLOOD"
                  ? `${row.allocated_units ?? 0}/${row.units_required ?? 0}`
                  : "—",
            },
            {
              key: "requested_at",
              header: "Raised",
              render: (row) => formatShortDateTime(row.requested_at),
            },
          ]}
          rows={items.slice(0, 10)}
          rowKey={(row) => row.request_id}
          loading={requests.loading}
          error={requests.error}
          onRetry={requests.reload}
          emptyTitle="No requests yet"
          emptyMessage="Raise an emergency request when a patient needs blood or an organ."
          emptyIcon={AlertTriangle}
        />
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Organ bank staff: units and matching
 * ------------------------------------------------------------------ */

function OrganBankDashboard() {
  const organs = useApi(() => endpoints.organs.list({ page_size: 100 }), []);
  const items = organs.data?.items || [];

  const counts = useMemo(() => {
    const totals = new Map();
    for (const item of items) {
      totals.set(item.status, (totals.get(item.status) || 0) + 1);
    }
    return totals;
  }, [items]);

  const byType = useMemo(() => {
    const totals = new Map();
    for (const item of items) {
      totals.set(item.organ_type, (totals.get(item.organ_type) || 0) + 1);
    }
    return [...totals.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [items]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Available organs"
          value={counts.get("AVAILABLE") || 0}
          hint="Ready for matching"
          icon={Activity}
          accent="green"
          loading={organs.loading}
          to="/organs?status=AVAILABLE"
        />
        <StatCard
          label="In matching"
          value={counts.get("MATCHING") || 0}
          hint="Candidates ranked"
          icon={TrendingUp}
          accent="blue"
          loading={organs.loading}
          to="/organs?status=MATCHING"
        />
        <StatCard
          label="Allocated"
          value={counts.get("ALLOCATED") || 0}
          hint="Recipient selected"
          icon={ClipboardCheck}
          accent="orange"
          loading={organs.loading}
          to="/organs?status=ALLOCATED"
        />
        <StatCard
          label="Total units"
          value={items.length}
          hint="All organ units on record"
          icon={Droplet}
          accent="navy"
          loading={organs.loading}
          to="/organs"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartFrame
          title="Organ units by type"
          description="What is currently held across your organ bank."
        >
          {organs.loading ? (
            <LoadingState label="Loading organ units…" />
          ) : byType.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              No organ units recorded yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={byType}
                layout="vertical"
                margin={{ top: 5, right: 20, left: 20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis
                  type="category"
                  dataKey="type"
                  width={90}
                  tick={{ fontSize: 12, fill: "#64748b" }}
                />
                <Tooltip
                  cursor={{ fill: "#f1f5f9" }}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(value) => [`${value} units`, "Count"]}
                />
                <Bar dataKey="count" fill="#16203a" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartFrame>

        <Section
          title="Recent organ units"
          description="Newest units first."
          actions={
            <Link to="/organs">
              <Button variant="secondary" size="sm">
                View all
              </Button>
            </Link>
          }
        >
          <DataTable
            columns={[
              {
                key: "organ_unit_id",
                header: "Unit",
                render: (row) => `#${row.organ_unit_id}`,
              },
              { key: "organ_type", header: "Type" },
              { key: "donor_name", header: "Donor" },
              {
                key: "status",
                header: "Status",
                render: (row) => <StatusBadge value={row.status} />,
              },
              {
                key: "donation_date",
                header: "Donated",
                render: (row) => formatDate(row.donation_date),
              },
            ]}
            rows={items.slice(0, 8)}
            rowKey={(row) => row.organ_unit_id}
            loading={organs.loading}
            error={organs.error}
            onRetry={organs.reload}
            emptyTitle="No organ units"
            emptyMessage="Register an organ donation to begin matching."
            emptyIcon={Activity}
          />
        </Section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Donor: their own record
 * ------------------------------------------------------------------ */

function DonorDashboard({ user }) {
  const donorId = user.person_id;
  const enabled = Boolean(donorId);

  const donor = useApi(() => endpoints.donors.get(donorId), [donorId], { enabled });
  const donations = useApi(
    () => endpoints.donors.donations(donorId, { page_size: 20 }),
    [donorId],
    { enabled },
  );
  const camps = useApi(() => endpoints.camps.list({ status: "SCHEDULED" }), []);

  if (!enabled) {
    return (
      <Callout tone="warning" title="No donor record linked">
        Your account isn’t linked to a donor record yet. An administrator can
        connect it from the user accounts screen.
      </Callout>
    );
  }

  const record = donor.data;
  const donationItems = donations.data?.items || [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Blood group"
          value={record?.blood_group}
          hint="On your donor record"
          icon={Droplets}
          accent="blood"
          loading={donor.loading}
        />
        <StatCard
          label="Donations"
          value={donations.data?.total ?? donationItems.length}
          hint="Recorded lifetime total"
          icon={HeartHandshake}
          accent="green"
          loading={donations.loading}
        />
        <StatCard
          label="Last donation"
          value={
            record?.last_blood_donation_date
              ? formatDate(record.last_blood_donation_date)
              : "None yet"
          }
          icon={CalendarDays}
          accent="navy"
          loading={donor.loading}
        />
        <StatCard
          label="Eligibility (demo)"
          value={record?.is_eligible_demo ? "Eligible" : "Not eligible"}
          hint="Simplified academic rule"
          icon={Activity}
          accent={record?.is_eligible_demo ? "green" : "slate"}
          loading={donor.loading}
        />
      </div>

      <Callout tone="neutral">
        The eligibility flag uses a simplified academic rule (age, weight, and
        time since the last donation). It is not medical clearance — a real
        screening happens at the donation centre.
      </Callout>

      <Section
        title="Your donation history"
        description="Every donation recorded against your donor record."
        actions={
          <Link to={`/donors/${donorId}`}>
            <Button variant="secondary" size="sm">
              Full profile
            </Button>
          </Link>
        }
      >
        <DataTable
          columns={[
            {
              key: "donation_id",
              header: "ID",
              render: (row) => `#${row.donation_id}`,
            },
            {
              key: "donation_date",
              header: "Date",
              render: (row) => formatDate(row.donation_date),
            },
            {
              key: "donation_type",
              header: "Type",
              render: (row) => <StatusBadge value={row.donation_type} tone="blue" />,
            },
            {
              key: "where",
              header: "Collected at",
              render: (row) =>
                row.collection_bank_name || row.collection_organ_bank_name || "—",
            },
            {
              key: "quantity_collected_ml",
              header: "Volume",
              align: "right",
              render: (row) =>
                row.quantity_collected_ml ? `${row.quantity_collected_ml} mL` : "—",
            },
            {
              key: "unit_status",
              header: "Unit status",
              render: (row) =>
                row.unit_status ? <StatusBadge value={row.unit_status} /> : "—",
            },
          ]}
          rows={donationItems}
          rowKey={(row) => row.donation_id}
          loading={donations.loading}
          error={donations.error}
          onRetry={donations.reload}
          emptyTitle="No donations recorded yet"
          emptyMessage="Once you donate, each donation and the unit it produced appears here."
          emptyIcon={HeartHandshake}
        />
      </Section>

      <Section
        title="Upcoming donation camps"
        description="Scheduled camps you could register for."
        actions={
          <Link to="/camps">
            <Button variant="secondary" size="sm">
              View camps
            </Button>
          </Link>
        }
      >
        <DataTable
          columns={[
            {
              key: "camp_date",
              header: "Date",
              render: (row) => formatDate(row.camp_date),
            },
            { key: "organizer", header: "Organiser" },
            {
              key: "location",
              header: "Location",
              render: (row) =>
                [row.address?.city, row.address?.district]
                  .filter(Boolean)
                  .join(", "),
            },
            {
              key: "registration_count",
              header: "Registered",
              align: "right",
              render: (row) => formatNumber(row.registration_count),
            },
          ]}
          rows={(camps.data || []).slice(0, 5)}
          rowKey={(row) => row.camp_id}
          loading={camps.loading}
          error={camps.error}
          onRetry={camps.reload}
          emptyTitle="No camps scheduled"
          emptyMessage="Check back later — new camps appear here once scheduled."
          emptyIcon={CalendarDays}
        />
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Recipient: their own requests
 * ------------------------------------------------------------------ */

function RecipientDashboard({ user }) {
  const recipientId = user.person_id;
  const enabled = Boolean(recipientId);

  const recipient = useApi(
    () => endpoints.recipients.get(recipientId),
    [recipientId],
    { enabled },
  );
  const requests = useApi(
    () => endpoints.recipients.requests(recipientId, { page_size: 50 }),
    [recipientId],
    { enabled },
  );

  if (!enabled) {
    return (
      <Callout tone="warning" title="No recipient record linked">
        Your account isn’t linked to a recipient record yet. An administrator can
        connect it from the user accounts screen.
      </Callout>
    );
  }

  const record = recipient.data;
  const items = requests.data?.items || [];
  const open = items.filter((item) =>
    ["PENDING", "PARTIALLY_RESERVED"].includes(item.status),
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Blood group"
          value={record?.blood_group}
          icon={Droplets}
          accent="blood"
          loading={recipient.loading}
        />
        <StatCard
          label="Open requests"
          value={open.length}
          hint="Awaiting allocation"
          icon={AlertTriangle}
          accent={open.length > 0 ? "amber" : "slate"}
          loading={requests.loading}
        />
        <StatCard
          label="Total requests"
          value={requests.data?.total ?? items.length}
          hint="Raised on your behalf"
          icon={ClipboardCheck}
          accent="navy"
          loading={requests.loading}
        />
      </div>

      <AsyncPanel loading={recipient.loading} error={recipient.error} isEmpty={false}>
        {record ? (
          <Section title="Your record">
            <div className="px-4 py-4">
              <DetailList
                items={[
                  { label: "Name", value: record.full_name },
                  { label: "Blood group", value: record.blood_group },
                  { label: "Age", value: `${record.age_years} years` },
                  {
                    label: "Status",
                    value: <StatusBadge value={record.status} />,
                  },
                  {
                    label: "Address",
                    value: formatAddress(record.address),
                    span: true,
                  },
                ]}
              />
            </div>
          </Section>
        ) : null}
      </AsyncPanel>

      <Section
        title="Requests raised for you"
        description="Emergency requests your doctor has raised, newest first."
      >
        <DataTable
          columns={[
            { key: "request_id", header: "ID", render: (row) => `#${row.request_id}` },
            { key: "hospital_name", header: "Hospital" },
            { key: "doctor_name", header: "Doctor" },
            {
              key: "need",
              header: "Needs",
              render: (row) =>
                row.request_type === "BLOOD"
                  ? `${row.units_required ?? "?"} × ${row.requested_blood_group ?? ""}`
                  : row.requested_organ_type,
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
              key: "requested_at",
              header: "Raised",
              render: (row) => formatShortDateTime(row.requested_at),
            },
          ]}
          rows={items}
          rowKey={(row) => row.request_id}
          loading={requests.loading}
          error={requests.error}
          onRetry={requests.reload}
          emptyTitle="No requests yet"
          emptyMessage="When a doctor raises an emergency request for you, it appears here."
          emptyIcon={AlertTriangle}
        />
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;

  const descriptions = {
    ADMIN: "System-wide view of inventory, emergencies and donation activity.",
    BLOOD_BANK_STAFF: "Your blood bank's stock, reservations and expiring units.",
    ORGAN_BANK_STAFF: "Organ units held by your bank and their matching progress.",
    DOCTOR: "Emergency requests you have raised and their allocation status.",
    DONOR: "Your donation history, eligibility and upcoming camps.",
    RECIPIENT: "Requests raised on your behalf and their current status.",
  };

  let panel;
  switch (user.role) {
    case ROLES.ADMIN:
    case ROLES.BLOOD_BANK_STAFF:
      panel = <InventoryDashboard user={user} />;
      break;
    case ROLES.DOCTOR:
      panel = <DoctorDashboard user={user} />;
      break;
    case ROLES.ORGAN_BANK_STAFF:
      panel = <OrganBankDashboard user={user} />;
      break;
    case ROLES.DONOR:
      panel = <DonorDashboard user={user} />;
      break;
    case ROLES.RECIPIENT:
      panel = <RecipientDashboard user={user} />;
      break;
    default:
      panel = null;
  }

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user.full_name || user.username}`}
        description={descriptions[user.role] || ROLE_LABELS[user.role]}
        icon={LayoutDashboard}
      />
      {panel}
    </div>
  );
}
