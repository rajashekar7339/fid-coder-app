import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
};

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function Modal({ label, onClose, children, className }: Props) {
  const panel = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);

  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const element = panel.current;
      if (element && !element.contains(document.activeElement)) element.focus();
    });

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close.current();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || active === panel.current || !panel.current.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, []);

  return (
    <div className="modal-overlay">
      <div className="modal-backdrop" aria-hidden="true" onClick={onClose} />
      <section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`modal ${className ?? ""}`}
      >
        {children}
      </section>
    </div>
  );
}
