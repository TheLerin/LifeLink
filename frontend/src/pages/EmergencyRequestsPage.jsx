/**
 * EmergencyRequestsPage - the emergency request queue.
 *
 * Readable by ADMIN, DOCTOR, both bank roles and RECIPIENT; the backend narrows
 * the rows each role sees (a recipient sees only their own). Only ADMIN and
 * DOCTOR may raise a request.
 *
 * The create form mirrors EmergencyRequestCreateRequest's conditional validation
 * exactly: a BLOOD request needs blood_group and units_required and must not
 * carry organ_type, while an ORGAN request needs organ_type and must not carry
 * the blood fields. Sending the wrong combination is a 422, so the form swaps
 * the fields rather than showing all of them.
 *
 * requested_by is the doctor raising the request. A DOCTOR omits it (the backend
 * uses their own person_id and rejects any other id); an ADMIN must choose one,
 * and the hospital is then derived from that doctor server-side.
 *
 * Server-side filters: request_type, priority, status (aliased).
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/Layout.jsx";
import { Section, Callout } from "../components/States.jsx";
import DataTable from "../components/DataTable.jsx";
import FilterBar from "../components/FilterBar.jsx";
import Pagination from "../components/Pagination.jsx";
import Modal from "../components/Modal.jsx";
import Button from "../components/Button.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import {
  FormGrid,
  SelectField,
  TextField,
  TextAreaField,
} from "../components/FormFields.jsx";
import { endpoints } from "../api/endpoints.js";
import { usePagedList, useMutation } from "../hooks/useApi.js";
import { useRecipientOptions, useDoctorOptions } from "../hooks/useLookups.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import {
  BLOOD_GROUPS,
  REQUEST_PRIORITIES,
  REQUEST_STATUSES,
  REQUEST_TYPES,
  ROLES,
} from "../constants/lifelink.js";
import { AlertTriangle, Plus } from "../components/icons.js";
import { formatDateTime, DASH } from "../utils/format.js";

function RequestForm({ onClose, onCreated }) {
  const toast = useToast();
  const { user } = useAuth();
  const isDoctor = user?.role === ROLES.DOCTOR;
  const isAdmin = user?.role === ROLES.ADMIN;

  const recipients = useRecipientOptions({ enabled: true });
  // The doctors list is ADMIN-only, so a DOCTOR must not fetch it.
  const doctors = useDoctorOptions({ enabled: isAdmin });

  const { run, pending, error } = useMutation(endpoints.emergencyRequests.create);

  const [form, setForm] = useState({
    recipient_id: "",
    requested_by: "",
    request_type: "BLOOD",
    blood_group: "",
    organ_type: "",
    units_required: "1",
    priority: "HIGH",
    notes: "",
  });

  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));
  const fieldErrors = error?.fieldErrors ? error.fieldErrors() : {};
  const isBlood = form.request_type === "BLOOD";

  async function handleSubmit(event) {
    event.preventDefault();

    const payload = {
      recipient_id: Number(form.recipient_id),
      request_type: form.request_type,
      priority: form.priority,
    };

    // A doctor may only act as itself, so requested_by is left off entirely.
    if (!isDoctor && form.requested_by) {
      payload.requested_by = Number(form.requested_by);
    }

    if (isBlood) {
      payload.blood_group = form.blood_group;
      payload.units_required = Number(form.units_required);
    } else {
      payload.organ_type = form.organ_type.trim();
    }

    const notes = form.notes.trim();
    if (notes) payload.notes = notes;

    try {
      const created = await run(payload);
      toast.success(
        `Request #${created.request_id} raised for ${created.recipient_name}.`,
        "Emergency request created",
      );
      onCreated(created);
    } catch {
      /* surfaced below */
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Raise emergency request"
      description="The request starts as PENDING. Blood is allocated separately, by reserving against it."
      size="lg"
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="request-form" loading={pending}>
            Raise request
          </Button>
        </>
      }
    >
      <form id="request-form" onSubmit={handleSubmit} className="space-y-5">
        <FormGrid columns={2}>
          <SelectField
            name="recipient_id"
            label="Recipient"
            value={form.recipient_id}
            onChange={set("recipient_id")}
            options={recipients.options}
            placeholder={
              recipients.loading ? "Loading recipients…" : "Select recipient"
            }
            error={fieldErrors.recipient_id}
            disabled={recipients.loading}
            required
          />

          {isDoctor ? null : (
            <SelectField
              name="requested_by"
              label="Requesting doctor"
              value={form.requested_by}
              onChange={set("requested_by")}
              options={doctors.options}
              placeholder={doctors.loading ? "Loading doctors…" : "Select doctor"}
              error={fieldErrors.requested_by}
              hint="The hospital is taken from this doctor's posting."
              disabled={doctors.loading}
              required
            />
          )}

          <SelectField
            name="request_type"
            label="Request type"
            value={form.request_type}
            onChange={set("request_type")}
            options={REQUEST_TYPES}
            error={fieldErrors.request_type}
            placeholder="Select type"
            required
          />
          <SelectField
            name="priority"
            label="Priority"
            value={form.priority}
            onChange={set("priority")}
            options={REQUEST_PRIORITIES}
            error={fieldErrors.priority}
            placeholder="Select priority"
            required
          />

          {isBlood ? (
            <>
              <SelectField
                name="blood_group"
                label="Blood group required"
                value={form.blood_group}
                onChange={set("blood_group")}
                options={BLOOD_GROUPS}
                error={fieldErrors.blood_group}
                placeholder="Select blood group"
                required
              />
              <TextField
                name="units_required"
                label="Units required"
                type="number"
                value={form.units_required}
                onChange={set("units_required")}
                error={fieldErrors.units_required}
                hint="1 to 20 units."
                min="1"
                max="20"
                required
              />
            </>
          ) : (
            <TextField
              name="organ_type"
              label="Organ required"
              value={form.organ_type}
              onChange={set("organ_type")}
              error={fieldErrors.organ_type}
              placeholder="KIDNEY, LIVER…"
              maxLength={50}
              required
            />
          )}
        </FormGrid>

        <TextAreaField
          name="notes"
          label="Clinical notes (optional)"
          value={form.notes}
          onChange={set("notes")}
          error={fieldErrors.notes}
          maxLength={1000}
          rows={2}
        />

        {isDoctor ? (
          <Callout tone="neutral">
            This request will be recorded under your own doctor record and your
            hospital.
          </Callout>
        ) : null}

        {error && !Object.keys(fieldErrors).length ? (
          <Callout tone="danger">{error.message}</Callout>
        ) : null}
      </form>
    </Modal>
  );
}

