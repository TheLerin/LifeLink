/**
 * FacilityDirectory - shared screen for hospitals, blood banks and organ banks.
 *
 * All three endpoints share FacilityCreateRequest and FacilityBaseResponse and
 * return a plain array (no paging), differing only in their id column. Rather
 * than triplicate the screen, each page passes a small descriptor.
 *
 * The only server-side filter is `status`; name search is done client-side and
 * labelled as such so it is never mistaken for a database query.
 */

import { useMemo, useState } from "react";
import { PageHeader } from "../components/Layout.jsx";
import { Section } from "../components/States.jsx";
import DataTable from "../components/DataTable.jsx";
import FilterBar from "../components/FilterBar.jsx";
import Modal from "../components/Modal.jsx";
import Button from "../components/Button.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { Callout } from "../components/States.jsx";
import { FormGrid, SelectField, TextField } from "../components/FormFields.jsx";
import AddressFields, {
  EMPTY_ADDRESS,
  addressPayload,
  formatAddress,
} from "../components/AddressFields.jsx";
import { useApi, useMutation } from "../hooks/useApi.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { FACILITY_STATUSES, ROLES } from "../constants/lifelink.js";
import { Plus, Mail, Phone } from "../components/icons.js";
import { formatDate } from "../utils/format.js";

function FacilityForm({ descriptor, onClose, onCreated }) {
  const toast = useToast();
  const { run, pending, error } = useMutation(descriptor.create);

  const [form, setForm] = useState({
    name: "",
    contact_phone: "",
    email: "",
    status: "ACTIVE",
  });
  const [address, setAddress] = useState(EMPTY_ADDRESS);

  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));
  const fieldErrors = error?.fieldErrors ? error.fieldErrors() : {};

  async function handleSubmit(event) {
    event.preventDefault();
    const payload = {
      name: form.name.trim(),
      address: addressPayload(address),
      contact_phone: form.contact_phone.trim(),
      status: form.status,
    };
    const email = form.email.trim();
    if (email) payload.email = email;

    try {
      const created = await run(payload);
      toast.success(`${created.name} added.`, `${descriptor.singular} created`);
      onCreated();
    } catch {
      /* surfaced below */
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`New ${descriptor.singular.toLowerCase()}`}
      description={descriptor.createHint}
      size="lg"
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="facility-form" loading={pending}>
            Create {descriptor.singular.toLowerCase()}
          </Button>
        </>
      }
    >
      <form id="facility-form" onSubmit={handleSubmit} className="space-y-5">
        <FormGrid columns={2}>
          <TextField
            name="name"
            label="Name"
            value={form.name}
            onChange={set("name")}
            error={fieldErrors.name}
            maxLength={150}
            required
            className="sm:col-span-2"
          />
          <TextField
            name="contact_phone"
            label="Contact phone"
            value={form.contact_phone}
            onChange={set("contact_phone")}
            error={fieldErrors.contact_phone}
            hint="Digits, spaces and + ( ) - only."
            maxLength={20}
            required
          />
          <TextField
            name="email"
            label="Email"
            type="email"
            value={form.email}
            onChange={set("email")}
            error={fieldErrors.email}
            hint="Optional"
            maxLength={254}
          />
          <SelectField
            name="status"
            label="Status"
            value={form.status}
            onChange={set("status")}
            options={FACILITY_STATUSES}
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

export default function FacilityDirectory({ descriptor }) {
  const { user } = useAuth();
  const isAdmin = user?.role === ROLES.ADMIN;

  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const { data, loading, error, reload } = useApi(
    () => descriptor.list(status ? { status } : undefined),
    [status],
  );

  const rows = useMemo(() => {
    const all = Array.isArray(data) ? data : [];
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter(
      (row) =>
        row.name.toLowerCase().includes(term) ||
        (row.address?.city || "").toLowerCase().includes(term) ||
        (row.address?.district || "").toLowerCase().includes(term),
    );
  }, [data, search]);

  const columns = [
    {
      key: descriptor.idKey,
      header: "ID",
      render: (row) => (
        <span className="font-medium text-slate-900">#{row[descriptor.idKey]}</span>
      ),
    },
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <span className="font-medium text-slate-900">{row.name}</span>
      ),
    },
    {
      key: "city",
      header: "Location",
      render: (row) =>
        [row.address?.city, row.address?.district, row.address?.state]
          .filter(Boolean)
          .join(", "),
    },
    {
      key: "contact_phone",
      header: "Phone",
      render: (row) => (
        <span className="inline-flex items-center gap-1.5 text-slate-700">
          <Phone className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          {row.contact_phone}
        </span>
      ),
    },
    {
      key: "email",
      header: "Email",
      render: (row) =>
        row.email ? (
          <span className="inline-flex items-center gap-1.5 text-slate-700">
            <Mail className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            {row.email}
          </span>
        ) : null,
    },
    {
      key: "created_at",
      header: "Added",
      render: (row) => formatDate(row.created_at),
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
        title={descriptor.title}
        description={descriptor.description}
        icon={descriptor.icon}
        actions={
          isAdmin ? (
            <Button icon={Plus} onClick={() => setCreateOpen(true)}>
              New {descriptor.singular.toLowerCase()}
            </Button>
          ) : null
        }
      />

      <Section className="overflow-hidden">
        <FilterBar
          filters={[
            {
              key: "search",
              label: "Search (this page)",
              type: "search",
              placeholder: "Name or city…",
              width: "w-72",
            },
            {
              key: "status",
              label: "Status",
              type: "select",
              options: FACILITY_STATUSES,
            },
          ]}
          values={{ search, status }}
          onChange={(key, value) => {
            if (key === "status") setStatus(value);
            else setSearch(value);
          }}
          onReset={() => {
            setStatus("");
            setSearch("");
          }}
          onRefresh={reload}
        />

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row[descriptor.idKey]}
          loading={loading}
          error={error}
          onRetry={reload}
          emptyTitle={`No ${descriptor.plural.toLowerCase()} found`}
          emptyMessage="Adjust the status filter or search term."
          emptyIcon={descriptor.icon}
          footer={
            !loading && !error && rows.length ? (
              <div className="border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
                Showing {rows.length}
                {search ? ` of ${Array.isArray(data) ? data.length : 0} loaded` : ""}{" "}
                {rows.length === 1
                  ? descriptor.singular.toLowerCase()
                  : descriptor.plural.toLowerCase()}
                . This endpoint returns the full list rather than pages.
              </div>
            ) : null
          }
        />
      </Section>

      {createOpen && isAdmin ? (
        <FacilityForm
          descriptor={descriptor}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}
