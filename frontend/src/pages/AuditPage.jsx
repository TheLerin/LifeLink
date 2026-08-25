/**
 * AuditPage - the audit trail (ADMIN only).
 *
 * Every row here was written by a PL/pgSQL trigger or a service call inside the
 * same transaction as the change it records, which is what makes the trail
 * trustworthy: an application crash cannot leave a change unlogged.
 *
 * Server-side filters: table_name, record_id, action, user_id.
 */

import { PageHeader } from "../components/Layout.jsx";
import { Section, Callout } from "../components/States.jsx";
import DataTable from "../components/DataTable.jsx";
import FilterBar from "../components/FilterBar.jsx";
import Pagination from "../components/Pagination.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { endpoints } from "../api/endpoints.js";
import { usePagedList } from "../hooks/useApi.js";
import { FileText, ArrowRight } from "../components/icons.js";
import { formatDateTime, DASH } from "../utils/format.js";

/**
 * Tables the trail covers, offered as a dropdown instead of free text.
 * These are the exact `table_name` literals the triggers and services write -
 * verified against database/*.sql and backend/app/services/*.py so the filter
 * always matches stored rows.
 */
const AUDIT_TABLES = [
  "blood_unit",
  "blood_reservation",
  "organ_match",
  "emergency_request",
  "donation",
  "donation_registration",
  "medical_test_result",
  "donation_camp",
  "recipient",
  "doctor",
  "donor",
  "user_account",
  "hospital",
  "blood_bank",
  "organ_bank",
];

/**
 * The exact `action` literals emitted by the database triggers, the stored
 * procedures and the service layer. Grouped roughly generic -> domain so the
 * dropdown reads sensibly; every value here is one the backend actually stores.
 */
const AUDIT_ACTIONS = [
  "STATUS_CHANGE",
  "CREATE",
  "UPDATE",
  "INSERT",
  "HOSPITAL_CREATED",
  "BLOOD_BANK_CREATED",
  "ORGAN_BANK_CREATED",
  "RECIPIENT_CREATED",
  "RECIPIENT_UPDATED",
  "DOCTOR_CREATED",
  "DOCTOR_UPDATED",
  "CAMP_CREATED",
  "CAMP_REGISTRATION_CREATED",
  "EMERGENCY_REQUEST_CREATED",
  "EMERGENCY_REQUEST_UPDATED",
  "DONATION_REGISTERED",
  "SCREENING_RESULT_ADDED",
  "RESERVATION_CREATED",
  "RESERVATION_STATUS_CHANGE",
  "RESERVATION_PROGRESS",
  "RESERVATION_EXPIRED",
  "ACADEMIC_MATCH_CALCULATED",
  "ORGAN_MATCH_STATUS_CHANGED",
];

export default function AuditPage() {
  const list = usePagedList((params) => endpoints.audit.list(params), {
    pageSize: 20,
  });

  const columns = [
    {
      key: "audit_id",
      header: "ID",
      render: (row) => (
        <span className="font-mono text-xs text-slate-500">#{row.audit_id}</span>
      ),
    },
    {
      key: "action_time",
      header: "When",
      render: (row) => formatDateTime(row.action_time),
    },
    {
      key: "action",
      header: "Action",
      render: (row) => (
        <span className="font-medium text-slate-900">{row.action}</span>
      ),
    },
    {
      key: "table_name",
      header: "Table",
      render: (row) => (
        <span className="font-mono text-xs text-slate-600">{row.table_name}</span>
      ),
    },
    {
      key: "record_id",
      header: "Record",
      render: (row) => (
        <span className="font-mono text-xs text-slate-600">{row.record_id}</span>
      ),
    },
    {
      key: "transition",
      header: "Status change",
      render: (row) => {
        if (!row.old_status && !row.new_status) return DASH;
        return (
          <span className="inline-flex items-center gap-1.5">
            {row.old_status ? (
              <StatusBadge value={row.old_status} />
            ) : (
              <span className="text-xs text-slate-400">new</span>
            )}
            <ArrowRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            {row.new_status ? <StatusBadge value={row.new_status} /> : DASH}
          </span>
        );
      },
    },
    {
      key: "username",
      header: "By",
      render: (row) =>
        row.username || (row.user_id ? `User #${row.user_id}` : "System"),
    },
    {
      key: "details",
      header: "Details",
      className: "max-w-sm",
      render: (row) =>
        row.details ? (
          <span
            className="block truncate font-mono text-xs text-slate-500"
            title={row.details}
          >
            {row.details}
          </span>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Append-only record of every status change, reservation and account action."
        icon={FileText}
      />

      <Callout tone="neutral" className="mb-5">
        Entries are written inside the same transaction as the change they
        describe, by database triggers and service calls. Nothing in the UI can
        edit or delete them.
      </Callout>

      <Section className="overflow-hidden">
        <FilterBar
          filters={[
            {
              key: "table_name",
              label: "Table",
              type: "select",
              options: AUDIT_TABLES,
              width: "w-52",
            },
            {
              key: "action",
              label: "Action",
              type: "select",
              options: AUDIT_ACTIONS,
              width: "w-44",
            },
            {
              key: "record_id",
              label: "Record id",
              type: "text",
              placeholder: "e.g. 42",
              width: "w-32",
            },
            {
              key: "user_id",
              label: "User id",
              type: "number",
              placeholder: "e.g. 1",
              min: 1,
              width: "w-28",
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
          rowKey={(row) => row.audit_id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          emptyTitle="No audit entries found"
          emptyMessage="Adjust your filters. Entries appear as soon as data changes."
          emptyIcon={FileText}
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
