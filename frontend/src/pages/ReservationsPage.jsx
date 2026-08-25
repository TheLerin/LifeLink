/**
 * ReservationsPage - the blood-reservation ledger (ADMIN, DOCTOR, blood-bank
 * staff and RECIPIENT; the backend narrows a recipient to their own).
 *
 * A reservation is created only by the atomic reserve endpoint, never here. What
 * this page adds is the two lifecycle actions the database exposes for an ACTIVE
 * reservation:
 *
 *   - Issue  -> POST /reservations/{id}/issue   (unit becomes ISSUED, reservation COMPLETED)
 *   - Cancel -> POST /reservations/{id}/cancel  (unit returns to AVAILABLE/EXPIRED, reservation CANCELLED)
 *
 * Both are ADMIN + BLOOD_BANK_STAFF only, send no body, and are guarded again in
 * the service (issue needs status ACTIVE and unit RESERVED; cancel needs status
 * ACTIVE) so the UI is a convenience over the real rule, not the rule itself.
 *
 * Server-side filter: status (aliased from reservation_status).
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/Layout.jsx";
import { Section, Callout } from "../components/States.jsx";
import DataTable from "../components/DataTable.jsx";
import FilterBar from "../components/FilterBar.jsx";
import Pagination from "../components/Pagination.jsx";
import Button from "../components/Button.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { endpoints } from "../api/endpoints.js";
import { usePagedList, useMutation } from "../hooks/useApi.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { RESERVATION_STATUSES, ROLES } from "../constants/lifelink.js";
import { ClipboardCheck } from "../components/icons.js";
import { formatDateTime, DASH } from "../utils/format.js";

/** Countdown-style hint: how long until an ACTIVE hold lapses. */
function ExpiryHint({ row }) {
  if (row.status !== "ACTIVE" || !row.expires_at) return null;
  const ms = new Date(row.expires_at).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) {
    return <span className="text-xs font-medium text-red-700">hold lapsed</span>;
  }
  const minutes = Math.round(ms / 60000);
  const label =
    minutes >= 60
      ? `${Math.floor(minutes / 60)}h ${minutes % 60}m left`
      : `${minutes}m left`;
  const tone = minutes <= 15 ? "text-amber-700" : "text-slate-500";
  return <span className={`text-xs font-medium ${tone}`}>{label}</span>;
}

function RowActions({ row, onChanged }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(null); // "cancel" | "issue" | null

  const cancel = useMutation(() =>
    endpoints.reservations.cancel(row.reservation_id),
  );
  const issue = useMutation(() =>
    endpoints.reservations.issue(row.reservation_id),
  );
  const active = confirm === "cancel" ? cancel : issue;

  if (row.status !== "ACTIVE") {
    return <span className="text-xs text-slate-400">No action</span>;
  }

  async function apply() {
    try {
      await active.run();
      toast.success(
        confirm === "cancel"
          ? `Reservation #${row.reservation_id} cancelled; the unit returns to stock.`
          : `Reservation #${row.reservation_id} issued; unit #${row.blood_unit_id} is now ISSUED.`,
        confirm === "cancel" ? "Reservation cancelled" : "Unit issued",
      );
      setConfirm(null);
      onChanged();
    } catch {
      /* surfaced in the dialog */
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Button size="sm" variant="success" onClick={() => setConfirm("issue")}>
        Issue
      </Button>
      <Button size="sm" variant="danger" onClick={() => setConfirm("cancel")}>
        Cancel
      </Button>

      {confirm ? (
        <ConfirmDialog
          open
          title={
            confirm === "cancel"
              ? "Cancel this reservation?"
              : "Issue this reserved unit?"
          }
          message={
            confirm === "cancel"
              ? "The reservation is voided and its unit returns to AVAILABLE (or EXPIRED if the unit has since lapsed). The request's allocation count is recomputed."
              : "The unit is dispensed: the reservation completes and the unit becomes ISSUED. This cannot be undone from the UI."
          }
          confirmLabel={
            confirm === "cancel" ? "Cancel reservation" : "Issue unit"
          }
          confirmVariant={confirm === "cancel" ? "danger" : "primary"}
          busy={active.pending}
          error={active.error}
          onConfirm={apply}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}

export default function ReservationsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role;
  const canManage = role === ROLES.ADMIN || role === ROLES.BLOOD_BANK_STAFF;

  const list = usePagedList((params) => endpoints.reservations.list(params), {
    pageSize: 20,
  });

  const columns = [
    {
      key: "reservation_id",
      header: "ID",
      render: (row) => (
        <span className="font-medium text-slate-900">#{row.reservation_id}</span>
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
      key: "blood_unit_id",
      header: "Unit",
      render: (row) => (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            navigate(`/blood-units/${row.blood_unit_id}`);
          }}
          className="font-medium text-navy-800 hover:underline"
        >
          #{row.blood_unit_id}
        </button>
      ),
    },
    {
      key: "request_id",
      header: "Request",
      render: (row) => (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            navigate(`/emergency-requests/${row.request_id}`);
          }}
          className="font-medium text-navy-800 hover:underline"
        >
          #{row.request_id}
        </button>
      ),
    },
    {
      key: "recipient_name",
      header: "Recipient",
      render: (row) => (
        <span>
          <span className="block font-medium text-slate-900">
            {row.recipient_name}
          </span>
          <span className="text-xs text-slate-500">{row.hospital_name}</span>
        </span>
      ),
    },
    {
      key: "blood_bank_name",
      header: "Held at",
      render: (row) => row.blood_bank_name || DASH,
    },
    {
      key: "reserved_at",
      header: "Reserved",
      render: (row) => formatDateTime(row.reserved_at),
    },
    {
      key: "expires_at",
      header: "Hold",
      render: (row) =>
        row.expires_at ? (
          <span className="block">
            <span className="block text-sm text-slate-700">
              {formatDateTime(row.expires_at)}
            </span>
            <ExpiryHint row={row} />
          </span>
        ) : (
          DASH
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge value={row.status} />,
    },
  ];

  if (canManage) {
    columns.push({
      key: "actions",
      header: "",
      align: "right",
      render: (row) => <RowActions row={row} onChanged={list.reload} />,
    });
  }

  return (
    <div>
      <PageHeader
        title="Blood reservations"
        description="Every unit held against an emergency request, newest first. Reservations are created only through the atomic reserve action."
        icon={ClipboardCheck}
      />

      <Callout tone="neutral" className="mb-5">
        A reservation is never created on this screen. It exists because an
        emergency request reserved a unit server-side. Here you can issue an
        ACTIVE hold (dispensing the unit) or cancel it (returning the unit to
        stock) - both writes are validated and audited by the database.
      </Callout>

      <Section className="overflow-hidden">
        <FilterBar
          filters={[
            {
              key: "status",
              label: "Status",
              type: "select",
              options: RESERVATION_STATUSES,
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
          rowKey={(row) => row.reservation_id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          emptyTitle="No reservations found"
          emptyMessage="Adjust your filters. Reservations appear here once blood is reserved against an emergency request."
          emptyIcon={ClipboardCheck}
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
