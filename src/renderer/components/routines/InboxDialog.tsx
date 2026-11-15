import { X } from "lucide-react";
import type { InboxItem, InboxView } from "../../../shared/inbox";
import { formatRelativeTime } from "../../lib/format";
import { Modal } from "../ui/Modal";

type Props = {
  view: InboxView;
  onClose: () => void;
  onOpen: (item: InboxItem) => void;
  onSnooze: (item: InboxItem) => void;
};

export function InboxDialog({ view, onClose, onOpen, onSnooze }: Props) {
  return (
    <Modal label="Inbox" className="inbox-modal" onClose={onClose}>
      <header className="modal-header">
        <div className="modal-head-copy">
          <div className="modal-kicker">Fid Coder</div>
          <div className="modal-title">Inbox</div>
        </div>
        <button type="button" className="icon-button" aria-label="Close inbox" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <div className="inbox-body">
        {view.items.length === 0 ? <p className="field-note">Nothing is waiting.</p> : null}
        <div className="inbox-list">
          {view.items.map((item) => (
            <div className="inbox-row" key={item.id}>
              <button type="button" className="inbox-open" onClick={() => onOpen(item)}>
                <span className="inbox-title">{item.title}</span>
                <span className="inbox-meta">
                  {item.agentName} · {item.kind === "approval" ? "Approval" : item.kind === "turn" ? "Turn" : "Routine"} ·{" "}
                  {formatRelativeTime(item.createdAt)}
                </span>
                {item.body ? <span className="inbox-copy">{item.body}</span> : null}
              </button>
              {item.snoozeable ? (
                <button type="button" className="btn btn-quiet" onClick={() => onSnooze(item)}>
                  Snooze
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
