/**
 * CampsPage - donation camps, plus registration.
 *
 * The list is readable by every signed-in role and returns a plain array with a
 * single server-side filter (`status`). ADMIN may schedule a camp. Registration
 * is open to ADMIN, blood-bank staff and DONOR: a donor omits donor_id and the
 * backend registers the account's own person_id, while staff choose a donor.
 */

import { useMemo, useState } from "react";
import { PageHeader } from "../components/Layout.jsx";
import { Section, Callout } from "../components/States.jsx";
import DataTable from "../components/DataTable.jsx";
import FilterBar from "../components/FilterBar.jsx";
import Modal from "../components/Modal.jsx";
import Button from "../components/Button.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { FormGrid, SelectField, TextField } from "../components/FormFields.jsx";
import AddressFields, {
  EMPTY_ADDRESS,
  addressPayload,
} from "../components/AddressFields.jsx";
import { endpoints } from "../api/endpoints.js";
import { useApi, useMutation } from "../hooks/useApi.js";
import { useDonorOptions } from "../hooks/useLookups.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { CAMP_STATUSES, ROLES } from "../constants/lifelink.js";
import { CalendarDays, Plus, Users } from "../components/icons.js";
import { formatDate } from "../utils/format.js";

function CampForm({ onClose, onCreated }) {
  const toast = useToast();
  const { run, pending, error } = useMutation(endpoints.camps.create);
  const [form, setForm] = useState({
    camp_date: "",
    organizer: "",
    contact_phone: "",
    status: "SCHEDULED",
  });
  const [address, setAddress] = useState(EMPTY_ADDRESS);

  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));
  const fieldErrors = error?.fieldErrors ? error.fieldErrors() : {};

  async function handleSubmit(event) {
    event.preventDefault();
    const payload = {
      address: addressPayload(address),
      camp_date: form.camp_date,
      organizer: form.organizer.trim(),
      status: form.status,
    };
    const phone = form.contact_phone.trim();
    if (phone) payload.contact_phone = phone;

    try {
      const created = await run(payload);
      toast.success(
        `Camp #${created.camp_id} on ${formatDate(created.camp_date)} scheduled.`,
        "Camp created",
      );
      onCreated();
    } catch {
      /* surfaced below */
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New donation camp"
      description="Schedule a camp that donations can be collected against."
      size="lg"
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="camp-form" loading={pending}>
            Create camp
          </Button>
        </>
      }
    >
      <form id="camp-form" onSubmit={handleSubmit} className="space-y-5">
        <FormGrid columns={2}>
          <TextField
            name="organizer"
            label="Organizer"
            value={form.organizer}
            onChange={set("organizer")}
            error={fieldErrors.organizer}
            maxLength={150}
            required
          />
          <TextField
            name="camp_date"
            label="Camp date"
            type="date"
            value={form.camp_date}
            onChange={set("camp_date")}
            error={fieldErrors.camp_date}
            required
          />
          <TextField
            name="contact_phone"
            label="Contact phone"
            value={form.contact_phone}
            onChange={set("contact_phone")}
            error={fieldErrors.contact_phone}
            hint="Optional. Digits, spaces and + ( ) - only."
            maxLength={20}
          />
          <SelectField
            name="status"
            label="Status"
            value={form.status}
            onChange={set("status")}
            options={CAMP_STATUSES}
            error={fieldErrors.status}
            placeholder="Select status"
            required
          />
        </FormGrid>

        <AddressFields
          value={address}
          onChange={setAddress}
          errors={fieldErrors}
          legend="Venue"
        />

        {error && !Object.keys(fieldErrors).length ? (
          <Callout tone="danger">{error.message}</Callout>
        ) : null}
      </form>
    </Modal>
  );
}

