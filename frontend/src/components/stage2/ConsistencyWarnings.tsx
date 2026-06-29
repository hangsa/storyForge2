import type { ConsistencyWarning } from "../../api/client";

interface Props {
  warnings: ConsistencyWarning[];
}

function severityRank(s: ConsistencyWarning["severity"]): number {
  return s === "error" ? 0 : 1;
}

export default function ConsistencyWarnings({ warnings }: Props) {
  if (warnings.length === 0) {
    return <p className="text-sm text-gray-500">暂无一致性警告</p>;
  }
  const sorted = [...warnings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  return (
    <ul className="space-y-2" aria-label="一致性检查结果">
      {sorted.map((w, i) => (
        <li
          key={`${w.rule_id}-${w.stage_index ?? "x"}-${i}`}
          data-severity={w.severity}
          className={
            w.severity === "error"
              ? "border border-red-300 bg-red-50 rounded p-2 text-sm"
              : "border border-yellow-300 bg-yellow-50 rounded p-2 text-sm"
          }
        >
          <span className="mr-2" aria-hidden="true">
            {w.severity === "error" ? "🔴" : "⚠️"}
          </span>
          <span>{w.message}</span>
          {w.suggestion && (
            <span className="block text-xs text-gray-600 mt-1">建议：{w.suggestion}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
