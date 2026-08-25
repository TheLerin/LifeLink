/**
 * RecipientDetailPage - one recipient, with profile and their request history.
 *
 * A RECIPIENT viewing their own record reaches this through /recipients/:id
 * (person_id == recipient_id); the backend's _owner() guard rejects any other
 * id, so the page simply surfaces that error rather than trying to pre-empt it.
 */

import { useParams } from "react-router-dom";
import { useState } from "react";
import { endpoints } from "../api/endpoints.js";
import { useApi, usePagedList } from "../hooks/useApi.js";
import { useAuth } from "../context/AuthContext.jsx";
import { ROLES } from "../constants/lifelink.js";
import { PageHeader, DetailList, Tabs } from "../components/Layout.jsx";
import { AsyncPanel, Section, ErrorState } from "../components/States.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import DataTable from "../components/DataTable.jsx";
import Pagination from "../components/Pagination.jsx";
import { UserRound, AlertTriangle } from "../components/icons.js";
import { formatAddress } from "../components/AddressFields.jsx";
import { formatDate, formatDateTime } from "../utils/format.js";

function ProfileTab({ recipient }) {
  return (
    <Section title="Recipient profile">
      <div className="px-4 py-4">
        <DetailList
          items={[
            { label: "Full name", value: recipient.full_name },
            { label: "Recipient ID", value: `#${recipient.recipient_id}` },
            { label: "Blood group", value: recipient.blood_group },
            { label: "Gender", value: recipient.gender },
            {
              label: "Date of birth",
              value: formatDate(recipient.date_of_birth),
            },
            { label: "Age", value: `${recipient.age_years} years` },
            {
              label: "Status",
              value: <StatusBadge value={recipient.status} />,
            },
            { label: "Registered", value: formatDateTime(recipient.created_at) },
            {
              label: "Address",
              value: formatAddress(recipient.address),
              span: true,
            },
          ]}
        />
      </div>
    </Section>
  );
}

function RequestsTab({ recipientId }) {
  const list = usePagedList(
    (params) => endpoints.recipients.requests(recipientId, params),
    { pageSize: 20 },
  );

  return (
    <Section
      title="Emergency requests"
      description="Blood and organ requests raised for this recipient."
    >
      <DataTable
        columns={[
          {
            key: "request_id",
            header: "ID",
            render: (row) => `#${row.request_id}`,
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
              row.request_type === "BLOOD"
                ? `${row.requested_blood_group} · ${row.units_required} unit(s)`
                : row.requested_organ_type,
          },
          {
            key: "priority",
            header: "Priority",
            render: (row) => <StatusBadge value={row.priority} />,
          },
          { key: "hospital_name", header: "Hospital" },
          {
            key: "requested_at",
            header: "Raised",
            render: (row) => formatDateTime(row.requested_at),
          },
          {
            key: "allocated_units",
            header: "Allocated",
            align: "right",
            render: (row) =>
              row.request_type === "BLOOD"
                ? `${row.allocated_units ?? 0}/${row.units_required ?? 0}`
                : "—",
          },
          {
            key: "status",
            header: "Status",
            render: (row) => <StatusBadge value={row.status} />,
          },
        ]}
        rows={list.items}
        rowKey={(row) => row.request_id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="No requests recorded"
        emptyMessage="No emergency request has been raised for this recipient."
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
  );
}

export default function RecipientDetailPage() {
  const { recipientId } = useParams();
  const { user } = useAuth();
  const [tab, setTab] = useState("profile");

  const {
    data: recipient,
    loading,
    error,
    reload,
  } = useApi(() => endpoints.recipients.get(recipientId), [recipientId]);

  const isSelf = user?.role === ROLES.RECIPIENT;

  const tabs = [
    { id: "profile", label: "Profile" },
    { id: "requests", label: "Requests" },
  ];

  return (
    <div>
      <PageHeader
        title={recipient ? recipient.full_name : "Recipient"}
        description={
          recipient
            ? `Recipient #${recipient.recipient_id} · ${recipient.blood_group}`
            : null
        }
        icon={UserRound}
        backTo={isSelf ? "/" : "/recipients"}
        backLabel={isSelf ? "Dashboard" : "All recipients"}
        actions={recipient ? <StatusBadge value={recipient.status} /> : null}
      />

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <AsyncPanel loading={loading} error={null} isEmpty={!recipient}>
          {recipient ? (
            <>
              <div className="mb-5">
                <Tabs tabs={tabs} active={tab} onChange={setTab} />
              </div>
              {tab === "profile" ? <ProfileTab recipient={recipient} /> : null}
              {tab === "requests" ? (
                <RequestsTab recipientId={recipientId} />
              ) : null}
            </>
          ) : null}
        </AsyncPanel>
      )}
    </div>
  );
}
