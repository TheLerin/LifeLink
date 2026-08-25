/**
 * RecipientsPage - the recipient directory, plus the create dialog.
 *
 * Readable by ADMIN, doctors and both bank staff roles; only ADMIN may create.
 * Server-side filters: `status` (aliased from recipient_status) and `search`.
 */

import { useState } from "react";
import ResourceListPage from "../components/ResourceListPage.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import Modal from "../components/Modal.jsx";
import Button from "../components/Button.jsx";
import { Callout } from "../components/States.jsx";
import { FormGrid, SelectField, TextField } from "../components/FormFields.jsx";
import AddressFields, {
  EMPTY_ADDRESS,
  addressPayload,
} from "../components/AddressFields.jsx";
import { endpoints } from "../api/endpoints.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useMutation } from "../hooks/useApi.js";
import { useToast } from "../context/ToastContext.jsx";
import {
  BLOOD_GROUPS,
  GENDERS,
  RECIPIENT_STATUSES,
  ROLES,
} from "../constants/lifelink.js";
import { UserRound } from "../components/icons.js";
import { formatDate, todayIso } from "../utils/format.js";

function RecipientForm({ onClose, onCreated }) {
  const toast = useToast();
  const { run, pending, error } = useMutation(endpoints.recipients.create);
  const [form, setForm] = useState({
    full_name: "",
    date_of_birth: "",
    gender: "",
    blood_group: "",
    status: "ACTIVE",
  });
  const [address, setAddress] = useState(EMPTY_ADDRESS);

  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));
  const fieldErrors = error?.fieldErrors ? error.fieldErrors() : {};

  async function handleSubmit(event) {
    event.preventDefault();
    try {
      const created = await run({
        full_name: form.full_name.trim(),
        date_of_birth: form.date_of_birth,
        gender: form.gender,
        blood_group: form.blood_group,
        status: form.status,
        address: addressPayload(address),
      });
      toast.success(`Recipient “${created.full_name}” created.`, "Recipient added");
      onCreated();
    } catch {
      /* shown below */
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New recipient"
      description="Register a patient who may need blood or an organ."
      size="lg"
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="recipient-form" loading={pending}>
            Create recipient
          </Button>
        </>
      }
    >
      <form id="recipient-form" onSubmit={handleSubmit} className="space-y-5">
        <FormGrid columns={2}>
          <TextField
            name="full_name"
            label="Full name"
            value={form.full_name}
            onChange={set("full_name")}
            error={fieldErrors.full_name}
            maxLength={120}
            required
          />
          <TextField
            name="date_of_birth"
            label="Date of birth"
            type="date"
            value={form.date_of_birth}
            onChange={set("date_of_birth")}
            error={fieldErrors.date_of_birth}
            max={todayIso()}
            required
          />
          <SelectField
            name="gender"
            label="Gender"
            value={form.gender}
            onChange={set("gender")}
            options={GENDERS}
            error={fieldErrors.gender}
            required
          />
          <SelectField
            name="blood_group"
            label="Blood group"
            value={form.blood_group}
            onChange={set("blood_group")}
            options={BLOOD_GROUPS}
            error={fieldErrors.blood_group}
            required
          />
          <SelectField
            name="status"
            label="Status"
            value={form.status}
            onChange={set("status")}
            options={RECIPIENT_STATUSES}
            error={fieldErrors.status}
            placeholder="Select status"
            required
          />
        </FormGrid>

        <AddressFields value={address} onChange={setAddress} errors={fieldErrors} />

        {error && !Object.keys(fieldErrors).length ? (
          <Callout tone="danger">{error.message}</Callout>
        ) : null}
      </form>
    </Modal>
  );
}

export default function RecipientsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === ROLES.ADMIN;

  const config = {
    title: "Recipients",
    description: "Patients who may need a blood transfusion or an organ.",
    icon: UserRound,
    fetcher: (params) => endpoints.recipients.list(params),
    rowKey: (row) => row.recipient_id,
    rowLink: (row) => `/recipients/${row.recipient_id}`,
    canCreate: isAdmin,
    createLabel: "New recipient",
    renderCreate: isAdmin
      ? ({ onClose, onCreated }) => (
          <RecipientForm onClose={onClose} onCreated={onCreated} />
        )
      : undefined,
    filters: [
      {
        key: "search",
        label: "Search",
        type: "search",
        placeholder: "Name or city…",
        width: "w-72",
      },
      {
        key: "status",
        label: "Status",
        type: "select",
        options: RECIPIENT_STATUSES,
      },
    ],
    emptyTitle: "No recipients found",
    emptyMessage: "Adjust your filters, or register a new recipient.",
    columns: [
      {
        key: "recipient_id",
        header: "ID",
        render: (row) => (
          <span className="font-medium text-slate-900">#{row.recipient_id}</span>
        ),
      },
      {
        key: "full_name",
        header: "Name",
        render: (row) => (
          <span className="font-medium text-slate-900">{row.full_name}</span>
        ),
      },
      {
        key: "blood_group",
        header: "Group",
        render: (row) => (
          <span className="font-semibold text-blood-700">{row.blood_group}</span>
        ),
      },
      { key: "age_years", header: "Age", align: "right" },
      { key: "gender", header: "Gender", render: (row) => row.gender },
      {
        key: "date_of_birth",
        header: "Date of birth",
        render: (row) => formatDate(row.date_of_birth),
      },
      {
        key: "city",
        header: "Location",
        render: (row) => [row.city, row.district].filter(Boolean).join(", "),
      },
      {
        key: "status",
        header: "Status",
        render: (row) => <StatusBadge value={row.status} />,
      },
    ],
  };

  return <ResourceListPage config={config} />;
}
