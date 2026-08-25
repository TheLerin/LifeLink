export type Role =
  | "ADMIN"
  | "DOCTOR"
  | "BLOOD_BANK_STAFF"
  | "ORGAN_BANK_STAFF"
  | "DONOR"
  | "RECIPIENT";

export type Session = {
  token: string | null;
  mode: "api" | "preview";
  user: {
    user_id: number;
    username: string;
    role: Role;
    full_name: string;
    status: string;
    blood_bank_name?: string | null;
    organ_bank_name?: string | null;
  };
};

export const SESSION_KEY = "lifelink.session.v1";
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
).replace(/\/$/, "");

export const roleLabels: Record<Role, string> = {
  ADMIN: "Administrator",
  DOCTOR: "Doctor",
  BLOOD_BANK_STAFF: "Blood bank staff",
  ORGAN_BANK_STAFF: "Organ bank staff",
  DONOR: "Donor",
  RECIPIENT: "Recipient",
};

export const demoAccounts: Array<{
  username: string;
  role: Role;
  name: string;
  initials: string;
}> = [
  { username: "admin.demo", role: "ADMIN", name: "Aarav Mehta", initials: "AM" },
  { username: "doctor.maya", role: "DOCTOR", name: "Dr. Maya Rao", initials: "MR" },
  {
    username: "blood.central",
    role: "BLOOD_BANK_STAFF",
    name: "Central Blood Bank",
    initials: "CB",
  },
  {
    username: "organ.hopebridge",
    role: "ORGAN_BANK_STAFF",
    name: "HopeBridge Organ Bank",
    initials: "HB",
  },
  { username: "donor.ananya", role: "DONOR", name: "Ananya Shah", initials: "AS" },
  { username: "recipient.isha", role: "RECIPIENT", name: "Isha Nair", initials: "IN" },
];

export function saveSession(session: Session) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function readSession(): Session | null {
  try {
    const value = window.localStorage.getItem(SESSION_KEY);
    return value ? (JSON.parse(value) as Session) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  window.localStorage.removeItem(SESSION_KEY);
}

export function makePreviewSession(username: string): Session {
  const account =
    demoAccounts.find((item) => item.username === username) ?? demoAccounts[0];
  return {
    token: null,
    mode: "preview",
    user: {
      user_id: 0,
      username: account.username,
      role: account.role,
      full_name: account.name,
      status: "ACTIVE",
      blood_bank_name:
        account.role === "BLOOD_BANK_STAFF" ? account.name : null,
      organ_bank_name:
        account.role === "ORGAN_BANK_STAFF" ? account.name : null,
    },
  };
}

export async function loginWithApi(username: string, password: string) {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload?.detail?.message ??
      payload?.detail ??
      payload?.message ??
      "Sign-in failed. Check the API and credentials.";
    throw new Error(typeof message === "string" ? message : "Sign-in failed.");
  }

  return {
    token: payload.access_token,
    mode: "api",
    user: {
      ...payload.user,
      full_name: payload.user.full_name ?? payload.user.username,
    },
  } as Session;
}
