/**
 * EmergencyRequestDetailPage - one emergency request and, for blood, the
 * allocation workflow that is the heart of this project.
 *
 * The single most important rule in the blueprint lives on this page: the
 * frontend NEVER sets a blood unit to RESERVED. The "Reserve best unit" action
 * calls POST /api/emergency-requests/{id}/reserve, and PostgreSQL's
 * reserve_emergency_blood() function does everything atomically inside one
 * transaction:
 *
 *   - row-locks the request (FOR UPDATE) so two staff cannot over-allocate it,
 *   - picks the exact-ABO/Rh, screened, in-scope unit with the EARLIEST expiry
 *     that is still valid for the whole hold window (FEFO), locking it too,
 *   - inserts the ACTIVE reservation, flips the unit AVAILABLE -> RESERVED,
 *     recomputes the request status, and writes the audit row -
 *   all or nothing. If anything changes underneath it, the whole call rolls
 *   back and the UI shows the database's own error.
 *
 * The reservations list here is narrowed CLIENT-SIDE from /reservations: that
 * endpoint filters by status only, not by request_id. A request needs at most
 * 20 units, so one page of 100 always covers it; the UI says so plainly.
 */

import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { PageHeader, DetailList } from "../components/Layout.jsx";
import {
  AsyncPanel,
  Section,
  Callout,
  ErrorState,
} from "../components/States.jsx";
import DataTable from "../components/DataTable.jsx";
import Button from "../components/Button.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { TextField, TextAreaField } from "../components/FormFields.jsx";
import { endpoints } from "../api/endpoints.js";
import { useApi, useMutation } from "../hooks/useApi.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { ROLES } from "../constants/lifelink.js";
import {
  AlertTriangle,
  Droplets,
  ClipboardCheck,
  Activity,
  Ban,
} from "../components/icons.js";
import { formatDateTime, formatEnum, DASH } from "../utils/format.js";

/* -------------------------------------------------------------------------- */
/* Reserve action                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The reserve dialog only asks for the hold duration. It never chooses a unit -
 * the database does that with FEFO under a row lock. That is why there is no
 * unit picker here: offering one would let the frontend make the allocation
 * decision, which the blueprint forbids.
 */
