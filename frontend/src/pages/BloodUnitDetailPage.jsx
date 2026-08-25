/**
 * BloodUnitDetailPage - one blood unit: its record, its screening tests and its
 * full audit timeline, plus the status transitions the database will accept.
 *
 * Two blueprint rules shape this page:
 *
 *  1. RESERVED is never offered as a manual target. A unit becomes RESERVED only
 *     through POST /api/emergency-requests/{id}/reserve, so PostgreSQL performs
 *     the row lock, the FEFO pick and the audit write atomically. That is why
 *     BLOOD_UNIT_MANUAL_TRANSITIONS.AVAILABLE does not contain RESERVED, and why
 *     RESERVED maps to an empty list of onward manual moves.
 *
 *  2. The button list is a convenience, not the rule. The same transition table
 *     is enforced by validate_blood_unit_status_transition() in the database, so
 *     a rejected move surfaces as a real backend error rather than being
 *     silently prevented here.
 *
 * Screening tests hang off the donation, not the unit, so the tests tab reads
 * and writes /donations/{donation_id}/tests using the unit's donation_id.
 */

import { useState } from "react";
import { useParams } from "react-router-dom";
import { PageHeader, DetailList, Tabs, Timeline } from "../components/Layout.jsx";
import {
  AsyncPanel,
  Section,
  Callout,
  ErrorState,
  LoadingState,
  EmptyState,
} from "../components/States.jsx";
import DataTable from "../components/DataTable.jsx";
import Button from "../components/Button.jsx";
import Modal from "../components/Modal.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import {
  FormGrid,
  SelectField,
  TextField,
  TextAreaField,
} from "../components/FormFields.jsx";
import { endpoints } from "../api/endpoints.js";
import { useApi, useMutation } from "../hooks/useApi.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import {
  BLOOD_UNIT_MANUAL_TRANSITIONS,
  ROLES,
  STATUS_TONES,
  TEST_RESULTS,
} from "../constants/lifelink.js";
import {
  Droplets,
  FlaskConical,
  Clock,
  Plus,
  CheckCircle2,
  XCircle,
} from "../components/icons.js";
import {
  formatDate,
  formatDateTime,
  formatEnum,
  todayIso,
  DASH,
} from "../utils/format.js";

/* -------------------------------------------------------------------------- */
/* Overview                                                                   */
/* -------------------------------------------------------------------------- */

function ExpirySummary({ unit }) {
  const days = unit.days_to_expiry;
  if (days === null || days === undefined) return formatDate(unit.expiry_date);

  const tone =
    days < 0 ? "text-red-700" : days <= 7 ? "text-amber-700" : "text-slate-600";
  const label =
    days < 0
      ? `expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`
      : days === 0
        ? "expires today"
        : `${days} day${days === 1 ? "" : "s"} remaining`;

  return (
    <span>
      {formatDate(unit.expiry_date)}{" "}
      <span className={`text-xs font-medium ${tone}`}>({label})</span>
    </span>
  );
}

function ScreeningSummary({ unit }) {
  const count = unit.screening_test_count ?? 0;
  if (count === 0) return "No screening tests recorded";
  if (unit.all_tests_passed === true) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        All {count} test{count === 1 ? "" : "s"} passed
      </span>
    );
  }
  if (unit.all_tests_passed === false) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <XCircle className="h-4 w-4 text-red-600" aria-hidden="true" />
        {count} test{count === 1 ? "" : "s"} recorded, not all passed
      </span>
    );
  }
  return `${count} test${count === 1 ? "" : "s"} recorded, results pending`;
}

