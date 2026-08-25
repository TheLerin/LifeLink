/**
 * Toast notifications.
 *
 * A tiny queue for transient feedback ("Unit reserved", "Login failed"). Kept
 * dependency-free: one provider, one hook, auto-dismiss with a manual close.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

const ToastContext = createContext(null);

let nextId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (toast) => {
      const id = ++nextId;
      const entry = {
        id,
        tone: toast.tone || "info",
        title: toast.title || "",
        message: toast.message || "",
      };
      setToasts((current) => [...current, entry]);
      const ttl = toast.duration ?? 4500;
      if (ttl > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), ttl),
        );
      }
      return id;
    },
    [dismiss],
  );

  const helpers = useMemo(
    () => ({
      push,
      dismiss,
      success: (message, title = "Done") => push({ tone: "success", title, message }),
      error: (message, title = "Something went wrong") =>
        push({ tone: "error", title, message, duration: 7000 }),
      info: (message, title = "") => push({ tone: "info", title, message }),
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={helpers}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const TONE_STYLES = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  error: "border-red-200 bg-red-50 text-red-900",
  info: "border-sky-200 bg-sky-50 text-sky-900",
};

function ToastViewport({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`pointer-events-auto rounded-lg border px-4 py-3 shadow-md ${
            TONE_STYLES[toast.tone] || TONE_STYLES.info
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {toast.title ? (
                <p className="text-sm font-semibold">{toast.title}</p>
              ) : null}
              {toast.message ? (
                <p className="mt-0.5 break-words text-sm">{toast.message}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="-mr-1 -mt-1 rounded p-1 text-lg leading-none opacity-60 hover:opacity-100"
              aria-label="Dismiss notification"
            >
              &times;
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside a ToastProvider");
  }
  return context;
}
