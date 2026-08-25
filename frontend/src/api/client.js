/**
 * LifeLink HTTP client.
 *
 * One place that knows how to talk to the FastAPI backend:
 *   - prefixes every path with the API base (default: same-origin via the Vite
 *     dev proxy, so development needs no CORS setup),
 *   - attaches `Authorization: Bearer <jwt>` when a session exists,
 *   - unwraps the backend's `{ "error": { code, message, details, request_id } }`
 *     envelope into a single ApiError the UI can render,
 *   - broadcasts a 401 so the auth layer can sign the user out cleanly.
 */

import { clearSession, getToken } from "./session.js";

/**
 * Empty by default, which means requests go to the current origin and are
 * forwarded by the Vite proxy (see vite.config.js). Set VITE_API_BASE_URL to an
 * absolute origin when the built frontend is served separately from the API.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

/** The backend mounts every router under this prefix (settings.api_prefix). */
export const API_PREFIX = "/api";

export const UNAUTHORIZED_EVENT = "lifelink:unauthorized";

export class ApiError extends Error {
  constructor({ status, code, message, details, requestId }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code || "ERROR";
    this.details = details ?? null;
    this.requestId = requestId ?? null;
  }

  /** True when the failure is the user's input rather than a system fault. */
  get isValidation() {
    return this.status === 400 || this.status === 422;
  }

  /** True when another user won the race - e.g. a unit was reserved first. */
  get isConflict() {
    return this.status === 409;
  }

  get isForbidden() {
    return this.status === 403;
  }

  get isNotFound() {
    return this.status === 404;
  }

  /**
   * Field-level messages, if the backend sent FastAPI/Pydantic validation
   * details. Returns `{ fieldName: "message" }`.
   */
  fieldErrors() {
    const out = {};
    const details = this.details;
    if (!details) return out;

    const entries = Array.isArray(details)
      ? details
      : Array.isArray(details.errors)
        ? details.errors
        : null;
    if (!entries) return out;

    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const loc = Array.isArray(entry.loc) ? entry.loc : [];
      // Skip the "body"/"query" prefix that FastAPI adds.
      const field = loc.filter((part) => typeof part === "string").pop();
      if (field && entry.msg) out[field] = entry.msg;
    }
    return out;
  }
}

function buildUrl(path, params) {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const url = `${API_BASE}${API_PREFIX}${suffix}`;
  if (!params) return url;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null && item !== "") {
          search.append(key, String(item));
        }
      });
    } else {
      search.append(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `${url}?${query}` : url;
}

const FRIENDLY_STATUS = {
  400: "That request could not be accepted. Please check the values and try again.",
  401: "Your session has expired. Please sign in again.",
  403: "Your role does not have permission to do that.",
  404: "That record could not be found.",
  409: "Someone else changed this record first. Reload and try again.",
  422: "Some fields need attention.",
  500: "The server hit an unexpected error. Check the backend logs.",
  503: "The service is not ready yet. Is PostgreSQL running?",
};

async function parseError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    /* non-JSON body (proxy error page, empty 502, ...) */
  }

  // Preferred shape: the project's own error envelope.
  const envelope = payload && typeof payload === "object" ? payload.error : null;
  if (envelope && typeof envelope === "object") {
    return new ApiError({
      status: response.status,
      code: envelope.code,
      message: envelope.message || FRIENDLY_STATUS[response.status] || response.statusText,
      details: envelope.details,
      requestId: envelope.request_id,
    });
  }

  // Fallback: a bare FastAPI HTTPException / RequestValidationError.
  const detail = payload && typeof payload === "object" ? payload.detail : null;
  const message =
    typeof detail === "string"
      ? detail
      : FRIENDLY_STATUS[response.status] ||
        response.statusText ||
        `Request failed with status ${response.status}`;

  return new ApiError({
    status: response.status,
    code: `HTTP_${response.status}`,
    message,
    details: Array.isArray(detail) ? detail : null,
    requestId: null,
  });
}

/**
 * Core request helper.
 *
 * @param {string} path        API path without the /api prefix, e.g. "/donors"
 * @param {object} [options]
 * @param {string} [options.method="GET"]
 * @param {object} [options.body]     JSON-serialised automatically
 * @param {object} [options.params]   query string values; blanks are dropped
 * @param {boolean} [options.auth=true]
 * @param {AbortSignal} [options.signal]
 */
export async function request(path, options = {}) {
  const {
    method = "GET",
    body,
    params,
    auth = true,
    signal,
  } = options;

  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(buildUrl(path, params), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if (cause?.name === "AbortError") throw cause;
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message:
        "Could not reach the LifeLink API. Start the backend with " +
        "`uvicorn app.main:app --reload` and try again.",
    });
  }

  if (response.status === 401) {
    const error = await parseError(response);
    // Drop the dead token and let AuthContext react.
    clearSession();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    throw error;
  }

  if (!response.ok) throw await parseError(response);

  if (response.status === 204) return null;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return await response.text();
  return await response.json();
}

export const api = {
  get: (path, params, options) => request(path, { ...options, params }),
  post: (path, body, options) => request(path, { ...options, method: "POST", body }),
  patch: (path, body, options) => request(path, { ...options, method: "PATCH", body }),
  put: (path, body, options) => request(path, { ...options, method: "PUT", body }),
  del: (path, options) => request(path, { ...options, method: "DELETE" }),
};

/**
 * Health check that bypasses the /api prefix helpers, used by the login screen
 * to tell "wrong password" apart from "backend is not running".
 */
export async function pingApi() {
  try {
    const response = await fetch(`${API_BASE}${API_PREFIX}/health`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return { reachable: true, healthy: false };
    const payload = await response.json().catch(() => null);
    return { reachable: true, healthy: true, payload };
  } catch {
    return { reachable: false, healthy: false };
  }
}
