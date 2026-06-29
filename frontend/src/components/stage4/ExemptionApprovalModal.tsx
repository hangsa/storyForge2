import { useEffect, useRef, useState, useCallback } from "react";
import type { ExemptionRequest, ExemptionAntipattern } from "../../api/client";
import { uiStrings } from "../../uiStrings";

interface ExemptionApprovalModalProps {
  item: ExemptionRequest;
  onFetchAntipatterns: (id: string) => Promise<ExemptionAntipattern[]>;
  onApprove: () => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  onClose: () => void;
}

export default function ExemptionApprovalModal({
  item,
  onFetchAntipatterns,
  onApprove,
  onReject,
  onClose,
}: ExemptionApprovalModalProps) {
  const [antipatterns, setAntipatterns] = useState<ExemptionAntipattern[] | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstBtnRef = useRef<HTMLButtonElement>(null);

  // Fetch antipatterns on mount. Errors are non-blocking.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await onFetchAntipatterns(item.id);
        if (!cancelled) setAntipatterns(list);
      } catch (e) {
        console.warn("antipatterns fetch failed", e);
        if (!cancelled) setAntipatterns([]);
      }
    })();
    return () => { cancelled = true; };
  }, [item.id, onFetchAntipatterns]);

  // Focus the first button on open.
  useEffect(() => { firstBtnRef.current?.focus(); }, []);

  // Escape key handling.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (rejectMode && reason.length > 0) {
        if (!window.confirm("放弃未保存的拒绝原因？")) return;
      }
      onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, rejectMode, reason]);

  // Focus trap: cycle Tab within the modal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const handleApprove = useCallback(async () => {
    setSubmitting(true);
    try { await onApprove(); } finally { setSubmitting(false); }
  }, [onApprove]);

  const handleReject = useCallback(async () => {
    if (!reason.trim()) return;
    setSubmitting(true);
    try { await onReject(reason.trim()); } finally { setSubmitting(false); }
  }, [onReject, reason]);

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="exemption-modal-title"
        className="modal-panel"
      >
        <h2 id="exemption-modal-title" className="modal-title">
          {item.rule_to_break.rule_description}
        </h2>
        <span className="badge">{item.rule_to_break.layer} · {item.rule_to_break.constraint_type}</span>
        <section className="modal-section">
          <h3>创意意图</h3>
          <p>{item.creative_intent}</p>
        </section>
        <section className="modal-section">
          <h3>预期效果</h3>
          <p>{item.expected_effect}</p>
        </section>
        {antipatterns && antipatterns.length > 0 && (
          <section className="modal-section">
            <h3>类似意图历史</h3>
            <p className="warning">{uiStrings.exemption.antipatternWarning(antipatterns[0].count)}</p>
            <ul role="list">
              {antipatterns.map((a, i) => (
                <li key={i}><code>{a.representative_case}</code></li>
              ))}
            </ul>
          </section>
        )}
        {antipatterns === null && (
          <section className="modal-section"><p>{uiStrings.exemption.antipatternLoading}</p></section>
        )}
        <div className="modal-actions">
          {!rejectMode ? (
            <>
              <button ref={firstBtnRef} type="button" onClick={handleApprove} disabled={submitting}>
                {uiStrings.exemption.approve}
              </button>
              <button type="button" onClick={() => setRejectMode(true)} disabled={submitting}>
                {uiStrings.exemption.reject}
              </button>
            </>
          ) : (
            <>
              <label>
                {uiStrings.exemption.rejectReasonLabel}
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  autoFocus
                />
              </label>
              <button type="button" onClick={handleReject} disabled={submitting || !reason.trim()}>
                确认拒绝
              </button>
              <button type="button" onClick={() => { setRejectMode(false); setReason(""); }} disabled={submitting}>
                取消
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
