/**
 * OrgansPage - the organ-unit inventory (ADMIN and organ-bank staff only).
 *
 * Organs are not reserved with the FEFO blood workflow. Each unit is allocated
 * through transparent academic matching: candidate recipients are scored and
 * ranked on the unit detail page. This list is the entry point to that.
 *
 * There is no "add unit" action here, exactly as with blood: an organ unit only
 * exists by registering an organ donation (POST /donations/organ), which writes
 * the donation, the unit and the audit row together.
 *
 * Server-side filters: organ_type (free text) and status (aliased from
 * unit_status).
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
import { ORGAN_UNIT_STATUSES } from "../constants/lifelink.js";
import { Activity } from "../components/icons.js";
import { formatDate, formatDateTime } from "../utils/format.js";

export default function OrgansPage() {
  const navigate = useNavigate();

  const list = usePagedList((params) => endpoints.organs.list(params), {
    pageSize: 20,
  });

  const columns = [
    {
      key: "organ_unit_id",
      header: "Unit",
      render: (row) => (
        <span className="font-medium text-slate-900">#{row.organ_unit_id}</span>
      ),
    },
    {
      key: "organ_type",
      header: "Organ",
      render: (row) => (
        <span className="inline-flex items-center rounded bg-navy-50 px-2 py-0.5 text-sm font-semibold text-navy-800">
          {row.organ_type}
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
        <span>
          <span className="block text-slate-800">{row.donor_name}</span>
          <span className="text-xs text-slate-500">#{row.donor_id}</span>
        </span>
      ),
    },
    { key: "current_organ_bank_name", header: "Held at" },
    {
      key: "donation_date",
      header: "Donated",
      render: (row) => formatDate(row.donation_date),
    },
    {
      key: "created_at",
      header: "Recorded",
      render: (row) => formatDateTime(row.created_at),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Organ inventory"
        description="Organ units held across the network. Allocation is by transparent academic matching, opened from each unit."
        icon={Activity}
      />

      <Callout tone="neutral" className="mb-5">
        Organ allocation does not use blood's FEFO reservation. Open a unit to
        score candidate recipients by their Academic Priority Score - an
        educational ranking (0.50 compatibility + 0.30 urgency + 0.20 waiting
        time), never clinical transplant guidance. Units are created by
        registering an organ donation, not from this screen.
      </Callout>

      <Section className="overflow-hidden">
        <FilterBar
          filters={[
            {
              key: "organ_type",
              label: "Organ type",
              type: "search",
              placeholder: "KIDNEY, LIVER…",
              width: "w-48",
            },
            {
              key: "status",
              label: "Status",
              type: "select",
              options: ORGAN_UNIT_STATUSES,
              width: "w-44",
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
          rowKey={(row) => row.organ_unit_id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          onRowClick={(row) => navigate(`/organs/${row.organ_unit_id}`)}
          emptyTitle="No organ units found"
          emptyMessage="Adjust your filters. Units appear here once an organ donation is registered."
          emptyIcon={Activity}
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
