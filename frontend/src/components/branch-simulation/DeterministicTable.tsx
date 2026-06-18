import type { BranchSimulationReport } from "../../api/client";

interface DeterministicTableProps {
  report: BranchSimulationReport;
}

export default function DeterministicTable({ report }: DeterministicTableProps) {
  const rows = [
    {
      label: "影响章节范围",
      value: `第 ${report.affected_chapter_range[0]} - ${report.affected_chapter_range[1]} 章`,
      icon: "menu_book",
    },
    {
      label: "受影响角色",
      value: report.affected_characters.length > 0
        ? report.affected_characters.join("、")
        : "无",
      icon: "person",
    },
    {
      label: "受影响伏笔",
      value: report.affected_foreshadowings.length > 0
        ? report.affected_foreshadowings.join("、")
        : "无",
      icon: "visibility",
    },
    {
      label: "角色成长偏移",
      value: Object.keys(report.growth_curve_shifts).length > 0
        ? Object.entries(report.growth_curve_shifts)
            .map(([char, shift]) => `${char}: ${shift > 0 ? "+" : ""}${shift}章`)
            .join("、")
        : "无偏移",
      icon: "trending_up",
    },
    {
      label: "读者指标预测",
      value: Object.keys(report.reader_metrics_projection).length > 0
        ? Object.entries(report.reader_metrics_projection)
            .map(([metric, change]) => `${metric}: ${change}`)
            .join("、")
        : "无预测数据",
      icon: "psychology",
    },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-system-log text-lg">function</span>
        <h3 className="font-label-mono text-system-log uppercase tracking-wider text-sm">
          确定性分析
        </h3>
        <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 font-label-mono">
          零 LLM
        </span>
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-start gap-3 p-3 bg-surface-container rounded-lg"
          >
            <span className="material-symbols-outlined text-system-log text-lg mt-0.5 shrink-0">
              {row.icon}
            </span>
            <div className="min-w-0">
              <span className="font-label-mono text-xs text-system-log block">{row.label}</span>
              <p className="font-body-ui text-primary text-sm mt-0.5">{row.value}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
