import { useEffect, useState } from "react";
import type { Fact } from "../../../shared/types";
import { errorText, fid } from "../../lib/fid";
import { Switch } from "../ui/Switch";

type Props = {
  agentId: string;
};

export function FactList({ agentId }: Props) {
  const [facts, setFacts] = useState<Fact[] | null>(null);
  const [draft, setDraft] = useState("");
  const [shared, setShared] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmForget, setConfirmForget] = useState<string | null>(null);
  const [undo, setUndo] = useState<Fact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setFacts(null);
    setError(null);
    setUndo(null);
    void fid()
      .facts.list(agentId)
      .then((rows) => {
        if (!cancel) setFacts(rows);
      })
      .catch((caught: unknown) => {
        if (!cancel) setError(errorText(caught));
      });
    return () => {
      cancel = true;
    };
  }, [agentId]);

  async function refresh() {
    setFacts(await fid().facts.list(agentId));
  }

  async function add() {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    setUndo(null);
    try {
      await fid().facts.create({ agentId, content, shared, enabled: true });
      setDraft("");
      setShared(false);
      await refresh();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(fact: Fact) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setUndo(null);
    try {
      await fid().facts.update(fact.id, { content: editText });
      setEditingId(null);
      await refresh();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(fact: Fact, enabled: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setUndo(null);
    try {
      await fid().facts.update(fact.id, { enabled });
      await refresh();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function forget(fact: Fact) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fid().facts.delete(fact.id);
      setEditingId(null);
      setConfirmForget(null);
      setUndo(fact);
      await refresh();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!undo || busy) return;
    setBusy(true);
    setError(null);
    try {
      await fid().facts.create({
        agentId,
        content: undo.content,
        shared: undo.agentId === null,
        enabled: undo.enabled,
      });
      setUndo(null);
      await refresh();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field facts-field">
      <span className="field-label">Facts</span>
      <span className="field-note">Data, not instructions. The current message wins.</span>
      {facts === null && !error ? (
        <span className="field-note" role="status">
          Loading facts…
        </span>
      ) : null}
      {facts && facts.length > 0 ? (
        <ul className="fact-list">
          {facts.map((fact) => {
            const editing = editingId === fact.id;
            return (
              <li className="fact-row" key={fact.id}>
                {editing ? (
                  <input
                    className="input fact-input"
                    value={editText}
                    aria-label="Fact text"
                    disabled={busy}
                    onChange={(event) => setEditText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveEdit(fact);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="fact-text"
                    onClick={() => {
                      setEditingId(fact.id);
                      setEditText(fact.content);
                      setConfirmForget(null);
                    }}
                  >
                    {fact.content}
                    {fact.agentId === null ? <span className="fact-shared">Shared</span> : null}
                  </button>
                )}
                {editing ? (
                  <span className="fact-actions">
                    {confirmForget === fact.id ? (
                      <button type="button" className="text-button" disabled={busy} onClick={() => void forget(fact)}>
                        Forget it
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => setConfirmForget(fact.id)}
                      >
                        Forget
                      </button>
                    )}
                    <button type="button" className="text-button" disabled={busy} onClick={() => void saveEdit(fact)}>
                      Save
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(null);
                        setConfirmForget(null);
                      }}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <Switch
                    checked={fact.enabled}
                    disabled={busy}
                    label={`Enabled: ${fact.content}`}
                    onChange={(enabled) => void toggle(fact, enabled)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="fact-add">
        <input
          className="input fact-input"
          value={draft}
          placeholder="Add a fact"
          aria-label="Add a fact"
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void add();
            }
          }}
        />
        <label className="fact-share">
          <input
            type="checkbox"
            checked={shared}
            disabled={busy}
            onChange={(event) => setShared(event.target.checked)}
          />
          Shared with all agents
        </label>
        <button type="button" className="btn btn-quiet" disabled={busy || !draft.trim()} onClick={() => void add()}>
          Add
        </button>
      </div>
      {undo ? (
        <span className="field-note" role="status">
          Forgotten.{" "}
          <button type="button" className="text-button" disabled={busy} onClick={() => void restore()}>
            Undo
          </button>
        </span>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
