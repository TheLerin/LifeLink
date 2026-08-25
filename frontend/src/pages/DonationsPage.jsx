/**
 * DonationsPage - the donation register (blood and organ).
 *
 * Readable by ADMIN, both bank roles and DONOR (a donor sees only their own,
 * enforced by the backend). Creating a donation is restricted: blood-bank staff
 * record blood, organ-bank staff record organs, ADMIN can record either.
 * Server-side filters: donation_type and record_status.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/Layout.jsx";
import { Section } from "../components/States.jsx";
import DataTable from "../components/DataTable.jsx";
import FilterBar from "../components/FilterBar.jsx";
import Pagination from "../components/Pagination.jsx";
import Button from "../components/Button.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import DonationForm from "./DonationForm.jsx";
import { endpoints } from "../api/endpoints.js";
import { usePagedList } from "../hooks/useApi.js";
import { useAuth } from "../context/AuthContext.jsx";
import {
  DONATION_TYPES,
  DONATION_RECORD_STATUSES,
  ROLES,
} from "../constants/lifelink.js";
import { Plus, Droplet } from "../components/icons.js";
import { formatDate } from "../utils/format.js";

export default function DonationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  const role = user?.role;
  const allowedTypes = [];
  if (role === ROLES.ADMIN) allowedTypes.push("BLOOD", "ORGAN");
  else if (role === ROLES.BLOOD_BANK_STAFF) allowedTypes.push("BLOOD");
  else if (role === ROLES.ORGAN_BANK_STAFF) allowedTypes.push("ORGAN");
  const canCreate = allowedTypes.length > 0;

  // Only link through to a unit the caller is actually allowed to open, so a
  // donor never clicks a row into a 403.
  const canOpenBloodUnit =
    role === ROLES.ADMIN || role === ROLES.BLOOD_BANK_STAFF;
  const canOpenOrganUnit =
    role === ROLES.ADMIN || role === ROLES.ORGAN_BANK_STAFF;

  function unitLink(row) {
    if (!row.unit_id) return null;
    if (row.donation_type === "BLOOD") {
      return canOpenBloodUnit ? `/blood-units/${row.unit_id}` : null;
    }
    return canOpenOrganUnit ? `/organs/${row.unit_id}` : null;
  }

  const list = usePagedList((params) => endpoints.donations.list(params), {
    pageSize: 20,
  });

  const columns = [
    {
      key: "donation_id",
      header: "ID",
      render: (row) => (
        <span className="font-medium text-slate-900">#{row.donation_id}</span>
      ),
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
      key: "donor_name",
      header: "Donor",
      render: (row) => (
        <span className="font-medium text-slate-900">{row.donor_name}</span>
      ),
    },
    { key: "collection_bank_name", header: "Collected at" },
    {
      key: "unit",
      header: "Unit",
      render: (row) => `${row.unit_type} #${row.unit_id}`,
    },
    {
      key: "unit_status",
      header: "Unit status",
      render: (row) => <StatusBadge value={row.unit_status} />,
    },
    {
      key: "quantity_collected_ml",
      header: "Volume",
      align: "right",
      render: (row) =>
        row.quantity_collected_ml ? `${row.quantity_collected_ml} mL` : "—",
    },
    {
      key: "record_status",
      header: "Record",
      render: (row) => <StatusBadge value={row.record_status} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Donations"
        description="Every blood and organ donation recorded in the system."
        icon={Droplet}
        actions={
          canCreate ? (
            <Button icon={Plus} onClick={() => setCreateOpen(true)}>
              Record donation
            </Button>
          ) : null
        }
      />

      <Section className="overflow-hidden">
        <FilterBar
          filters={[
            {
              key: "donation_type",
              label: "Type",
              type: "select",
              options: DONATION_TYPES,
            },
            {
              key: "record_status",
              label: "Record status",
              type: "select",
              options: DONATION_RECORD_STATUSES,
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
          rowKey={(row) => row.donation_id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          onRowClick={(row) => {
            const to = unitLink(row);
            if (to) navigate(to);
          }}
          emptyTitle="No donations recorded"
          emptyMessage={
            canCreate
              ? "Record the first donation to create a unit."
              : "No donations match your filters."
          }
          emptyIcon={Droplet}
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

      {createOpen && canCreate ? (
        <DonationForm
          allowedTypes={allowedTypes}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            list.reload();
          }}
        />
      ) : null}
    </div>
  );
}
