/**
 * BloodUnitsPage - blood inventory (ADMIN and blood-bank staff only).
 *
 * This is the stock ledger the emergency reservation flow draws from. Units are
 * shown with their days-to-expiry because allocation is FEFO (first-expiry,
 * first-out): the unit closest to expiry is the one the database picks when a
 * reservation is made, so expiry is the column that actually drives behaviour.
 *
 * Server-side filters: blood_group, status (aliased from unit_status) and
 * blood_bank_id.
 *
 * Note there is no "add unit" action here by design. A blood unit only comes
 * into existence by registering a donation (POST /donations/blood), which is
 * what writes the donation row, the unit row and the audit entry together.
 */

import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/Layout.jsx";
import { Section, Callout } from "../components/States.jsx";
import DataTable from "../components/DataTable.jsx";
import FilterBar from "../components/FilterBar.jsx";
import Pagination from "../components/Pagination.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { endpoints } from "../api/endpoints.js";
import { usePagedList } from "../hooks/useApi.js";
import { useBloodBankOptions } from "../hooks/useLookups.js";
import {
  BLOOD_GROUPS,
  BLOOD_UNIT_STATUSES,
} from "../constants/lifelink.js";
import { Droplets, CheckCircle2, XCircle, Clock } from "../components/icons.js";
import { formatDate, DASH } from "../utils/format.js";

/** Days-to-expiry, coloured so a unit about to lapse stands out in a long list. */
function ExpiryCell({ row }) {
  const days = row.days_to_expiry;
  if (days === null || days === undefined) return DASH;

  const tone =
    days < 0
      ? "text-red-700"
      : days <= 7
        ? "text-amber-700"
        : "text-slate-600";

  const label =
    days < 0
      ? `expired ${Math.abs(days)}d ago`
      : days === 0
        ? "expires today"
        : `${days}d left`;

  return (
    <span className="block">
      <span className="block text-sm text-slate-800">
        {formatDate(row.expiry_date)}
      </span>
      <span className={`text-xs font-medium ${tone}`}>{label}</span>
    </span>
  );
}

/** Screening summary: count of tests plus whether every one of them passed. */
function ScreeningCell({ row }) {
  const count = row.screening_test_count ?? 0;
  if (count === 0) {
    return <span className="text-xs text-slate-400">No tests</span>;
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {row.all_tests_passed === true ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
      ) : row.all_tests_passed === false ? (
        <XCircle className="h-4 w-4 text-red-600" aria-hidden="true" />
      ) : (
        <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" />
      )}
      <span className="text-sm tabular-nums text-slate-700">
        {count} test{count === 1 ? "" : "s"}
      </span>
    </span>
  );
}

export default function BloodUnitsPage() {
  const navigate = useNavigate();
  const banks = useBloodBankOptions({ activeOnly: false });

  const list = usePagedList((params) => endpoints.bloodUnits.list(params), {
    pageSize: 20,
  });

  const columns = [
    {
      key: "blood_unit_id",
      header: "Unit",
      render: (row) => (
        <span className="font-medium text-slate-900">#{row.blood_unit_id}</span>
      ),
    },
    {
      key: "blood_group",
      header: "Group",
      render: (row) => (
        <span className="inline-flex items-center rounded bg-blood-50 px-2 py-0.5 text-sm font-bold text-blood-700">
          {row.blood_group}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge value={row.status} />,
    },
    {
      key: "donor_name",
      header: "Donor",
      render: (row) => (
        <span className="text-slate-800">{row.donor_name}</span>
      ),
    },
    { key: "current_blood_bank_name", header: "Held at" },
    {
      key: "collection_date",
      header: "Collected",
      render: (row) => formatDate(row.collection_date),
    },
    {
      key: "expiry",
      header: "Expiry",
      render: (row) => <ExpiryCell row={row} />,
    },
    {
      key: "screening",
      header: "Screening",
      render: (row) => <ScreeningCell row={row} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Blood inventory"
        description="Every blood unit held across the network, with the expiry that determines allocation order."
        icon={Droplets}
      />

      <Callout tone="neutral" className="mb-5">
        Allocation is first-expiry-first-out. A unit is never moved to RESERVED
        from this screen - reserving happens through an emergency request, so
        PostgreSQL can lock the row, pick the correct unit and write the audit
        entry in a single transaction.
      </Callout>

      <Section className="overflow-hidden">
        <FilterBar
          filters={[
            {
              key: "blood_group",
              label: "Blood group",
              type: "select",
              options: BLOOD_GROUPS,
              width: "w-32",
            },
            {
              key: "status",
              label: "Status",
              type: "select",
              options: BLOOD_UNIT_STATUSES,
              width: "w-44",
            },
            {
              key: "blood_bank_id",
              label: "Blood bank",
              type: "select",
              options: banks.options,
              anyLabel: banks.loading ? "Loading…" : "All banks",
              width: "w-56",
            },
          ]}
          values={list.filters}
          onChange={list.setFilter}
          onReset={list.resetFilters}
          onRefresh={list.reload}
        />

        <DataTable
          columns={columns}
          rows={list.items}
          rowKey={(row) => row.blood_unit_id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          onRowClick={(row) => navigate(`/blood-units/${row.blood_unit_id}`)}
          emptyTitle="No blood units found"
          emptyMessage="Adjust your filters. Units appear here once a blood donation is registered."
          emptyIcon={Droplets}
          footer={
            <Pagination
              page={list.page}
              pageSize={list.pageSize}
              total={list.total}
              totalPages={list.totalPages}
              onPageChange={list.setPage}
              onPageSizeChange={list.setPageSize}
            />
          }
        />
      </Section>
    </div>
  );
}
