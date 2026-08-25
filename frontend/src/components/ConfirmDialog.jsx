/**
 * ConfirmDialog - guards destructive or irreversible actions.
 *
 * Used before cancelling a reservation, issuing a unit, rejecting a match and
 * disabling a user account: all of them write audit rows that cannot be undone
 * from the UI.
 */

import Button from "./Button.jsx";
import Modal from "./Modal.jsx";
import { Callout } from "./States.jsx";

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = "Are you sure?",
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "danger",
  busy = false,
  error = null,
  children,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
      {children ? <div className={message ? "mt-4" : ""}>{children}</div> : null}
      {error ? (
        <Callout tone="danger" className="mt-4">
          {error.message}
          {error.requestId ? (
            <span className="mt-1 block font-mono text-xs opacity-80">
              request {error.requestId}
            </span>
          ) : null}
        </Callout>
      ) : null}
    </Modal>
  );
}
