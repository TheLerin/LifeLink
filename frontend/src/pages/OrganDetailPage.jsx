/**
 * OrganDetailPage - one organ unit and its transparent academic candidate
 * ranking (ADMIN and organ-bank staff only).
 *
 * NAMING RULE, straight from the blueprint: this ranking is the "Academic
 * Priority Score". It must never be presented as AI, machine learning, a medical
 * probability or a transplant-success prediction. It is a fixed, published,
 * arithmetic formula computed by a SQL view:
 *
 *     final_priority = 0.50 x compatibility + 0.30 x urgency + 0.20 x waiting_time
 *
 * Only ONE of those three components is supplied by a human: compatibility, a
 * 0-100 academic figure entered by staff. The other two are derived by
 * organ_match_priority_view - urgency from the request priority (LOW 25,
 * MEDIUM 50, HIGH 75, CRITICAL 100) and waiting time from days since the
 * request was raised, capped at 100. Every component is shown in the table so
 * the ranking is fully auditable by hand; nothing here is a black box.
 *
 * The database also constrains what can be scored: an ORGAN request that is
 * PENDING or MATCHED, whose organ_type equals this unit's, while the unit is
 * AVAILABLE or MATCHING. Re-scoring is allowed only while a match is still a
 * CANDIDATE.
 */

import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
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
import {
  FormGrid,
  SelectField,
  TextField,
} from "../components/FormFields.jsx";
import { endpoints } from "../api/endpoints.js";
import { useApi, useMutation } from "../hooks/useApi.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { ORGAN_SCORE_NOTE, ROLES } from "../constants/lifelink.js";
import { Activity, Calculator, TrendingUp } from "../components/icons.js";
import {
  formatDate,
  formatDateTime,
  formatEnum,
  formatScore,
  DASH,
} from "../utils/format.js";

/** Match transitions the service accepts. Mirrors update_organ_match_status. */
const MATCH_TRANSITIONS = {
  CANDIDATE: ["SELECTED", "REJECTED"],
  SELECTED: ["COMPLETED"],
  REJECTED: [],
  COMPLETED: [],
};

const MATCH_TRANSITION_NOTE = {
  SELECTED:
    "This candidate becomes the selected recipient for the unit. The unit moves to ALLOCATED and the request is marked MATCHED.",
  REJECTED:
    "The candidate is withdrawn permanently and leaves this ranking view. A rejected match cannot be recalculated or revived.",
  COMPLETED:
    "The allocation is recorded as complete. This is the end of the match lifecycle and cannot be undone from the UI.",
};

/* -------------------------------------------------------------------------- */
/* Score a candidate                                                          */
/* -------------------------------------------------------------------------- */

