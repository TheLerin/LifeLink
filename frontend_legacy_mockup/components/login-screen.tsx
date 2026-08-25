"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  HeartPulse,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import {
  API_BASE_URL,
  demoAccounts,
  loginWithApi,
  makePreviewSession,
  readSession,
  roleLabels,
  saveSession,
} from "@/lib/lifelink";

export default function LoginScreen() {
  const [username, setUsername] = useState("admin.demo");
  const [password, setPassword] = useState("Demo@123");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [existing, setExisting] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setExisting(Boolean(readSession())), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const selected = useMemo(
    () => demoAccounts.find((account) => account.username === username)!,
    [username],
  );

  function enter(session = makePreviewSession(username)) {
    saveSession(session);
    window.location.assign("/dashboard");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      enter(await loginWithApi(username, password));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in.");
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand-panel" aria-label="LifeLink introduction">
        <div className="brand-mark brand-mark-large">
          <HeartPulse aria-hidden="true" />
        </div>
        <div>
          <p className="eyebrow eyebrow-on-dark">LIFELINK DBMS</p>
          <h1>Every unit tracked.<br />Every decision traceable.</h1>
          <p className="login-lede">
            One operational workspace for donors, blood inventory, emergency
            allocation, organ matching, and accountable care coordination.
          </p>
        </div>
        <div className="login-assurance-grid">
          <div><Database /><span><strong>PostgreSQL first</strong>Database-authoritative workflows</span></div>
          <div><ShieldCheck /><span><strong>Role protected</strong>Six scoped application roles</span></div>
          <div><Activity /><span><strong>Audit ready</strong>Traceable operational transitions</span></div>
        </div>
        <div className="login-proof">
          <div className="proof-dots"><span>DB</span><span>API</span><span>UI</span></div>
          <p><strong>70 API operations</strong><br />connected through one consistent shell</p>
        </div>
      </section>

      <section className="login-form-panel">
        <div className="mobile-login-brand">
          <div className="brand-mark"><HeartPulse /></div>
          <span>LifeLink</span>
        </div>
        <div className="login-card">
          <div className="login-heading">
            <p className="eyebrow">SECURE OPERATIONS PORTAL</p>
            <h2>Welcome back</h2>
            <p>Use a fictional coursework account to enter the role-aware workspace.</p>
          </div>

          {existing && (
            <button className="existing-session" onClick={() => window.location.assign("/dashboard")}>
              <CheckCircle2 /> Continue your current session <ArrowRight />
            </button>
          )}

          <form onSubmit={submit} className="login-form">
            <label>
              <span>Demo account</span>
              <div className="field-wrap">
                <UserRound aria-hidden="true" />
                <select value={username} onChange={(event) => setUsername(event.target.value)}>
                  {demoAccounts.map((account) => (
                    <option key={account.username} value={account.username}>
                      {account.username} — {roleLabels[account.role]}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <label>
              <span>Password</span>
              <div className="field-wrap">
                <LockKeyhole aria-hidden="true" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />
                <button type="button" className="icon-button field-action" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? <EyeOff /> : <Eye />}
                </button>
              </div>
            </label>

            {error && <div className="form-error" role="alert">{error}</div>}

            <button className="primary-button login-submit" type="submit" disabled={loading}>
              {loading ? "Connecting to API…" : "Sign in to LifeLink"}<ArrowRight />
            </button>
          </form>

          <div className="separator"><span>or review the interface</span></div>
          <button className="secondary-button preview-button" onClick={() => enter()}>
            Explore as {selected ? roleLabels[selected.role] : "Administrator"}
          </button>

          <div className="demo-note">
            <span>Development only</span>
            <p>Shared fictional password <code>Demo@123</code>. API target: <code>{API_BASE_URL}</code></p>
          </div>
        </div>
      </section>
    </main>
  );
}
