import GlassPanel from "./GlassPanel";

interface WritingFormulaItem {
  metric: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
}

interface WritingFormulaTableProps {
  compliance: WritingFormulaItem[];
  className?: string;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "--";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default function WritingFormulaTable({ compliance, className }: WritingFormulaTableProps) {
  if (compliance.length === 0) return null;

  return (
    <GlassPanel className={className}>
      <h3 className="text-sm font-medium text-white mb-3">写作公式合规</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-system-log/50 border-b border-outline-variant">
              <th className="pb-2 pr-4 font-medium">指标</th>
              <th className="pb-2 pr-4 font-medium">期望值</th>
              <th className="pb-2 pr-4 font-medium">实际值</th>
              <th className="pb-2 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {compliance.map((item, i) => (
              <tr key={i} className="border-b border-system-log/10">
                <td className="py-2 pr-4 text-system-log/80">{item.metric}</td>
                <td className="py-2 pr-4 text-system-log/50 font-mono">{formatValue(item.expected)}</td>
                <td className="py-2 pr-4 text-system-log/50 font-mono">{formatValue(item.actual)}</td>
                <td className="py-2">
                  <span className={`text-xs ${item.passed ? "text-emerald-400" : "text-red-400"}`}>
                    {item.passed ? "通过" : "未通过"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassPanel>
  );
}