function ScoreCandidateDialog({ unit, onClose, onScored }) {
  const toast = useToast();

  // Eligible requests are narrowed on the client: the list endpoint filters by
  // request_type but not by organ_type, and only PENDING/MATCHED can be scored.
  const requests = useApi(
    () =>
      endpoints.emergencyRequests.list({
        request_type: "ORGAN",
        page_size: 100,
      }),
    [],
  );

  const eligible = useMemo(() => {
    const items = Array.isArray(requests.data?.items) ? requests.data.items : [];
    return items.filter(
      (row) =>
        row.requested_organ_type === unit.organ_type &&
        (row.status === "PENDING" || row.status === "MATCHED"),
    );
  }, [requests.data, unit.organ_type]);

  const options = eligible.map((row) => ({
    value: String(row.request_id),
    label: `#${row.request_id} · ${row.recipient_name} · ${formatEnum(row.priority)} · ${row.hospital_name}`,
  }));

  const { run, pending, error } = useMutation((candidates) =>
    endpoints.organs.calculateMatches(unit.organ_unit_id, candidates),
  );

  const [requestId, setRequestId] = useState("");
  const [score, setScore] = useState("");
  const fieldErrors = error?.fieldErrors ? error.fieldErrors() : {};

  async function handleSubmit(event) {
    event.preventDefault();
    try {
      const created = await run([
        {
          request_id: Number(requestId),
          compatibility_score: Number(score),
        },
      ]);
      const first = Array.isArray(created) ? created[0] : created;
      toast.success(
        first
          ? `Candidate scored. Academic Priority Score ${formatScore(
              first.academic_priority_score,
            )}, rank ${first.candidate_rank}.`
          : "Candidate scored.",
        "Academic ranking updated",
      );
      onScored();
    } catch {
      /* surfaced below */
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Score a candidate recipient"
      description="You supply the academic compatibility figure only. Urgency and waiting time are derived by the database."
      size="lg"
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="score-form" loading={pending}>
            Calculate ranking
          </Button>
        </>
      }
    >
      <form id="score-form" onSubmit={handleSubmit} className="space-y-5">
        <Callout tone="neutral">{ORGAN_SCORE_NOTE}</Callout>

        <FormGrid columns={2}>
          <SelectField
            name="request_id"
            label={`Eligible ${unit.organ_type} request`}
            value={requestId}
            onChange={setRequestId}
            options={options}
            placeholder={
              requests.loading
                ? "Loading requests…"
                : options.length
                  ? "Select request"
                  : "No eligible requests"
            }
            error={fieldErrors.request_id}
            hint="Open ORGAN requests for this organ type only."
            disabled={requests.loading || !options.length}
            required
          />
          <TextField
            name="compatibility_score"
            label="Academic compatibility score"
            type="number"
            value={score}
            onChange={setScore}
            error={fieldErrors.compatibility_score}
            hint="0 to 100, at most 2 decimal places. Weighted at 0.50."
            min="0"
            max="100"
            step="0.01"
            required
          />
        </FormGrid>

        {!requests.loading && !options.length ? (
          <Callout tone="warning">
            No PENDING or MATCHED {unit.organ_type} request is available to
            score. Raise an organ request for this organ type first.
          </Callout>
        ) : null}

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
/* Match row actions                                                          */
/* -------------------------------------------------------------------------- */

function MatchActions({ match, onChanged }) {
  const toast = useToast();
  const [target, setTarget] = useState(null);
  const mutation = useMutation((status) =>
    endpoints.organMatches.setStatus(match.match_id, status),
  );

  const allowed = MATCH_TRANSITIONS[match.match_status] ?? [];
  if (!allowed.length) {
    return <span className="text-xs text-slate-400">Terminal</span>;
  }

  async function apply() {
    try {
      await mutation.run(target);
      toast.success(
        `Match #${match.match_id} is now ${formatEnum(target)}.`,
        "Match updated",
      );
      setTarget(null);
      onChanged();
    } catch {
      /* surfaced in the dialog */
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {allowed.map((status) => (
        <Button
          key={status}
          size="sm"
          variant={
            status === "REJECTED"
              ? "danger"
              : status === "COMPLETED"
                ? "success"
                : "primary"
          }
          onClick={() => setTarget(status)}
        >
          {status === "SELECTED"
            ? "Select"
            : status === "REJECTED"
              ? "Reject"
              : "Complete"}
        </Button>
      ))}

      {target ? (
        <ConfirmDialog
          open
          title={`Mark match as ${formatEnum(target)}?`}
          message={MATCH_TRANSITION_NOTE[target]}
          confirmLabel={`Set ${formatEnum(target)}`}
          confirmVariant={target === "REJECTED" ? "danger" : "primary"}
          busy={mutation.pending}
          error={mutation.error}
          onConfirm={apply}
          onClose={() => setTarget(null)}
        >
          <Callout tone="neutral">
            The database validates this transition and writes the audit row in
            the same transaction.
          </Callout>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Ranking table                                                              */
/* -------------------------------------------------------------------------- */

function MatchesSection({ unit, canManage, onScoreClick }) {
  const { data, loading, error, reload } = useApi(
    () => endpoints.organs.matches(unit.organ_unit_id),
    [unit.organ_unit_id],
  );

  const rows = Array.isArray(data) ? data : [];

  const columns = [
    {
      key: "candidate_rank",
      header: "Rank",
      render: (row) => (
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-navy-800 text-xs font-semibold text-white">
          {row.candidate_rank}
        </span>
      ),
    },
    {
      key: "recipient_name",
      header: "Candidate recipient",
      render: (row) => (
        <span>
          <span className="block font-medium text-slate-900">
            {row.recipient_name || DASH}
          </span>
          <span className="text-xs text-slate-500">{row.hospital_name}</span>
        </span>
      ),
    },
    {
      key: "request_id",
      header: "Request",
      render: (row) => (
        <Link
          to={`/emergency-requests/${row.request_id}`}
          className="font-medium text-navy-800 hover:underline"
        >
          #{row.request_id}
        </Link>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      render: (row) => (row.priority ? <StatusBadge value={row.priority} /> : DASH),
    },
    {
      key: "compatibility_score",
      header: "Compat. (0.50)",
      align: "right",
      render: (row) => (
        <span className="tabular-nums text-slate-700">
          {formatScore(row.compatibility_score)}
        </span>
      ),
    },
    {
      key: "urgency_score",
      header: "Urgency (0.30)",
      align: "right",
      render: (row) => (
        <span className="tabular-nums text-slate-700">
          {formatScore(row.urgency_score)}
        </span>
      ),
    },
    {
      key: "waiting_time_score",
      header: "Waiting (0.20)",
      align: "right",
      render: (row) => (
        <span className="tabular-nums text-slate-700">
          {formatScore(row.waiting_time_score)}
        </span>
      ),
    },
    {
      key: "academic_priority_score",
      header: "Academic Priority Score",
      align: "right",
      render: (row) => (
        <span className="tabular-nums font-semibold text-slate-900">
          {formatScore(row.academic_priority_score)}
        </span>
      ),
    },
    {
      key: "match_status",
      header: "Status",
      render: (row) => <StatusBadge value={row.match_status} />,
    },
    {
      key: "calculated_at",
      header: "Scored",
      render: (row) => formatDateTime(row.calculated_at),
    },
  ];

  if (canManage) {
    columns.push({
      key: "actions",
      header: "",
      align: "right",
      render: (row) => <MatchActions match={row} onChanged={reload} />,
    });
  }

  return (
    <Section
      title="Academic priority ranking"
      description="Candidates ordered by the published formula. Every component is shown so the ranking can be recomputed by hand."
      actions={
        canManage ? (
          <Button size="sm" icon={Calculator} onClick={onScoreClick}>
            Score a candidate
          </Button>
        ) : null
      }
      className="mt-5 overflow-hidden"
    >
      <div className="border-b border-slate-200 px-4 py-3">
        <Callout tone="neutral">{ORGAN_SCORE_NOTE}</Callout>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.match_id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyTitle="No candidates scored yet"
        emptyMessage={
          canManage
            ? `Score an open ${unit.organ_type} request to build the ranking.`
            : "No candidate recipients have been scored for this unit."
        }
        emptyIcon={TrendingUp}
      />
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function OrganDetailPage() {
  const { organId } = useParams();
  const { user } = useAuth();
  const [scoreOpen, setScoreOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const {
    data: unit,
    loading,
    error,
    reload,
  } = useApi(() => endpoints.organs.get(organId), [organId, refreshKey]);

  // Reaching this page already requires ADMIN or ORGAN_BANK_STAFF, and both may
  // calculate matches and move them through their lifecycle.
  const canManage =
    user?.role === ROLES.ADMIN || user?.role === ROLES.ORGAN_BANK_STAFF;

  // Scoring is only accepted while the unit is AVAILABLE or MATCHING.
  const scorable =
    unit && (unit.status === "AVAILABLE" || unit.status === "MATCHING");

  return (
    <div>
      <PageHeader
        title={unit ? `Organ unit #${unit.organ_unit_id}` : "Organ unit"}
        description={
          unit
            ? `${unit.organ_type} · from ${unit.donor_name} · held at ${unit.current_organ_bank_name}`
            : null
        }
        icon={Activity}
        backTo="/organs"
        backLabel="Organ inventory"
        actions={unit ? <StatusBadge value={unit.status} /> : null}
      />

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <AsyncPanel loading={loading} error={null} isEmpty={!unit}>
          {unit ? (
            <>
              <Section title="Unit record">
                <div className="px-4 py-4">
                  <DetailList
                    items={[
                      { label: "Unit ID", value: `#${unit.organ_unit_id}` },
                      {
                        label: "Organ",
                        value: (
                          <span className="font-semibold text-navy-800">
                            {unit.organ_type}
                          </span>
                        ),
                      },
                      { label: "Status", value: <StatusBadge value={unit.status} /> },
                      {
                        label: "Donor",
                        value: `${unit.donor_name} (#${unit.donor_id})`,
                      },
                      { label: "Source donation", value: `#${unit.donation_id}` },
                      {
                        label: "Held at",
                        value: unit.current_organ_bank_name,
                      },
                      {
                        label: "Donation date",
                        value: formatDate(unit.donation_date),
                      },
                      {
                        label: "Recorded",
                        value: formatDateTime(unit.created_at),
                      },
                    ]}
                  />
                </div>
              </Section>

              {canManage && !scorable ? (
                <Callout tone="neutral" className="mt-5">
                  Candidates can only be scored while the unit is AVAILABLE or
                  MATCHING. This unit is {formatEnum(unit.status)}, so the
                  ranking below is read-only history.
                </Callout>
              ) : null}

              <MatchesSection
                unit={unit}
                canManage={canManage && scorable}
                onScoreClick={() => setScoreOpen(true)}
              />
            </>
          ) : null}
        </AsyncPanel>
      )}

      {scoreOpen && unit ? (
        <ScoreCandidateDialog
          unit={unit}
          onClose={() => setScoreOpen(false)}
          onScored={() => {
            setScoreOpen(false);
            // Bump the key so the unit AND its ranking both refetch: selecting a
            // candidate can move the unit to ALLOCATED.
            setRefreshKey((key) => key + 1);
          }}
        />
      ) : null}
    </div>
  );
}
