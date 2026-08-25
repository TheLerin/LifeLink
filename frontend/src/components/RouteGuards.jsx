/**
 * Route guards.
 *
 * ProtectedRoute keeps unauthenticated users at the login screen and remembers
 * where they were headed. RoleRoute additionally refuses roles the backend
 * would 403 anyway, turning a dead-end API error into a clean "not authorised"
 * screen. Neither is a security boundary - the API and database are - but they
 * keep the UI honest.
 */

import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { LoadingState } from "./States.jsx";
import { PageHeader } from "./Layout.jsx";
import { Callout } from "./States.jsx";
import { Lock } from "./icons.js";

export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <LoadingState label="Restoring your session…" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

/** Wrap routes that only some roles may open. */
export function RoleRoute({ allow }) {
  const { user } = useAuth();

  if (user && allow && !allow.includes(user.role)) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Not authorised"
          icon={Lock}
          description="Your role does not have access to this section."
        />
        <Callout tone="warning" title="Access restricted">
          This page is limited to specific roles. If you believe you should have
          access, an administrator can adjust your account. Every screen mirrors
          the permissions enforced by the API and the database.
        </Callout>
      </div>
    );
  }

  return <Outlet />;
}
