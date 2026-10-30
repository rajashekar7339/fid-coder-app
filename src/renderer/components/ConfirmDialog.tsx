import { useState, type ReactNode } from "react";
import { Trash2, X } from "lucide-react";
import { errorText } from "../fid";
import { Modal } from "./Modal";

type Props = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

export function ConfirmDialog({ title, description, confirmLabel, busyLabel, onCancel, onConfirm }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    if (!busy) onCancel();
  }

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (caught) {
      setError(errorText(caught));
      setBusy(false);
    }
  }

  return (
    <Modal label={title} className="confirm-modal" onClose={cancel}>
      <header className="modal-header">
        <div className="modal-head-copy">
          <div className="modal-kicker">Confirm action</div>
          <div className="modal-title">{title}</div>
        </div>
        <button type="button" className="icon-button" aria-label="Close confirmation" disabled={busy} onClick={cancel}>
          <X size={15} />
        </button>
      </header>

      <div className="confirm-body">
        <span className="confirm-icon" aria-hidden="true">
          <Trash2 size={17} />
        </span>
        <div>
          <p>{description}</p>
          <p className="confirm-warning">This cannot be undone.</p>
        </div>
      </div>

      {error ? (
        <p className="form-error confirm-error" role="alert">
          {error}
        </p>
      ) : null}

      <footer className="modal-footer">
        <span className="footer-spacer" />
        <button type="button" className="btn btn-quiet" autoFocus disabled={busy} onClick={cancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-destructive" disabled={busy} onClick={() => void confirm()}>
          {busy ? (busyLabel ?? "Deleting…") : confirmLabel}
        </button>
      </footer>
    </Modal>
  );
}
