/**
 * DonorDetailPage - one donor, with tabs for profile, donations and conditions.
 *
 * A DONOR viewing their own record reaches this through /donors/:id (person_id
 * == donor_id). Staff reach it from the directory. The conditions tab is hidden
 * for organ-bank staff, who the backend does not permit to read conditions.
 */

import { useParams } from "react-router-dom";
import { useState } from "react";
import { endpoints } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../context/AuthContext.jsx";
import { ROLES } from "../constants/lifelink.js";
import { PageHeader, DetailList, Tabs } from "../components/Layout.jsx";
import {
  AsyncPanel,
  Callout,
  Section,
  ErrorState,
} from "../components/States.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import DataTable from "../components/DataTable.jsx";
import { HeartHandshake } from "../components/icons.js";
import { formatAddress } from "../components/AddressFields.jsx";
import { formatDate, formatDateTime, formatNumber } from "../utils/format.js";

function ProfileTab({ donor }) {
  return (
    <div className="space-y-5">
      <Section title="Donor profile">
        <div className="px-4 py-4">
          <DetailList
            items={[
              { label: "Full name", value: donor.full_name },
              { label: "Donor ID", value: `#${donor.donor_id}` },
              { label: "Blood group", value: donor.blood_group },
              { label: "Gender", value: donor.gender },
              { label: "Date of birth", value: formatDate(donor.date_of_birth) },
              { label: "Age", value: `${donor.age_years} years` },
              { label: "Weight", value: `${formatNumber(donor.weight_kg)} kg` },
              {
                label: "Record status",
                value: <StatusBadge value={donor.is_active ? "ACTIVE" : "INACTIVE"} />,
              },
              {
                label: "Address",
                value: formatAddress(donor.address),
                span: true,
              },
            ]}
          />
        </div>
      </Section>

      <Section title="Contact numbers">
        <div className="px-4 py-4">
          {donor.phones?.length ? (
            <ul className="flex flex-wrap gap-2">
              {donor.phones.map((phone) => (
                <li
                  key={phone.phone_id}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700"
                >
                  {phone.phone_number}
                  {phone.is_primary ? (
                    <span className="rounded-full bg-blood-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                      Primary
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No phone numbers on record.</p>
          )}
        </div>
      </Section>

      <Callout tone="neutral">
        Eligibility shown across the app uses a simplified academic rule and is
        not a medical clearance. Recorded:{" "}
        {donor.is_eligible_demo ? "eligible" : "not eligible"} · last updated{" "}
        {formatDateTime(donor.updated_at)}.
      </Callout>
    </div>
  );
}

function DonationsTab({ donorId }) {
  const { data, loading, error, reload } = useApi(
    () => endpoints.donors.donations(donorId, { page_size: 50 }),
    [donorId],
  );
  const items = data?.items || [];

  return (
    <Section title="Donation history" description="All donations by this donor.">
      <DataTable
        columns={[
          { key: "donation_id", header: "ID", render: (row) => `#${row.donation_id}` },
          {
            key: "donation_date",
            header: "Date",
            render: (row) => formatDate(row.donation_date),
          },
          {
            key: "donation_type",
            header: "Type",
            render: (row) => <StatusBadge value={row.donation_type} tone="blue" />,
          },
          {
            key: "where",
            header: "Collected at",
            render: (row) =>
              row.collection_bank_name || row.collection_organ_bank_name || "—",
          },
          {
            key: "quantity_collected_ml",
            header: "Volume",
            align: "right",
            render: (row) =>
              row.quantity_collected_ml ? `${row.quantity_collected_ml} mL` : "—",
          },
          {
            key: "unit_status",
            header: "Unit status",
            render: (row) =>
              row.unit_status ? <StatusBadge value={row.unit_status} /> : "—",
          },
          {
            key: "record_status",
            header: "Record",
            render: (row) => <StatusBadge value={row.record_status} />,
          },
        ]}
        rows={items}
        rowKey={(row) => row.donation_id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyTitle="No donations recorded"
        emptyMessage="This donor has not donated yet."
        emptyIcon={HeartHandshake}
      />
    </Section>
  );
}

function ConditionsTab({ donorId }) {
  const { data, loading, error, reload } = useApi(
    () => endpoints.donors.conditions(donorId),
    [donorId],
  );
  const items = data?.items || [];

  return (
    <Section
      title="Medical conditions"
      description="Conditions recorded against this donor."
    >
      <DataTable
        columns={[
          { key: "condition_name", header: "Condition" },
          {
            key: "condition_status",
            header: "Status",
            render: (row) =>
              row.condition_status ? (
                <StatusBadge value={row.condition_status} />
              ) : (
                "—"
              ),
          },
          {
            key: "diagnosed_date",
            header: "Diagnosed",
            render: (row) =>
              row.diagnosed_date ? formatDate(row.diagnosed_date) : "—",
          },
          { key: "description", header: "Notes" },
        ]}
        rows={items}
        rowKey={(row) => row.condition_id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyTitle="No conditions recorded"
        emptyMessage="This donor has no recorded medical conditions."
      />
    </Section>
  );
}

export default function DonorDetailPage() {
  const { donorId } = useParams();
  const { user } = useAuth();
  const [tab, setTab] = useState("profile");

  const { data: donor, loading, error, reload } = useApi(
    () => endpoints.donors.get(donorId),
    [donorId],
  );

  // Organ-bank staff cannot read conditions (backend guard), so hide that tab.
  const canSeeConditions =
    user?.role === ROLES.ADMIN ||
    user?.role === ROLES.BLOOD_BANK_STAFF ||
    user?.role === ROLES.DONOR;

  const tabs = [
    { id: "profile", label: "Profile" },
    { id: "donations", label: "Donations" },
    ...(canSeeConditions ? [{ id: "conditions", label: "Conditions" }] : []),
  ];

  return (
    <div>
      <PageHeader
        title={donor ? donor.full_name : "Donor"}
        description={donor ? `Donor #${donor.donor_id} · ${donor.blood_group}` : null}
        icon={HeartHandshake}
        backTo={user?.role === ROLES.DONOR ? "/" : "/donors"}
        backLabel={user?.role === ROLES.DONOR ? "Dashboard" : "All donors"}
        actions={
          donor ? <StatusBadge value={donor.is_active ? "ACTIVE" : "INACTIVE"} /> : null
        }
      />

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <AsyncPanel loading={loading} error={null} isEmpty={!donor}>
          {donor ? (
            <>
              <div className="mb-5">
                <Tabs tabs={tabs} active={tab} onChange={setTab} />
              </div>
              {tab === "profile" ? <ProfileTab donor={donor} /> : null}
              {tab === "donations" ? <DonationsTab donorId={donorId} /> : null}
              {tab === "conditions" && canSeeConditions ? (
                <ConditionsTab donorId={donorId} />
              ) : null}
            </>
          ) : null}
        </AsyncPanel>
      )}
    </div>
  );
}
