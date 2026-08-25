/**
 * Page-state primitives: loading, empty, error and section scaffolding.
 *
 * Having these in one place means every screen reports trouble the same way -
 * and error states always show the backend's message plus the request_id, which
 * is what makes a 409 or a constraint violation debuggable during a demo.
 */

import { AlertTriangle, Info, Loader2, RefreshCw } from "./icons.js";

/** Inline spinner for buttons and small regions. */
export function Spinner({ className = "h-4 w-4" }) {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden="true" />;
}

/** Full-panel loading state. */
export function LoadingState({ label = "Loading…", className = "" }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 px-6 py-16 text-slate-500 ${className}`}
      role="status"
    >
      <Spinner className="h-6 w-6" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

/** Grey skeleton rows, used while a table's first page loads. */
export function TableSkeleton({ rows = 5, columns = 5 }) {
  return (
    <div className="divide-y divide-slate-100">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4 px-4 py-3.5">
          {Array.from({ length: columns }).map((__, colIndex) => (
            <div
              key={colIndex}
              className="h-4 flex-1 animate-pulse rounded bg-slate-100"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Nothing-to-show state, with an optional call to action. */
export function EmptyState({
  title = "Nothing to show yet",
  message,
  icon: Icon = Info,
  action,
  className = "",
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 px-6 py-16 text-center ${className}`}
    >
      <span className="mb-1 rounded-full bg-slate-100 p-3 text-slate-400">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {message ? (
        <p className="max-w-md text-sm text-slate-500">{message}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/**
 * Error state. Shows the backend's own message, its error code and the
 * request_id so the same failure can be found in the API log.
 */
export function ErrorState({ error, onRetry, className = "" }) {
  const message =
    error?.message || "Something went wrong while loading this data.";
  const code = error?.code;
  const requestId = error?.requestId;
  const fieldErrors = error?.fieldErrors ? error.fieldErrors() : {};
  const fieldEntries = Object.entries(fieldErrors);

  return (
    <div
      className={`m-4 rounded-lg border border-red-200 bg-red-50 p-4 ${className}`}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 h-5 w-5 shrink-0 text-red-600"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-red-900">{message}</p>

          {fieldEntries.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-sm text-red-800">
              {fieldEntries.map(([field, msg]) => (
                <li key={field}>
                  <span className="font-medium">{field}</span>: {msg}
                </li>
              ))}
            </ul>
          ) : null}

          {code || requestId ? (
            <p className="mt-2 font-mono text-xs text-red-700">
              {code ? code : null}
              {code && requestId ? " · " : null}
              {requestId ? `request ${requestId}` : null}
            </p>
          ) : null}

          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="ll-btn mt-3 border border-red-300 bg-white text-red-800 hover:bg-red-100"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Chooses between loading / error / empty / content for a data panel, so pages
 * don't repeat the same four-way branch.
 */
export function AsyncPanel({
  loading,
  error,
  isEmpty,
  onRetry,
  loadingFallback,
  emptyTitle,
  emptyMessage,
  emptyIcon,
  emptyAction,
  children,
}) {
  if (loading) return loadingFallback ?? <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (isEmpty) {
    return (
      <EmptyState
        title={emptyTitle}
        message={emptyMessage}
        icon={emptyIcon}
        action={emptyAction}
      />
    );
  }
  return children;
}

/** A titled white card used to group related content. */
export function Section({
  title,
  description,
  actions,
  children,
  className = "",
  bodyClassName = "",
}) {
  return (
    <section className={`ll-card ${className}`}>
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-sm text-slate-500">{description}</p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          ) : null}
        </header>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** A small notice band for context, caveats and academic disclaimers. */
export function Callout({ tone = "info", title, children, className = "" }) {
  const tones = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    danger: "border-red-200 bg-red-50 text-red-900",
    neutral: "border-slate-200 bg-slate-50 text-slate-700",
  };
  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm ${tones[tone] || tones.info} ${className}`}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? "mt-1" : ""}>{children}</div>
    </div>
  );
}
