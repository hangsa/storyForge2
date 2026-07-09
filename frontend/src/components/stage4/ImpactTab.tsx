import type { ImpactReport, ImpactEntry } from "../../api/client";
import { uiStrings } from "../../uiStrings";

interface ImpactTabProps {
  report: ImpactReport | null;
  loading: boolean;
  error: string | null;
  onRun: () => void;
  onViewFull: () => void;
}

interface DisplayItem {
  priority: "P0" | "P1" | "P2";
  file: string;
  description: string;
}

function toDisplay(e: ImpactEntry): DisplayItem {
  const scenes = e.scene_numbers.length > 0 ? `:${e.scene_numbers.join(",")}` : "";
  return {
    priority: e.priority,
    file: `ch${e.chapter_number}${scenes}`,
    description: e.reason,
  };
}

export default function ImpactTab({ report, loading, error, onRun, onViewFull }: ImpactTabProps) {
  if (error) {
    return <div className="tab-error" role="alert">{uiStrings.errors.loadFailedPrefix}{error}</div>;
  }
  if (loading) {
    return (
      <div className="impact-tab" aria-busy="true">
        <div className="skeleton" />
      </div>
    );
  }
  if (!report) {
    return (
      <div className="impact-tab">
        <p>{uiStrings.impact.empty}</p>
        <button type="button" onClick={onRun}>{uiStrings.impact.run}</button>
      </div>
    );
  }
  const counts = report.summary;
  const top = report.entries.map(toDisplay).slice(0, uiStrings.impact.topCount);
  return (
    <div className="impact-tab">
      <div className="impact-counts">
        <span className="count-pill p0">P0 {counts.P0}</span>
        <span className="count-pill p1">P1 {counts.P1}</span>
        <span className="count-pill p2">P2 {counts.P2}</span>
      </div>
      <ul className="impact-top" role="list">
        {top.map((it, i) => (
          <li key={i} className="impact-item">
            <span className="priority">{it.priority}</span>
            <span className="file">{it.file}</span>
            <span className="desc">{it.description}</span>
          </li>
        ))}
      </ul>
      <div className="impact-actions">
        <button type="button" onClick={onRun}>{uiStrings.impact.rerun}</button>
        <button type="button" onClick={onViewFull}>{uiStrings.impact.viewFull}</button>
      </div>
    </div>
  );
}
