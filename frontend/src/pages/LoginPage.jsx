/**
 * LoginPage - the only public screen.
 *
 * A split layout: a navy brand panel on the left (blueprint section 28) and the
 * sign-in form on the right. The demo accounts seeded by 03_sample_data.sql are
 * offered as one-click fills so a marker can move through roles quickly. A live
 * health probe distinguishes "wrong password" from "backend isn't running".
 */

import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { pingApi } from "../api/client.js";
import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  ROLE_LABELS,
} from "../constants/lifelink.js";
import { TextField } from "../components/FormFields.jsx";
import Button from "../components/Button.jsx";
import { Callout } from "../components/States.jsx";
import { Droplets, Lock, ShieldCheck, UserRound } from "../components/icons.js";

export default function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [apiReachable, setApiReachable] = useState(null);

  const from = location.state?.from?.pathname || "/";

  // Probe the API once so we can warn early if the backend is down.
  useEffect(() => {
    let active = true;
    pingApi().then((result) => {
      if (active) setApiReachable(result.reachable);
    });
    return () => {
      active = false;
    };
  }, []);

  if (isAuthenticated) return <Navigate to={from} replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);

    if (!username.trim() || !password) {
      setFormError("Enter both a username and a password.");
      return;
    }

    setSubmitting(true);
    try {
      const user = await login(username.trim(), password);
      toast.success(
        `Signed in as ${ROLE_LABELS[user.role] || user.role}.`,
        `Welcome, ${user.full_name || user.username}`,
      );
      navigate(from, { replace: true });
    } catch (error) {
      if (error?.status === 0) {
        setFormError(
          "Could not reach the API. Start the backend (uvicorn app.main:app --reload) and try again.",
        );
      } else if (error?.status === 401) {
        setFormError("Incorrect username or password.");
      } else if (error?.status === 403) {
        setFormError(
          "This account cannot sign in — it may be disabled or locked. Ask an administrator.",
        );
      } else {
        setFormError(error?.message || "Sign-in failed. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function fillDemo(account) {
    setUsername(account.username);
    setPassword(DEMO_PASSWORD);
    setFormError(null);
  }

  return (
    <div className="flex min-h-screen bg-navy-950">
      {/* Brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-navy-900 p-10 text-white lg:flex">
        {/* Background video */}
        <video
          className="absolute inset-0 h-full w-full object-cover"
          src="/brand-bg.mp4"
          autoPlay
          muted
          loop
          playsInline
          poster="/brand-bg-poster.jpg"
        />
        {/* Navy/blood tint so the footage matches the theme instead of clashing */}
        <div className="absolute inset-0 bg-gradient-to-b from-navy-950/90 via-navy-900/85 to-navy-950/95" />
        <div className="absolute inset-0 bg-blood-900/10 mix-blend-multiply" />

        {/* Content sits above the video + overlay */}
        <div className="relative flex items-center gap-3">
          <span className="rounded-xl bg-blood-600 p-2.5">
            <Droplets className="h-7 w-7" aria-hidden="true" />
          </span>
          <div>
            <p className="text-2xl font-semibold">LifeLink</p>
            <p className="text-sm text-navy-100/70">
              Blood &amp; organ allocation and emergency coordination
            </p>
          </div>
        </div>

        <div className="relative max-w-md space-y-6">
          <h1 className="text-3xl font-semibold leading-tight">
            Coordinate donors, inventory and emergencies across hospitals.
          </h1>
          <ul className="space-y-3 text-navy-100/80">
            <li className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blood-400" aria-hidden="true" />
              Role-based access for six kinds of user, enforced end to end.
            </li>
            <li className="flex items-start gap-3">
              <Droplets className="mt-0.5 h-5 w-5 shrink-0 text-blood-400" aria-hidden="true" />
              Atomic blood reservation with first-expiry-first-out allocation.
            </li>
            <li className="flex items-start gap-3">
              <UserRound className="mt-0.5 h-5 w-5 shrink-0 text-blood-400" aria-hidden="true" />
              Academic Priority Scores rank organ candidates transparently.
            </li>
          </ul>
        </div>

        <p className="relative text-xs text-navy-100/40">
          College DBMS project · PostgreSQL · FastAPI · React. Fictional data
          only — not a medical device and not clinical guidance.
        </p>
      </div>

      {/* Sign-in form */}
      <div className="flex w-full items-center justify-center px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-6 lg:hidden">
            <div className="flex items-center gap-2.5">
              <span className="rounded-lg bg-blood-600 p-2 text-white">
                <Droplets className="h-6 w-6" aria-hidden="true" />
              </span>
              <p className="text-xl font-semibold text-white">LifeLink</p>
            </div>
          </div>

          <h2 className="text-xl font-semibold text-white">Sign in</h2>
          <p className="mt-1 text-sm text-navy-100/60">
            Use your LifeLink account, or pick a demo role below.
          </p>

          {apiReachable === false ? (
            <Callout tone="warning" className="mt-4">
              The API isn't responding yet. Start the backend with{" "}
              <code className="font-mono text-xs">uvicorn app.main:app --reload</code>{" "}
              from the <code className="font-mono text-xs">backend</code> folder.
            </Callout>
          ) : null}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <TextField
              name="username"
              label="Username"
              value={username}
              onChange={setUsername}
              placeholder="e.g. admin.demo"
              autoComplete="username"
              required
            />
            <TextField
              name="password"
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="Your password"
              autoComplete="current-password"
              required
            />

            {formError ? (
              <Callout tone="danger">{formError}</Callout>
            ) : null}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              loading={submitting}
              icon={Lock}
            >
              Sign in
            </Button>
          </form>

          <div className="mt-8">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-100/50">
              Demo accounts · password {DEMO_PASSWORD}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.username}
                  type="button"
                  onClick={() => fillDemo(account)}
                  className="rounded-md border border-navy-700 bg-navy-800 px-3 py-2 text-left transition-colors hover:border-blood-500/50 hover:bg-navy-700"
                >
                  <p className="text-xs font-semibold text-white">
                    {ROLE_LABELS[account.role]}
                  </p>
                  <p className="truncate text-xs text-navy-100/60">
                    {account.username}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
