import type { ImpactReport } from "../../hooks/useStage4Impact";
import { uiStrings } from "../../uiStrings";

interface ImpactTabProps {
  report: ImpactReport | null;
  loading: boolean;
  error: string | null;
  onRun: () => void;
  onViewFull: () => void;
}

function countByPriority(items: ImpactReport["items"]) {
  const counts = { P0: 0, P1: 0, P2: 0 };
  for (const i of items) counts[i.priority] += 1;
  return counts;
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
        <p>暂无影响分析报告</p>
        <button type="button" onClick={onRun}>{uiStrings.impact.run}</button>
      </div>
    );
  }
  const counts = countByPriority(report.items);
  const top = report.items.slice(0, uiStrings.impact.topCount);
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
