/**
 * Lookup hooks for form dropdowns.
 *
 * Hospitals, blood banks and organ banks are readable by any signed-in user, so
 * they can safely back a <select> for every role. Donor and recipient lookups
 * are role-restricted, so those hooks accept `enabled` and the caller passes the
 * result of a role check - otherwise a DOCTOR opening a form would trigger a 403
 * for a list they never see.
 */

import { useMemo } from "react";
import { endpoints } from "../api/endpoints.js";
import { useApi } from "./useApi.js";

/** Turn a list into [{ value, label }] for SelectField. */
function toOptions(rows, idKey, labelFn) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({ value: row[idKey], label: labelFn(row) }));
}

export function useHospitalOptions({ activeOnly = true } = {}) {
  const { data, loading, error } = useApi(
    () => endpoints.hospitals.list(activeOnly ? { status: "ACTIVE" } : undefined),
    [activeOnly],
  );
  const options = useMemo(
    () => toOptions(data, "hospital_id", (row) => row.name),
    [data],
  );
  return { options, rows: data || [], loading, error };
}

export function useBloodBankOptions({ activeOnly = true } = {}) {
  const { data, loading, error } = useApi(
    () => endpoints.bloodBanks.list(activeOnly ? { status: "ACTIVE" } : undefined),
    [activeOnly],
  );
  const options = useMemo(
    () => toOptions(data, "blood_bank_id", (row) => row.name),
    [data],
  );
  return { options, rows: data || [], loading, error };
}

export function useOrganBankOptions({ activeOnly = true } = {}) {
  const { data, loading, error } = useApi(
    () => endpoints.organBanks.list(activeOnly ? { status: "ACTIVE" } : undefined),
    [activeOnly],
  );
  const options = useMemo(
    () => toOptions(data, "organ_bank_id", (row) => row.name),
    [data],
  );
  return { options, rows: data || [], loading, error };
}

/** Scheduled camps only - you cannot collect at a cancelled or finished camp. */
export function useCampOptions() {
  const { data, loading, error } = useApi(
    () => endpoints.camps.list({ status: "SCHEDULED" }),
    [],
  );
  const options = useMemo(
    () =>
      toOptions(
        data,
        "camp_id",
        (row) => `${row.organizer} · ${row.camp_date}`,
      ),
    [data],
  );
  return { options, rows: data || [], loading, error };
}

/**
 * Donor picker options. Restricted list, so `enabled` must reflect the caller's
 * role. Fetches a large page because a <select> cannot paginate; the backend
 * caps page_size at 100.
 */
export function useDonorOptions({ enabled = true, activeOnly = true } = {}) {
  const { data, loading, error } = useApi(
    () => endpoints.donors.list({ page_size: 100 }),
    [],
    { enabled },
  );

  const options = useMemo(() => {
    const rows = Array.isArray(data?.items) ? data.items : [];
    const filtered = activeOnly ? rows.filter((row) => row.is_active) : rows;
    return filtered.map((row) => ({
      value: row.donor_id,
      label: `#${row.donor_id} · ${row.full_name} · ${row.blood_group}`,
    }));
  }, [data, activeOnly]);

  return { options, rows: data?.items || [], loading, error };
}

export function useRecipientOptions({ enabled = true, activeOnly = true } = {}) {
  const { data, loading, error } = useApi(
    () =>
      endpoints.recipients.list(
        activeOnly ? { page_size: 100, status: "ACTIVE" } : { page_size: 100 },
      ),
    [activeOnly],
    { enabled },
  );

  const options = useMemo(() => {
    const rows = Array.isArray(data?.items) ? data.items : [];
    return rows.map((row) => ({
      value: row.recipient_id,
      label: `#${row.recipient_id} · ${row.full_name} · ${row.blood_group}`,
    }));
  }, [data]);

  return { options, rows: data?.items || [], loading, error };
}

export function useDoctorOptions({ enabled = true } = {}) {
  const { data, loading, error } = useApi(
    () => endpoints.doctors.list({ page_size: 100 }),
    [],
    { enabled },
  );

  const options = useMemo(() => {
    const rows = Array.isArray(data?.items) ? data.items : [];
    return rows.map((row) => ({
      value: row.doctor_id,
      label: `#${row.doctor_id} · ${row.full_name} · ${row.specialization}`,
    }));
  }, [data]);

  return { options, rows: data?.items || [], loading, error };
}