function RegisterDialog({ camp, onClose, onDone }) {
  const toast = useToast();
  const { user } = useAuth();
  const isDonor = user?.role === ROLES.DONOR;
  const donors = useDonorOptions({ enabled: !isDonor });
  const [donorId, setDonorId] = useState("");
  const { run, pending, error } = useMutation((id) =>
    endpoints.camps.register(camp.camp_id, id),
  );

  const fieldErrors = error?.fieldErrors ? error.fieldErrors() : {};

  async function handleSubmit(event) {
    event.preventDefault();
    try {
      // A donor omits donor_id entirely; the backend uses their own person_id.
      await run(isDonor ? undefined : Number(donorId));
      toast.success(
        isDonor
          ? `You are registered for the camp on ${formatDate(camp.camp_date)}.`
          : `Donor registered for the camp on ${formatDate(camp.camp_date)}.`,
        "Registration confirmed",
      );
      onDone();
    } catch {
      /* surfaced below */
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Register for camp"
      description={`${camp.organizer} · ${formatDate(camp.camp_date)}`}
      size="md"
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="register-form" loading={pending}>
            Confirm registration
          </Button>
        </>
      }
    >
      <form id="register-form" onSubmit={handleSubmit} className="space-y-4">
        {isDonor ? (
          <Callout tone="info">
            You will be registered under your own donor record. A donor can only
            hold one registration per camp.
          </Callout>
        ) : (
          <SelectField
            name="donor_id"
            label="Donor"
            value={donorId}
            onChange={setDonorId}
            options={donors.options}
            placeholder={donors.loading ? "Loading donors…" : "Select donor"}
            error={fieldErrors.donor_id}
            disabled={donors.loading}
            required
          />
        )}

        {error && !Object.keys(fieldErrors).length ? (
          <Callout tone="danger">{error.message}</Callout>
        ) : null}
      </form>
    </Modal>
  );
}

export default function CampsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const isAdmin = role === ROLES.ADMIN;
  const canRegister =
    role === ROLES.ADMIN ||
    role === ROLES.BLOOD_BANK_STAFF ||
    role === ROLES.DONOR;

  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [registerFor, setRegisterFor] = useState(null);

  const { data, loading, error, reload } = useApi(
    () => endpoints.camps.list(status ? { status } : undefined),
    [status],
  );

  const rows = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const columns = [
    {
      key: "camp_id",
      header: "ID",
      render: (row) => (
        <span className="font-medium text-slate-900">#{row.camp_id}</span>
      ),
    },
    {
      key: "camp_date",
      header: "Date",
      render: (row) => formatDate(row.camp_date),
    },
    {
      key: "organizer",
      header: "Organizer",
      render: (row) => (
        <span className="font-medium text-slate-900">{row.organizer}</span>
      ),
    },
    {
      key: "venue",
      header: "Venue",
      render: (row) =>
        [row.address?.city, row.address?.district, row.address?.state]
          .filter(Boolean)
          .join(", "),
    },
    { key: "contact_phone", header: "Contact" },
    {
      key: "registration_count",
      header: "Registered",
      align: "right",
      render: (row) => (
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <Users className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          {row.registration_count}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge value={row.status} />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      stopPropagation: true,
      render: (row) =>
        canRegister && row.status === "SCHEDULED" ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setRegisterFor(row)}
          >
            Register
          </Button>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Donation camps"
        description="Scheduled collection drives. Donations may be linked to a camp."
        icon={CalendarDays}
        actions={
          isAdmin ? (
            <Button icon={Plus} onClick={() => setCreateOpen(true)}>
              New camp
            </Button>
          ) : null
        }
      />

      <Section className="overflow-hidden">
        <FilterBar
          filters={[
            {
              key: "status",
              label: "Status",
              type: "select",
              options: CAMP_STATUSES,
            },
          ]}
          values={{ status }}
          onChange={(_key, value) => setStatus(value)}
          onReset={() => setStatus("")}
          onRefresh={reload}
        />

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.camp_id}
          loading={loading}
          error={error}
          onRetry={reload}
          emptyTitle="No camps found"
          emptyMessage={
            isAdmin
              ? "Schedule a camp to start collecting registrations."
              : "No camps match the selected status."
          }
          emptyIcon={CalendarDays}
          footer={
            !loading && !error && rows.length ? (
              <div className="border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
                Showing all {rows.length} camp{rows.length === 1 ? "" : "s"}. This
                endpoint returns the full list rather than pages.
              </div>
            ) : null
          }
        />
      </Section>

      {createOpen && isAdmin ? (
        <CampForm
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            reload();
          }}
        />
      ) : null}

      {registerFor ? (
        <RegisterDialog
          camp={registerFor}
          onClose={() => setRegisterFor(null)}
          onDone={() => {
            setRegisterFor(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}
