/**
 * Session storage.
 *
 * The JWT and the user object it was issued with are kept in localStorage so a
 * page refresh keeps you signed in. This is a college project running on
 * localhost; a production system would prefer an httpOnly cookie, and that
 * trade-off is documented in docs/10_testing.md.
 */

const TOKEN_KEY = "lifelink.token";
const USER_KEY = "lifelink.user";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(token, user) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* storage disabled - session simply won't persist across reloads */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}
