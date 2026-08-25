/**
 * Authentication context.
 *
 * Holds the signed-in user, exposes login/logout, and reconciles the stored
 * session with the backend on first load. Because the client dispatches a
 * `lifelink:unauthorized` event whenever a request returns 401, this provider
 * can drop a dead session no matter which call triggered it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { endpoints } from "../api/endpoints.js";
import { UNAUTHORIZED_EVENT } from "../api/client.js";
import {
  clearSession,
  getStoredUser,
  getToken,
  saveSession,
} from "../api/session.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());
  // "loading" until we've checked any stored token against the backend.
  const [status, setStatus] = useState(() =>
    getToken() ? "loading" : "anonymous",
  );

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    setStatus("anonymous");
  }, []);

  const login = useCallback(async (username, password) => {
    const result = await endpoints.auth.login(username, password);
    saveSession(result.access_token, result.user);
    setUser(result.user);
    setStatus("authenticated");
    return result.user;
  }, []);

  // Revalidate a stored token once on mount: confirm it is still good and
  // refresh the user snapshot (role, status, last_login_at may have changed).
  useEffect(() => {
    if (status !== "loading") return;
    let cancelled = false;

    (async () => {
      try {
        const me = await endpoints.auth.me();
        if (cancelled) return;
        // Keep the existing token; just refresh the user fields.
        const token = getToken();
        if (token) saveSession(token, me);
        setUser(me);
        setStatus("authenticated");
      } catch {
        if (cancelled) return;
        // 401 already cleared storage via the client; make it explicit.
        clearSession();
        setUser(null);
        setStatus("anonymous");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status]);

  // Any 401 anywhere in the app ends the session.
  useEffect(() => {
    function handleUnauthorized() {
      setUser(null);
      setStatus("anonymous");
    }
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () =>
      window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      isAuthenticated: status === "authenticated",
      isLoading: status === "loading",
      login,
      logout,
    }),
    [user, status, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return context;
}
