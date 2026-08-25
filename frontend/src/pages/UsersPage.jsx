/**
 * UsersPage - account administration (ADMIN only).
 *
 * Creates accounts, edits them, and changes status. Passwords are only ever
 * sent to the backend, which hashes them with bcrypt before storage - the
 * plaintext never reaches the database and is never echoed back to the client.
 *
 * Server-side filters: role, status (aliased from account_status) and search.
 */

import { useState } from "react";
import { PageHeader } from "../components/Layout.jsx";
import { Section, Callout } from "../components/States.jsx";
import DataTable from "../components/DataTable.jsx";
import FilterBar from "../components/FilterBar.jsx";
import Pagination from "../components/Pagination.jsx";
import Modal from "../components/Modal.jsx";
import Button from "../components/Button.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { FormGrid, SelectField, TextField } from "../components/FormFields.jsx";
import { endpoints } from "../api/endpoints.js";
import { usePagedList, useMutation } from "../hooks/useApi.js";
import { useBloodBankOptions, useOrganBankOptions } from "../hooks/useLookups.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import {
  ALL_ROLES,
  ROLE_LABELS,
  ROLES,
  USER_STATUSES,
} from "../constants/lifelink.js";
import { ShieldCheck, Plus, Pencil, Lock } from "../components/icons.js";
import { formatDateTime, DASH } from "../utils/format.js";

const ROLE_OPTIONS = ALL_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

/** Which optional link a role needs, so the form only asks for what applies. */
function linkFieldFor(role) {
  if (role === ROLES.BLOOD_BANK_STAFF) return "blood_bank_id";
  if (role === ROLES.ORGAN_BANK_STAFF) return "organ_bank_id";
  if (role === ROLES.DOCTOR || role === ROLES.DONOR || role === ROLES.RECIPIENT) {
    return "person_id";
  }
  return null;
}

const PERSON_HINT = {
  DOCTOR: "The doctor_id this account signs in as.",
  DONOR: "The donor_id this account signs in as.",
  RECIPIENT: "The recipient_id this account signs in as.",
};

