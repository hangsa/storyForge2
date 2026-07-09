import { useState } from "react";
import type { SFLogDiffReport, SFLogSuggestion } from "../../api/client";
import { uiStrings } from "../../uiStrings";

interface SFLogSuggestionsTabProps {
  data: SFLogDiffReport | null;
  loading: boolean;
  error: string | null;
  onApply: (suggestions: SFLogSuggestion[]) => Promise<void>;
  onDismiss: () => void;
}

export default function SFLogSuggestionsTab({ data, loading, error, onApply, onDismiss }: SFLogSuggestionsTabProps) {
  const [applying, setApplying] = useState(false);

  if (error) {
    return <div className="tab-error" role="alert">{uiStrings.errors.loadFailedPrefix}{error}</div>;
  }
  if (loading) {
    return <div className="tab-loading" aria-busy="true">…</div>;
  }
  if (!data) {
    return <div className="tab-empty">{uiStrings.sfLog.empty}</div>;
  }

  const handleApply = async (suggestions: SFLogSuggestion[]) => {
    if (applying) return;
    setApplying(true);
    try { await onApply(suggestions); } finally { setApplying(false); }
  };

  return (
    <div className="sf-suggestions">
      <section className="deleted-section">
        <h3>{uiStrings.sfLog.deletedSection}</h3>
        <ul role="list">
          {data.deleted_logs.map((d, i) => (
            <li key={i}><code>{d.raw_text}</code></li>
          ))}
        </ul>
      </section>
      <section className="suggested-section">
        <h3>{uiStrings.sfLog.suggestedSection}</h3>
        {data.suggestions.length > 0 && (
          <button type="button" onClick={() => handleApply(data.suggestions)} disabled={applying}>
            {applying ? "…" : uiStrings.sfLog.insertAll}
          </button>
        )}
        <ul role="list">
          {data.suggestions.map((s, i) => (
            <li key={i} className="suggestion-card">
              <span className="badge">{s.event_type}</span>
              <p className="reason">{s.reason}</p>
              <code className="tag">{s.suggested_tag}</code>
              <button type="button" onClick={() => handleApply([s])} disabled={applying}>
                {applying ? "…" : uiStrings.sfLog.insertOne}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <div className="tab-actions">
        <button type="button" onClick={onDismiss} disabled={applying}>忽略</button>
      </div>
    </div>
  );
}
