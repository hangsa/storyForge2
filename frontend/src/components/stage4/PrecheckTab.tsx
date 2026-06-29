import type { PrecheckResult } from "../../api/client";
import { uiStrings } from "../../uiStrings";

interface PrecheckTabProps {
  data: PrecheckResult | null;
  loading: boolean;
  error: string | null;
}

export default function PrecheckTab({ data, loading, error }: PrecheckTabProps) {
  if (error) {
    return <div className="tab-error" role="alert">{uiStrings.errors.loadFailedPrefix}{error}</div>;
  }
  if (loading) {
    return <div className="tab-loading" aria-busy="true">…</div>;
  }
  if (!data || data.suggestions.length === 0) {
    if (data?.skipped_reason) {
      return <div className="tab-info">{uiStrings.precheck.skippedPrefix}{data.skipped_reason}</div>;
    }
    return <div className="tab-empty">{uiStrings.precheck.empty}</div>;
  }
  return (
    <ul className="precheck-suggestions" role="list">
      {data.suggestions.map((s, i) => (
        <li key={i} className="precheck-card">
          <span className="badge">{s.event_type}</span>
          <span className="location">@ {s.location_hint}</span>
          <p className="reason">{s.reason}</p>
        </li>
      ))}
    </ul>
  );
}
