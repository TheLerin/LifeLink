/**
 * Endpoint catalogue.
 *
 * Every function here corresponds to exactly one FastAPI operation. Grouping
 * them in one file means:
 *   - page code reads like the domain ("endpoints.donors.list(...)"),
 *   - the full backend surface is visible in one place,
 *   - a path or query-param change touches one line, not many.
 *
 * Paths and roles were taken from backend/app/routes/*.py. The api_prefix
 * (/api) is added by the client, so paths here start after it.
 */

import { api } from "./client.js";

export const endpoints = {
  auth: {
    login: (username, password) =>
      api.post("/auth/login", { username, password }, { auth: false }),
    me: () => api.get("/auth/me"),
  },

  donors: {
    list: (params) => api.get("/donors", params),
    create: (body) => api.post("/donors", body),
    get: (id) => api.get(`/donors/${id}`),
    update: (id, body) => api.patch(`/donors/${id}`, body),
    donations: (id, params) => api.get(`/donors/${id}/donations`, params),
    conditions: (id, params) => api.get(`/donors/${id}/conditions`, params),
  },

  recipients: {
    list: (params) => api.get("/recipients", params),
    create: (body) => api.post("/recipients", body),
    get: (id) => api.get(`/recipients/${id}`),
    update: (id, body) => api.patch(`/recipients/${id}`, body),
    requests: (id, params) => api.get(`/recipients/${id}/requests`, params),
  },

  doctors: {
    list: (params) => api.get("/doctors", params),
    create: (body) => api.post("/doctors", body),
    get: (id) => api.get(`/doctors/${id}`),
    update: (id, body) => api.patch(`/doctors/${id}`, body),
  },

  hospitals: {
    list: (params) => api.get("/hospitals", params),
    create: (body) => api.post("/hospitals", body),
    get: (id) => api.get(`/hospitals/${id}`),
  },

  bloodBanks: {
    list: (params) => api.get("/blood-banks", params),
    create: (body) => api.post("/blood-banks", body),
    get: (id) => api.get(`/blood-banks/${id}`),
  },

  organBanks: {
    list: (params) => api.get("/organ-banks", params),
    create: (body) => api.post("/organ-banks", body),
    get: (id) => api.get(`/organ-banks/${id}`),
  },

  donations: {
    list: (params) => api.get("/donations", params),
    get: (id) => api.get(`/donations/${id}`),
    createBlood: (body) => api.post("/donations/blood", body),
    createOrgan: (body) => api.post("/donations/organ", body),
    tests: (id, params) => api.get(`/donations/${id}/tests`, params),
    addTest: (id, body) => api.post(`/donations/${id}/tests`, body),
  },

  bloodUnits: {
    list: (params) => api.get("/blood-units", params),
    get: (id) => api.get(`/blood-units/${id}`),
    setStatus: (id, status) => api.patch(`/blood-units/${id}/status`, { status }),
    timeline: (id) => api.get(`/blood-units/${id}/timeline`),
  },

  emergencyRequests: {
    list: (params) => api.get("/emergency-requests", params),
    create: (body) => api.post("/emergency-requests", body),
    get: (id) => api.get(`/emergency-requests/${id}`),
    update: (id, body) => api.patch(`/emergency-requests/${id}`, body),
    /**
     * Atomic server-side reservation. The frontend NEVER sets a unit to
     * RESERVED itself - this endpoint makes PostgreSQL lock the row, run FEFO
     * allocation and write the audit entry in one transaction.
     */
    reserve: (id, holdMinutes = 120) =>
      api.post(`/emergency-requests/${id}/reserve`, { hold_minutes: holdMinutes }),
  },

  reservations: {
    list: (params) => api.get("/reservations", params),
    get: (id) => api.get(`/reservations/${id}`),
    cancel: (id, body) => api.post(`/reservations/${id}/cancel`, body ?? {}),
    issue: (id, body) => api.post(`/reservations/${id}/issue`, body ?? {}),
  },

  organs: {
    list: (params) => api.get("/organs", params),
    create: (body) => api.post("/organs", body),
    get: (id) => api.get(`/organs/${id}`),
    calculateMatches: (id, candidates) =>
      api.post(`/organs/${id}/calculate-matches`, { candidates }),
    matches: (id, params) => api.get(`/organs/${id}/matches`, params),
  },

  organMatches: {
    setStatus: (id, status) =>
      api.patch(`/organ-matches/${id}/status`, { status }),
  },

  camps: {
    list: (params) => api.get("/camps", params),
    create: (body) => api.post("/camps", body),
    get: (id) => api.get(`/camps/${id}`),
    register: (id, donorId) =>
      api.post(`/camps/${id}/register`, { donor_id: donorId }),
  },

  reports: {
    bloodInventory: (params) => api.get("/reports/blood-inventory", params),
    expiringUnits: (params) => api.get("/reports/expiring-units", params),
    emergencySummary: (params) => api.get("/reports/emergency-summary", params),
    donationTrends: (params) => api.get("/reports/donation-trends", params),
    reservations: (params) => api.get("/reports/reservations", params),
    organMatches: (params) => api.get("/reports/organ-matches", params),
    hospitalResponseTime: (params) =>
      api.get("/reports/hospital-response-time", params),
  },

  audit: {
    list: (params) => api.get("/audit", params),
  },

  users: {
    list: (params) => api.get("/users", params),
    create: (body) => api.post("/users", body),
    update: (id, body) => api.patch(`/users/${id}`, body),
    setStatus: (id, status) => api.patch(`/users/${id}/status`, { status }),
  },
};

/** Map the report slug used in the URL to its fetch function. */
export const REPORT_FETCHERS = {
  "blood-inventory": endpoints.reports.bloodInventory,
  "expiring-units": endpoints.reports.expiringUnits,
  "emergency-summary": endpoints.reports.emergencySummary,
  "donation-trends": endpoints.reports.donationTrends,
  reservations: endpoints.reports.reservations,
  "organ-matches": endpoints.reports.organMatches,
  "hospital-response-time": endpoints.reports.hospitalResponseTime,
};
