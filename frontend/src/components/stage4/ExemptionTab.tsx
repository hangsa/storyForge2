import type { ExemptionRequest } from "../../api/client";
import { uiStrings } from "../../uiStrings";
import ExemptionCard from "./ExemptionCard";

interface ExemptionTabProps {
  items: ExemptionRequest[];
  loading: boolean;
  error: string | null;
  onSelect: (item: ExemptionRequest) => void;
  onRefresh: () => void;
}

export default function ExemptionTab({ items, loading, error, onSelect, onRefresh }: ExemptionTabProps) {
  if (error) {
    return <div className="tab-error" role="alert">{uiStrings.errors.loadFailedPrefix}{error}</div>;
  }
  if (loading) {
    return <div className="tab-loading" aria-busy="true">…</div>;
  }
  if (items.length === 0) {
    return (
      <div className="tab-empty">
        <p>{uiStrings.exemption.empty}</p>
        <button type="button" onClick={onRefresh}>{uiStrings.exemption.refresh}</button>
      </div>
    );
  }
  return (
    <ul className="exemption-list" role="list">
      {items.map((item) => (
        <li key={item.id}>
          <ExemptionCard item={item} onClick={() => onSelect(item)} />
        </li>
      ))}
    </ul>
  );
}