function ReserveDialog({ request, onClose, onReserved }) {
  const toast = useToast();
  const { run, pending, error } = useMutation((holdMinutes) =>
    endpoints.emergencyRequests.reserve(request.request_id, holdMinutes),
  );
  const [holdMinutes, setHoldMinutes] = useState("120");
  const fieldErrors = error?.fieldErrors ? error.fieldErrors() : {};

  async function handleSubmit(event) {
    event.preventDefault();
    try {
      const reservation = await run(Number(holdMinutes));
      toast.success(
        `Unit #${reservation.blood_unit_id} (${reservation.blood_group}) reserved for request #${request.request_id}.`,
        "Blood reserved",
      );
      onReserved();
    } catch {
      /* surfaced below */
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Reserve best available unit"
      description="PostgreSQL locks the request, picks the first-to-expire matching unit and writes the audit entry in one transaction."
      size="lg"
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="reserve-form" loading={pending}>
            Reserve unit
          </Button>
        </>
      }
    >
      <form id="reserve-form" onSubmit={handleSubmit} className="space-y-5">
        <Callout tone="neutral">
          The unit is chosen server-side by first-expiry-first-out among{" "}
          <span className="font-semibold text-blood-700">
            {request.requested_blood_group}
          </span>{" "}
          units that are AVAILABLE, fully screened and in your scope. This screen
          never sets a unit to RESERVED itself.
        </Callout>

        <TextField
          name="hold_minutes"
          label="Hold duration (minutes)"
          type="number"
          value={holdMinutes}
          onChange={setHoldMinutes}
          error={fieldErrors.hold_minutes}
          hint="Between 5 and 1440 minutes (24 hours). Default 120."
          min="5"
          max="1440"
          required
        />

        {error && !Object.keys(fieldErrors).length ? (
          <Callout tone="danger">
            {error.message}
            {error.requestId ? (
              <span className="mt-1 block font-mono text-xs opacity-80">
                request {error.requestId}
              </span>
            ) : null}
          </Callout>
        ) : null}
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Per-request reservations                                                   */
/* -------------------------------------------------------------------------- */

function ReservationActions({ reservation, onChanged }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(null); // "cancel" | "issue" | null

  const cancel = useMutation(() =>
    endpoints.reservations.cancel(reservation.reservation_id),
  );
  const issue = useMutation(() =>
    endpoints.reservations.issue(reservation.reservation_id),
  );

  if (reservation.status !== "ACTIVE") {
    return <span className="text-xs text-slate-400">No action</span>;
  }

  const active = confirm === "cancel" ? cancel : issue;

  async function apply() {
    try {
      await active.run();
      toast.success(
        confirm === "cancel"
          ? `Reservation #${reservation.reservation_id} cancelled; the unit returns to stock.`
          : `Reservation #${reservation.reservation_id} issued; the unit is now ISSUED.`,
        confirm === "cancel" ? "Reservation cancelled" : "Unit issued",
      );
      setConfirm(null);
      onChanged();
    } catch {
      /* surfaced in the dialog */
    }
  }

  return (
    <div className="flex items-center gap-2">
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
              ? "The reservation is voided and its unit returns to AVAILABLE (or EXPIRED if it has since lapsed)."
              : "The unit is dispensed: the reservation completes and the unit becomes ISSUED. This cannot be undone from the UI."
          }
          confirmLabel={confirm === "cancel" ? "Cancel reservation" : "Issue unit"}
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

function ReservationsSection({ request, canManage, canView }) {
  // /reservations filters by status only, so we pull a page and narrow here.
  const { data, loading, error, reload } = useApi(
    () => endpoints.reservations.list({ page_size: 100 }),
    [],
    { enabled: canView },
  );

  const rows = useMemo(() => {
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.filter((r) => r.request_id === request.request_id);
  }, [data, request.request_id]);

  if (!canView) return null;

  const columns = [
    {
      key: "reservation_id",
      header: "Reservation",
      render: (row) => (
        <span className="font-medium text-slate-900">#{row.reservation_id}</span>
      ),
    },
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
      header: "Hold expires",
      render: (row) => (row.expires_at ? formatDateTime(row.expires_at) : DASH),
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
      render: (row) => (
        <ReservationActions reservation={row} onChanged={reload} />
      ),
    });
  }

  return (
    <Section
      title="Reservations for this request"
      description="Narrowed from the reservations list on the client; a request needs at most 20 units."
      actions={
        <Button size="sm" variant="ghost" onClick={reload}>
          Refresh
        </Button>
      }
      className="mt-5 overflow-hidden"
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.reservation_id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyTitle="No reservations yet"
        emptyMessage={
          canManage
            ? "Reserve a unit to begin fulfilling this request."
            : "No units have been reserved against this request."
        }
        emptyIcon={ClipboardCheck}
      />
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Cancel request                                                             */
/* -------------------------------------------------------------------------- */

function CancelRequestDialog({ request, onClose, onCancelled }) {
  const toast = useToast();
  const { run, pending, error } = useMutation(() =>
    endpoints.emergencyRequests.update(request.request_id, {
      status: "CANCELLED",
    }),
  );

  async function apply() {
    try {
      await run();
      toast.success(
        `Request #${request.request_id} cancelled.`,
        "Request cancelled",
      );
      onCancelled();
    } catch {
      /* surfaced in the dialog */
    }
  }

  return (
    <ConfirmDialog
      open
      title="Cancel this emergency request?"
      message="Only PENDING or PARTIALLY_RESERVED requests can be cancelled here. Allocation endpoints control every other status."
      confirmLabel="Cancel request"
      confirmVariant="danger"
      busy={pending}
      error={error}
      onConfirm={apply}
      onClose={onClose}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Edit priority / notes                                                      */
/* -------------------------------------------------------------------------- */

function EditRequestDialog({ request, onClose, onSaved }) {
  const toast = useToast();
  const { run, pending, error } = useMutation((body) =>
    endpoints.emergencyRequests.update(request.request_id, body),
  );
  const [priority, setPriority] = useState(request.priority);
  const [notes, setNotes] = useState(request.notes || "");
  const fieldErrors = error?.fieldErrors ? error.fieldErrors() : {};

  async function handleSubmit(event) {
    event.preventDefault();
    const body = {};
    if (priority !== request.priority) body.priority = priority;
    const trimmed = notes.trim();
    if (trimmed !== (request.notes || "")) body.notes = trimmed;
    if (!Object.keys(body).length) {
      onClose();
      return;
    }
    try {
      await run(body);
      toast.success(`Request #${request.request_id} updated.`, "Request updated");
      onSaved();
    } catch {
      /* surfaced below */
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit request"
      description="Adjust priority or clinical notes. Status is driven by the allocation workflow, not edited here."
      size="lg"
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="edit-request-form" loading={pending}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-request-form" onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label
            htmlFor="priority"
            className="mb-1.5 block text-sm font-medium text-slate-700"
          >
            Priority
          </label>
          <select
            id="priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            className="ll-input"
          >
            {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((value) => (
              <option key={value} value={value}>
                {formatEnum(value)}
              </option>
            ))}
          </select>
          {fieldErrors.priority ? (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.priority}</p>
          ) : null}
        </div>

        <TextAreaField
          name="notes"
          label="Clinical notes"
          value={notes}
          onChange={setNotes}
          error={fieldErrors.notes}
          maxLength={1000}
          rows={3}
        />

        {error && !Object.keys(fieldErrors).length ? (
          <Callout tone="danger">{error.message}</Callout>
        ) : null}
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function EmergencyRequestDetailPage() {
  const { requestId } = useParams();
  const { user } = useAuth();
  const [reserveOpen, setReserveOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const {
    data: request,
    loading,
    error,
    reload,
  } = useApi(() => endpoints.emergencyRequests.get(requestId), [requestId]);

  const role = user?.role;
  const isBlood = request?.request_type === "BLOOD";

  // Reserve is ADMIN + BLOOD_BANK_STAFF (POST .../reserve is admin_blood).
  const canReserve =
    role === ROLES.ADMIN || role === ROLES.BLOOD_BANK_STAFF;
  // The reservations list is readable by all request roles EXCEPT organ staff.
  const canViewReservations =
    role === ROLES.ADMIN ||
    role === ROLES.DOCTOR ||
    role === ROLES.BLOOD_BANK_STAFF ||
    role === ROLES.RECIPIENT;
  // Cancelling is ADMIN or the requesting doctor (matched by person_id).
  const canCancel =
    request &&
    (role === ROLES.ADMIN ||
      (role === ROLES.DOCTOR && request.doctor_id === user?.person_id));
  const canEdit = canCancel;

  const cancellable =
    request &&
    (request.status === "PENDING" || request.status === "PARTIALLY_RESERVED");
  const reservable = isBlood && cancellable; // same two open statuses

  return (
    <div>
      <PageHeader
        title={request ? `Emergency request #${request.request_id}` : "Emergency request"}
        description={
          request
            ? `${formatEnum(request.request_type)} · ${request.recipient_name} · ${request.hospital_name}`
            : null
        }
        icon={AlertTriangle}
        backTo="/emergency-requests"
        backLabel="Emergency requests"
        actions={
          request ? (
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={request.priority} />
              <StatusBadge value={request.status} />
              {canEdit && cancellable ? (
                <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
                  Edit
                </Button>
              ) : null}
              {canCancel && cancellable ? (
                <Button
                  variant="danger"
                  size="sm"
                  icon={Ban}
                  onClick={() => setCancelOpen(true)}
                >
                  Cancel request
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <AsyncPanel loading={loading} error={null} isEmpty={!request}>
          {request ? (
            <>
              <Section title="Request record">
                <div className="px-4 py-4">
                  <DetailList
                    items={[
                      {
                        label: "Recipient",
                        value: `${request.recipient_name} (#${request.recipient_id})`,
                      },
                      {
                        label: "Recipient blood group",
                        value: (
                          <span className="font-bold text-blood-700">
                            {request.recipient_blood_group}
                          </span>
                        ),
                      },
                      {
                        label: "Type",
                        value: <StatusBadge value={request.request_type} tone="blue" />,
                      },
                      isBlood
                        ? {
                            label: "Blood needed",
                            value: (
                              <span>
                                <span className="font-bold text-blood-700">
                                  {request.requested_blood_group}
                                </span>{" "}
                                · {request.units_required} unit
                                {request.units_required === 1 ? "" : "s"}
                              </span>
                            ),
                          }
                        : {
                            label: "Organ needed",
                            value: request.requested_organ_type,
                          },
                      { label: "Priority", value: <StatusBadge value={request.priority} /> },
                      { label: "Hospital", value: request.hospital_name },
                      {
                        label: "Raised by",
                        value: `${request.doctor_name} (#${request.doctor_id})`,
                      },
                      {
                        label: "Raised at",
                        value: formatDateTime(request.requested_at),
                      },
                      { label: "Status", value: <StatusBadge value={request.status} /> },
                      {
                        label: "Notes",
                        value: request.notes || DASH,
                        span: true,
                      },
                    ]}
                  />
                </div>
              </Section>

              {isBlood ? (
                <Section
                  title="Blood allocation"
                  description="Reservation is atomic and server-side: FEFO selection, row locking and audit happen together in PostgreSQL."
                  actions={
                    canReserve && reservable ? (
                      <Button
                        icon={Droplets}
                        onClick={() => setReserveOpen(true)}
                      >
                        Reserve best unit
                      </Button>
                    ) : null
                  }
                  className="mt-5"
                >
                  <div className="px-4 py-4">
                    <div className="flex flex-wrap items-center gap-6">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Allocated
                        </p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                          {request.allocated_units ?? 0}
                          <span className="text-base font-normal text-slate-400">
                            {" "}
                            / {request.units_required}
                          </span>
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Remaining
                        </p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                          {request.units_remaining ??
                            Math.max(
                              (request.units_required ?? 0) -
                                (request.allocated_units ?? 0),
                              0,
                            )}
                        </p>
                      </div>
                      {request.first_reserved_at ? (
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            First reserved
                          </p>
                          <p className="mt-1 text-sm text-slate-700">
                            {formatDateTime(request.first_reserved_at)}
                          </p>
                        </div>
                      ) : null}
                    </div>

                    {!reservable ? (
                      <Callout tone="neutral" className="mt-4">
                        {request.status === "PENDING" ||
                        request.status === "PARTIALLY_RESERVED"
                          ? "You do not have permission to reserve blood. This is limited to administrators and blood-bank staff."
                          : `No further reservation is possible: the request is ${formatEnum(
                              request.status,
                            )}.`}
                      </Callout>
                    ) : !canReserve ? (
                      <Callout tone="neutral" className="mt-4">
                        Reserving blood is limited to administrators and
                        blood-bank staff.
                      </Callout>
                    ) : null}
                  </div>
                </Section>
              ) : (
                <Section
                  title="Organ allocation"
                  description="Organs are allocated through transparent academic matching, not blood reservation."
                  className="mt-5"
                >
                  <div className="px-4 py-4">
                    {request.selected_organ_unit_id ? (
                      <Callout tone="info">
                        A matched organ unit (#{request.selected_organ_unit_id})
                        is recorded for this request. Manage matches from the{" "}
                        <Link
                          to={`/organs/${request.selected_organ_unit_id}`}
                          className="font-semibold underline"
                        >
                          organ unit page
                        </Link>
                        .
                      </Callout>
                    ) : (
                      <Callout tone="neutral">
                        No organ unit is matched yet. Matching is performed on the
                        Organs page, where candidate recipients are ranked by
                        their Academic Priority Score.
                      </Callout>
                    )}
                  </div>
                </Section>
              )}

              {isBlood ? (
                <ReservationsSection
                  request={request}
                  canManage={canReserve}
                  canView={canViewReservations}
                />
              ) : null}
            </>
          ) : null}
        </AsyncPanel>
      )}

      {reserveOpen && request ? (
        <ReserveDialog
          request={request}
          onClose={() => setReserveOpen(false)}
          onReserved={() => {
            setReserveOpen(false);
            reload();
          }}
        />
      ) : null}

      {cancelOpen && request ? (
        <CancelRequestDialog
          request={request}
          onClose={() => setCancelOpen(false)}
          onCancelled={() => {
            setCancelOpen(false);
            reload();
          }}
        />
      ) : null}

      {editOpen && request ? (
        <EditRequestDialog
          request={request}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}