function OverviewTab({ unit }) {
  return (
    <Section title="Unit record">
      <div className="px-4 py-4">
        <DetailList
          items={[
            { label: "Unit ID", value: `#${unit.blood_unit_id}` },
            {
              label: "Blood group",
              value: (
                <span className="font-bold text-blood-700">
                  {unit.blood_group}
                </span>
              ),
            },
            { label: "Status", value: <StatusBadge value={unit.status} /> },
            { label: "Donor", value: `${unit.donor_name} (#${unit.donor_id})` },
            { label: "Source donation", value: `#${unit.donation_id}` },
            {
              label: "Collected at",
              value: unit.collection_bank_name,
            },
            {
              label: "Currently held at",
              value: unit.current_blood_bank_name,
            },
            {
              label: "Collection date",
              value: formatDate(unit.collection_date),
            },
            { label: "Expiry", value: <ExpirySummary unit={unit} /> },
            {
              label: "Screening",
              value: <ScreeningSummary unit={unit} />,
              span: true,
            },
            { label: "Created", value: formatDateTime(unit.created_at) },
            { label: "Last updated", value: formatDateTime(unit.updated_at) },
          ]}
        />
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Status transitions                                                         */
/* -------------------------------------------------------------------------- */

/** Plain-language reason for each move, shown in the confirmation dialog. */
const TRANSITION_NOTE = {
  TESTING: "The unit goes for screening. It cannot be issued until tests pass.",
  AVAILABLE:
    "The unit joins allocatable stock and becomes eligible for FEFO reservation.",
  REJECTED:
    "The unit is permanently withdrawn from stock. This cannot be undone from the UI.",
  EXPIRED:
    "The unit is marked past its usable date and permanently leaves stock.",
};

function StatusActions({ unit, onChanged }) {
  const toast = useToast();
  const [pendingTarget, setPendingTarget] = useState(null);
  const mutation = useMutation((status) =>
    endpoints.bloodUnits.setStatus(unit.blood_unit_id, status),
  );

  const allowed = BLOOD_UNIT_MANUAL_TRANSITIONS[unit.status] ?? [];

  async function apply() {
    try {
      await mutation.run(pendingTarget);
      toast.success(
        `Unit #${unit.blood_unit_id} is now ${formatEnum(pendingTarget)}.`,
        "Status updated",
      );
      setPendingTarget(null);
      onChanged();
    } catch {
      /* surfaced in the dialog */
    }
  }

  if (allowed.length === 0) {
    return (
      <Callout tone="neutral">
        <span className="font-semibold">
          No manual transition is available from {formatEnum(unit.status)}.
        </span>{" "}
        {unit.status === "RESERVED"
          ? "A reserved unit moves on by issuing or cancelling its reservation, which keeps the unit and the reservation consistent in one transaction."
          : unit.status === "AVAILABLE"
            ? "An available unit becomes RESERVED only through an emergency request, never from this screen."
            : "This is a terminal state in the unit lifecycle."}
      </Callout>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-4 py-4">
        {allowed.map((target) => (
          <Button
            key={target}
            variant={
              target === "REJECTED" || target === "EXPIRED"
                ? "danger"
                : target === "AVAILABLE"
                  ? "success"
                  : "primary"
            }
            onClick={() => setPendingTarget(target)}
          >
            Move to {formatEnum(target)}
          </Button>
        ))}
      </div>

      {pendingTarget ? (
        <ConfirmDialog
          open
          title={`Move unit to ${formatEnum(pendingTarget)}?`}
          message={TRANSITION_NOTE[pendingTarget]}
          confirmLabel={`Set ${formatEnum(pendingTarget)}`}
          confirmVariant={
            pendingTarget === "REJECTED" || pendingTarget === "EXPIRED"
              ? "danger"
              : "primary"
          }
          busy={mutation.pending}
          error={mutation.error}
          onConfirm={apply}
          onClose={() => setPendingTarget(null)}
        >
          <Callout tone="neutral">
            PostgreSQL validates this transition and writes the audit row in the
            same transaction. If the database rejects it, the error appears here.
          </Callout>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Screening tests                                                            */
/* -------------------------------------------------------------------------- */

function AddTestForm({ donationId, nextTestNo, onClose, onSaved }) {
  const toast = useToast();
  const { run, pending, error } = useMutation((body) =>
    endpoints.donations.addTest(donationId, body),
  );

  const [form, setForm] = useState({
    test_no: String(nextTestNo),
    test_name: "",
    result: "PENDING",
    test_date: todayIso(),
    remarks: "",
  });

  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));
  const fieldErrors = error?.fieldErrors ? error.fieldErrors() : {};

  async function handleSubmit(event) {
    event.preventDefault();
    const payload = {
      test_no: Number(form.test_no),
      test_name: form.test_name.trim(),
      result: form.result,
      test_date: form.test_date,
    };
    const remarks = form.remarks.trim();
    if (remarks) payload.remarks = remarks;

    try {
      const saved = await run(payload);
      toast.success(
        `“${saved.test_name}” recorded as ${formatEnum(saved.result)}.`,
        "Screening result added",
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
      title="Add screening result"
      description="Recorded against the donation, so every unit from it shares the result."
      size="lg"
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="test-form" loading={pending}>
            Save result
          </Button>
        </>
      }
    >
      <form id="test-form" onSubmit={handleSubmit} className="space-y-5">
        <FormGrid columns={2}>
          <TextField
            name="test_no"
            label="Test number"
            type="number"
            value={form.test_no}
            onChange={set("test_no")}
            error={fieldErrors.test_no}
            hint="Unique per donation."
            min="1"
            max="32767"
            required
          />
          <TextField
            name="test_name"
            label="Test name"
            value={form.test_name}
            onChange={set("test_name")}
            error={fieldErrors.test_name}
            placeholder="HIV, HBsAg, HCV…"
            maxLength={120}
            required
          />
          <SelectField
            name="result"
            label="Result"
            value={form.result}
            onChange={set("result")}
            options={TEST_RESULTS}
            error={fieldErrors.result}
            placeholder="Select result"
            required
          />
          <TextField
            name="test_date"
            label="Test date"
            type="date"
            value={form.test_date}
            onChange={set("test_date")}
            error={fieldErrors.test_date}
            hint="Cannot be in the future."
            max={todayIso()}
            required
          />
        </FormGrid>

        <TextAreaField
          name="remarks"
          label="Remarks (optional)"
          value={form.remarks}
          onChange={set("remarks")}
          error={fieldErrors.remarks}
          maxLength={1000}
          rows={2}
        />

        {error && !Object.keys(fieldErrors).length ? (
          <Callout tone="danger">{error.message}</Callout>
        ) : null}
      </form>
    </Modal>
  );
}

function ScreeningTab({ unit, canManage, onTestsChanged }) {
  const [addOpen, setAddOpen] = useState(false);
  const { data, loading, error, reload } = useApi(
    () => endpoints.donations.tests(unit.donation_id),
    [unit.donation_id],
  );

  const rows = Array.isArray(data) ? data : [];
  const nextTestNo =
    rows.reduce((max, row) => Math.max(max, row.test_no ?? 0), 0) + 1;

  return (
    <>
      <Section
        title="Screening tests"
        description={`Results recorded against donation #${unit.donation_id}.`}
        actions={
          canManage ? (
            <Button size="sm" icon={Plus} onClick={() => setAddOpen(true)}>
              Add result
            </Button>
          ) : null
        }
        className="overflow-hidden"
      >
        <DataTable
          columns={[
            {
              key: "test_no",
              header: "No.",
              render: (row) => (
                <span className="font-medium text-slate-900">{row.test_no}</span>
              ),
            },
            {
              key: "test_name",
              header: "Test",
              render: (row) => (
                <span className="font-medium text-slate-800">
                  {row.test_name}
                </span>
              ),
            },
            {
              key: "result",
              header: "Result",
              render: (row) => <StatusBadge value={row.result} />,
            },
            {
              key: "test_date",
              header: "Date",
              render: (row) => formatDate(row.test_date),
            },
            {
              key: "remarks",
              header: "Remarks",
              className: "max-w-sm",
              render: (row) =>
                row.remarks ? (
                  <span className="block truncate text-slate-600" title={row.remarks}>
                    {row.remarks}
                  </span>
                ) : (
                  DASH
                ),
            },
          ]}
          rows={rows}
          rowKey={(row) => row.test_no}
          loading={loading}
          error={error}
          onRetry={reload}
          emptyTitle="No screening tests yet"
          emptyMessage={
            canManage
              ? "Add a result to move this unit through testing."
              : "No results have been recorded for this donation."
          }
          emptyIcon={FlaskConical}
        />
      </Section>

      {addOpen ? (
        <AddTestForm
          donationId={unit.donation_id}
          nextTestNo={nextTestNo}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            reload();
            // The unit's screening counters are derived, so refresh it too.
            onTestsChanged();
          }}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Timeline                                                                   */
/* -------------------------------------------------------------------------- */

function TimelineTab({ unitId }) {
  const { data, loading, error, reload } = useApi(
    () => endpoints.bloodUnits.timeline(unitId),
    [unitId],
  );

  const events = Array.isArray(data?.events) ? data.events : [];

  const items = events.map((event) => ({
    key: event.audit_id,
    title:
      event.old_status && event.new_status
        ? `${formatEnum(event.old_status)} → ${formatEnum(event.new_status)}`
        : event.new_status
          ? `Set to ${formatEnum(event.new_status)}`
          : formatEnum(event.action),
    badge: event.new_status ? <StatusBadge value={event.new_status} /> : null,
    tone: STATUS_TONES[event.new_status] || "slate",
    timestamp: formatDateTime(event.action_time),
    actor: event.username
      ? `${event.username}${event.user_id ? ` (user #${event.user_id})` : ""}`
      : event.user_id
        ? `User #${event.user_id}`
        : "System / database trigger",
    description: event.details || null,
  }));

  return (
    <Section
      title="Audit timeline"
      description="Every recorded change to this unit, oldest first, exactly as stored in audit_log."
    >
      {loading ? (
        <LoadingState label="Loading timeline…" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No audit entries yet"
          message="Entries appear as soon as this unit's status changes."
          icon={Clock}
        />
      ) : (
        <div className="px-4 py-5">
          <Timeline items={items} />
        </div>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function BloodUnitDetailPage() {
  const { unitId } = useParams();
  const { user } = useAuth();
  const [tab, setTab] = useState("overview");

  const {
    data: unit,
    loading,
    error,
    reload,
  } = useApi(() => endpoints.bloodUnits.get(unitId), [unitId]);

  // Reaching this page already requires ADMIN or BLOOD_BANK_STAFF, and both are
  // permitted to change status and record screening results.
  const canManage =
    user?.role === ROLES.ADMIN || user?.role === ROLES.BLOOD_BANK_STAFF;

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "screening", label: "Screening", count: unit?.screening_test_count },
    { id: "timeline", label: "Timeline" },
  ];

  return (
    <div>
      <PageHeader
        title={unit ? `Blood unit #${unit.blood_unit_id}` : "Blood unit"}
        description={
          unit
            ? `${unit.blood_group} · from ${unit.donor_name} · held at ${unit.current_blood_bank_name}`
            : null
        }
        icon={Droplets}
        backTo="/blood-units"
        backLabel="Blood inventory"
        actions={unit ? <StatusBadge value={unit.status} /> : null}
      />

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <AsyncPanel loading={loading} error={null} isEmpty={!unit}>
          {unit ? (
            <>
              {canManage ? (
                <Section
                  title="Lifecycle"
                  description="Only transitions the database accepts are offered. RESERVED is never set from here."
                  className="mb-5"
                >
                  <StatusActions unit={unit} onChanged={reload} />
                </Section>
              ) : null}

              <div className="mb-5">
                <Tabs tabs={tabs} active={tab} onChange={setTab} />
              </div>

              {tab === "overview" ? <OverviewTab unit={unit} /> : null}
              {tab === "screening" ? (
                <ScreeningTab
                  unit={unit}
                  canManage={canManage}
                  onTestsChanged={reload}
                />
              ) : null}
              {tab === "timeline" ? <TimelineTab unitId={unitId} /> : null}
            </>
          ) : null}
        </AsyncPanel>
      )}
    </div>
  );
}
