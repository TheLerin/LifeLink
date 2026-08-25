/**
 * AccountPage - the signed-in user's own account details.
 *
 * Read-only: a self-service password change isn't in the backend contract
 * (blueprint keeps account management with the ADMIN), so this simply presents
 * what /auth/me returned.
 */

import { useAuth } from "../context/AuthContext.jsx";
import { ROLE_LABELS } from "../constants/lifelink.js";
import { PageHeader, DetailList } from "../components/Layout.jsx";
import { Section, Callout } from "../components/States.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { UserRound } from "../components/icons.js";
import { formatDateTime } from "../utils/format.js";

export default function AccountPage() {
  const { user } = useAuth();
  if (!user) return null;

  const facility =
    user.blood_bank_name ||
    user.organ_bank_name ||
    (user.blood_bank_id
      ? `Blood bank #${user.blood_bank_id}`
      : user.organ_bank_id
        ? `Organ bank #${user.organ_bank_id}`
        : null);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Account details"
        description="Your LifeLink account, as recorded in the database."
        icon={UserRound}
      />

      <Section title="Profile">
        <div className="px-4 py-4">
          <DetailList
            items={[
              { label: "Full name", value: user.full_name },
              { label: "Username", value: user.username },
              { label: "Role", value: ROLE_LABELS[user.role] || user.role },
              { label: "Status", value: <StatusBadge value={user.status} /> },
              { label: "Linked person ID", value: user.person_id },
              { label: "Facility", value: facility },
              {
                label: "Account created",
                value: formatDateTime(user.created_at),
              },
              {
                label: "Last sign-in",
                value: user.last_login_at
                  ? formatDateTime(user.last_login_at)
                  : "This session",
              },
            ]}
          />
        </div>
      </Section>

      <Callout tone="neutral" className="mt-5">
        Need a password change or a role update? Account management is handled by
        an administrator, matching how authorisation is enforced across the
        system.
      </Callout>
    </div>
  );
}