/** Blood progress as allocated/required; organs have no unit count. */
function FulfilmentCell({ row }) {
  if (row.request_type !== "BLOOD") {
    return row.selected_organ_unit_id
      ? `Organ unit #${row.selected_organ_unit_id}`
      : DASH;
  }

  const required = row.units_required ?? 0;
  const allocated = row.allocated_units ?? 0;
  const complete = required > 0 && allocated >= required;

  return (
    <span
      className={`tabular-nums ${complete ? "font-semibold text-emerald-700" : "text-slate-700"}`}
    >
      {allocated}/{required}
    </span>
  );
}

export default function EmergencyRequestsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);

  const role = user?.role;
  const canCreate = role === ROLES.ADMIN || role === ROLES.DOCTOR;

  const list = usePagedList((params) => endpoints.emergencyRequests.list(params), {
    pageSize: 20,
  });

  const columns = [
    {
      key: "request_id",
      header: "ID",
      render: (row) => (
        <span className="font-medium text-slate-900">#{row.request_id}</span>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      render: (row) => <StatusBadge value={row.priority} />,
    },
    {
      key: "request_type",
      header: "Type",
      render: (row) => <StatusBadge value={row.request_type} tone="blue" />,
    },
    {
      key: "needs",
      header: "Needs",
      render: (row) =>
        row.request_type === "BLOOD" ? (
          <span>
            <span className="font-bold text-blood-700">
              {row.requested_blood_group}
            </span>
            <span className="text-slate-600">
              {" "}
              · {row.units_required} unit{row.units_required === 1 ? "" : "s"}
            </span>
          </span>
        ) : (
          <span className="text-slate-800">{row.requested_organ_type}</span>
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
          <span className="text-xs text-slate-500">
            {row.recipient_blood_group}
          </span>
        </span>
      ),
    },
    { key: "hospital_name", header: "Hospital" },
    {
      key: "doctor_name",
      header: "Raised by",
      render: (row) => row.doctor_name,
    },
    {
      key: "requested_at",
      header: "Raised",
      render: (row) => formatDateTime(row.requested_at),
    },
    {
      key: "fulfilment",
      header: "Allocated",
      align: "right",
      render: (row) => <FulfilmentCell row={row} />,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge value={row.status} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Emergency requests"
        description="Blood and organ requests raised by hospitals, newest activity first."
        icon={AlertTriangle}
        actions={
          canCreate ? (
            <Button icon={Plus} onClick={() => setCreateOpen(true)}>
              Raise request
            </Button>
          ) : null
        }
      />

      <Section className="overflow-hidden">
        <FilterBar
          filters={[
            {
              key: "request_type",
              label: "Type",
              type: "select",
              options: REQUEST_TYPES,
              width: "w-36",
            },
            {
              key: "priority",
              label: "Priority",
              type: "select",
              options: REQUEST_PRIORITIES,
              width: "w-40",
            },
            {
              key: "status",
              label: "Status",
              type: "select",
              options: REQUEST_STATUSES,
              width: "w-48",
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
          rowKey={(row) => row.request_id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          onRowClick={(row) => navigate(`/emergency-requests/${row.request_id}`)}
          emptyTitle="No emergency requests"
          emptyMessage={
            canCreate
              ? "Raise a request to begin allocating blood or organs."
              : "No requests match your filters."
          }
          emptyIcon={AlertTriangle}
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
        <RequestForm
          onClose={() => setCreateOpen(false)}
          onCreated={(created) => {
            setCreateOpen(false);
            navigate(`/emergency-requests/${created.request_id}`);
          }}
        />
      ) : null}
    </div>
  );
}