function UserForm({ user, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = Boolean(user);
  const bloodBanks = useBloodBankOptions({ activeOnly: false });
  const organBanks = useOrganBankOptions({ activeOnly: false });

  const { run, pending, error } = useMutation((body) =>
    isEdit ? endpoints.users.update(user.user_id, body) : endpoints.users.create(body),
  );

  const [form, setForm] = useState({
    username: user?.username || "",
    password: "",
    role: user?.role || "",
    status: user?.status || "ACTIVE",
    person_id: user?.person_id ? String(user.person_id) : "",
    blood_bank_id: user?.blood_bank_id ? String(user.blood_bank_id) : "",
    organ_bank_id: user?.organ_bank_id ? String(user.organ_bank_id) : "",
  });

  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));
  const fieldErrors = error?.fieldErrors ? error.fieldErrors() : {};
  const linkField = linkFieldFor(form.role);

  async function handleSubmit(event) {
    event.preventDefault();

    const body = {};
    if (isEdit) {
      // PATCH must carry only what changed - the schema rejects an empty body
      // and rejects explicit nulls.
      if (form.username.trim() !== user.username) body.username = form.username.trim();
      if (form.password) body.new_password = form.password;
      if (form.role !== user.role) body.role = form.role;
      if (linkField === "person_id" && form.person_id) {
        body.person_id = Number(form.person_id);
      }
      if (linkField === "blood_bank_id" && form.blood_bank_id) {
        body.blood_bank_id = Number(form.blood_bank_id);
      }
      if (linkField === "organ_bank_id" && form.organ_bank_id) {
        body.organ_bank_id = Number(form.organ_bank_id);
      }
      if (Object.keys(body).length === 0) {
        toast.info("Nothing changed.", "No update sent");
        onClose();
        return;
      }
    } else {
      body.username = form.username.trim();
      body.password = form.password;
      body.role = form.role;
      body.status = form.status;
      if (linkField === "person_id" && form.person_id) {
        body.person_id = Number(form.person_id);
      }
      if (linkField === "blood_bank_id" && form.blood_bank_id) {
        body.blood_bank_id = Number(form.blood_bank_id);
      }
      if (linkField === "organ_bank_id" && form.organ_bank_id) {
        body.organ_bank_id = Number(form.organ_bank_id);
      }
    }

    try {
      const saved = await run(body);
      toast.success(
        isEdit ? `Account “${saved.username}” updated.` : `Account “${saved.username}” created.`,
        isEdit ? "User updated" : "User created",
      );
      onSaved();
    } catch {
      /* surfaced below */
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit ${user.username}` : "New user account"}
      description={
        isEdit
          ? "Leave the password blank to keep the current one."
          : "Passwords are hashed with bcrypt by the backend before storage."
      }
      size="lg"
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" loading={pending}>
            {isEdit ? "Save changes" : "Create account"}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={handleSubmit} className="space-y-5">
        <FormGrid columns={2}>
          <TextField
            name="username"
            label="Username"
            value={form.username}
            onChange={set("username")}
            error={fieldErrors.username}
            hint="3 to 80 characters."
            autoComplete="off"
            maxLength={80}
            required
          />
          <TextField
            name="password"
            label={isEdit ? "New password" : "Password"}
            type="password"
            value={form.password}
            onChange={set("password")}
            error={fieldErrors.password || fieldErrors.new_password}
            hint="At least 8 characters."
            autoComplete="new-password"
            required={!isEdit}
          />
          <SelectField
            name="role"
            label="Role"
            value={form.role}
            onChange={set("role")}
            options={ROLE_OPTIONS}
            error={fieldErrors.role}
            required
          />
          {!isEdit ? (
            <SelectField
              name="status"
              label="Initial status"
              value={form.status}
              onChange={set("status")}
              options={USER_STATUSES}
              error={fieldErrors.status}
              placeholder="Select status"
              required
            />
          ) : null}

          {linkField === "person_id" ? (
            <TextField
              name="person_id"
              label="Linked person id"
              type="number"
              value={form.person_id}
              onChange={set("person_id")}
              error={fieldErrors.person_id}
              hint={PERSON_HINT[form.role]}
              min="1"
              required={!isEdit}
            />
          ) : null}

          {linkField === "blood_bank_id" ? (
            <SelectField
              name="blood_bank_id"
              label="Blood bank"
              value={form.blood_bank_id}
              onChange={set("blood_bank_id")}
              options={bloodBanks.options}
              placeholder={bloodBanks.loading ? "Loading…" : "Select blood bank"}
              error={fieldErrors.blood_bank_id}
              hint="The bank whose inventory this account manages."
              disabled={bloodBanks.loading}
              required={!isEdit}
            />
          ) : null}

          {linkField === "organ_bank_id" ? (
            <SelectField
              name="organ_bank_id"
              label="Organ bank"
              value={form.organ_bank_id}
              onChange={set("organ_bank_id")}
              options={organBanks.options}
              placeholder={organBanks.loading ? "Loading…" : "Select organ bank"}
              error={fieldErrors.organ_bank_id}
              hint="The bank whose organ units this account manages."
              disabled={organBanks.loading}
              required={!isEdit}
            />
          ) : null}
        </FormGrid>

        {isEdit ? (
          <Callout tone="neutral">
            Status is changed from the row action, not here, so a lockout is always
            a deliberate step.
          </Callout>
        ) : null}

        {error && !Object.keys(fieldErrors).length ? (
          <Callout tone="danger">{error.message}</Callout>
        ) : null}
      </form>
    </Modal>
  );
}

export default function UsersPage() {
  const toast = useToast();
  const { user: currentUser } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [statusChange, setStatusChange] = useState(null);

  const list = usePagedList((params) => endpoints.users.list(params), {
    pageSize: 20,
  });

  const statusMutation = useMutation(({ userId, status }) =>
    endpoints.users.setStatus(userId, status),
  );

  async function applyStatus() {
    const { row, status } = statusChange;
    try {
      await statusMutation.run({ userId: row.user_id, status });
      toast.success(`“${row.username}” is now ${status}.`, "Status updated");
      setStatusChange(null);
      list.reload();
    } catch (cause) {
      toast.error(cause.message, "Could not change status");
      setStatusChange(null);
    }
  }

  const columns = [
    {
      key: "user_id",
      header: "ID",
      render: (row) => (
        <span className="font-medium text-slate-900">#{row.user_id}</span>
      ),
    },
    {
      key: "username",
      header: "Username",
      render: (row) => (
        <span className="font-medium text-slate-900">
          {row.username}
          {row.user_id === currentUser?.user_id ? (
            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
              You
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (row) => ROLE_LABELS[row.role] || row.role,
    },
    {
      key: "linked",
      header: "Linked to",
      render: (row) =>
        row.full_name ||
        row.blood_bank_name ||
        row.organ_bank_name ||
        (row.person_id ? `Person #${row.person_id}` : DASH),
    },
    {
      key: "last_login_at",
      header: "Last sign-in",
      render: (row) =>
        row.last_login_at ? formatDateTime(row.last_login_at) : "Never",
    },
    {
      key: "created_at",
      header: "Created",
      render: (row) => formatDateTime(row.created_at),
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
      render: (row) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={Pencil}
            onClick={() => setEditing(row)}
          >
            Edit
          </Button>
          {row.status === "ACTIVE" ? (
            <Button
              size="sm"
              variant="danger"
              icon={Lock}
              disabled={row.user_id === currentUser?.user_id}
              title={
                row.user_id === currentUser?.user_id
                  ? "You cannot disable your own account"
                  : undefined
              }
              onClick={() => setStatusChange({ row, status: "DISABLED" })}
            >
              Disable
            </Button>
          ) : (
            <Button
              size="sm"
              variant="success"
              onClick={() => setStatusChange({ row, status: "ACTIVE" })}
            >
              Activate
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="User accounts"
        description="Sign-in accounts and the role each one carries. Passwords are stored only as bcrypt hashes."
        icon={ShieldCheck}
        actions={
          <Button icon={Plus} onClick={() => setCreateOpen(true)}>
            New account
          </Button>
        }
      />

      <Section className="overflow-hidden">
        <FilterBar
          filters={[
            {
              key: "search",
              label: "Search",
              type: "search",
              placeholder: "Username…",
              width: "w-64",
            },
            {
              key: "role",
              label: "Role",
              type: "select",
              options: ROLE_OPTIONS,
              width: "w-48",
            },
            {
              key: "status",
              label: "Status",
              type: "select",
              options: USER_STATUSES,
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
          rowKey={(row) => row.user_id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          emptyTitle="No accounts found"
          emptyMessage="Adjust your filters, or create an account."
          emptyIcon={ShieldCheck}
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

      {createOpen ? (
        <UserForm
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            list.reload();
          }}
        />
      ) : null}

      {editing ? (
        <UserForm
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      ) : null}

      {statusChange ? (
        <ConfirmDialog
          open
          title={
            statusChange.status === "ACTIVE" ? "Activate account" : "Disable account"
          }
          message={
            statusChange.status === "ACTIVE"
              ? `“${statusChange.row.username}” will be able to sign in again.`
              : `“${statusChange.row.username}” will be signed out and blocked from signing in. Their audit history is kept.`
          }
          confirmLabel={
            statusChange.status === "ACTIVE" ? "Activate" : "Disable account"
          }
          confirmVariant={statusChange.status === "ACTIVE" ? "success" : "danger"}
          busy={statusMutation.pending}
          onConfirm={applyStatus}
          onClose={() => setStatusChange(null)}
        />
      ) : null}
    </div>
  );
}
