/**
 * DonorsPage - the donor directory.
 *
 * Readable by ADMIN, blood-bank and organ-bank staff; only ADMIN may create.
 * The only server-side filter this endpoint offers is `search`, so that is all
 * the filter bar sends - inventing extra query parameters would silently do
 * nothing.
 */

import ResourceListPage from "../components/ResourceListPage.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import DonorForm from "./DonorForm.jsx";
import { endpoints } from "../api/endpoints.js";
import { useAuth } from "../context/AuthContext.jsx";
import { ROLES } from "../constants/lifelink.js";
import { HeartHandshake } from "../components/icons.js";
import { formatDate, formatNumber } from "../utils/format.js";

export default function DonorsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === ROLES.ADMIN;

  const config = {
    title: "Donors",
    description:
      "Everyone registered to donate blood or organs, with a simplified academic eligibility flag.",
    icon: HeartHandshake,
    fetcher: (params) => endpoints.donors.list(params),
    rowKey: (row) => row.donor_id,
    rowLink: (row) => `/donors/${row.donor_id}`,
    canCreate: isAdmin,
    createLabel: "New donor",
    renderCreate: isAdmin
      ? ({ onClose, onCreated }) => (
          <DonorForm onClose={onClose} onCreated={onCreated} />
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
    ],
    emptyTitle: "No donors found",
    emptyMessage: isAdmin
      ? "Adjust your search, or register the first donor."
      : "Adjust your search to widen the results.",
    columns: [
      {
        key: "donor_id",
        header: "ID",
        render: (row) => (
          <span className="font-medium text-slate-900">#{row.donor_id}</span>
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
      {
        key: "weight_kg",
        header: "Weight",
        align: "right",
        render: (row) => `${formatNumber(row.weight_kg)} kg`,
      },
      {
        key: "city",
        header: "Location",
        render: (row) => [row.city, row.district].filter(Boolean).join(", "),
      },
      {
        key: "last_blood_donation_date",
        header: "Last donation",
        render: (row) =>
          row.last_blood_donation_date
            ? formatDate(row.last_blood_donation_date)
            : "Never",
      },
      {
        key: "active_condition_count",
        header: "Conditions",
        align: "right",
        render: (row) =>
          row.active_condition_count > 0 ? (
            <span className="font-semibold text-amber-700">
              {row.active_condition_count}
            </span>
          ) : (
            "0"
          ),
      },
      {
        key: "is_eligible_demo",
        header: "Eligibility",
        render: (row) => (
          <StatusBadge
            value={row.is_eligible_demo ? "Eligible" : "Not eligible"}
            tone={row.is_eligible_demo ? "green" : "slate"}
          />
        ),
      },
      {
        key: "is_active",
        header: "Record",
        render: (row) => (
          <StatusBadge value={row.is_active ? "ACTIVE" : "INACTIVE"} />
        ),
      },
    ],
  };

  return <ResourceListPage config={config} />;
}
