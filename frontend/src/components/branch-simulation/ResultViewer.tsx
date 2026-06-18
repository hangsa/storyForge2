import type { BranchSimulationReport } from "../../api/client";
import DeterministicTable from "./DeterministicTable";
import ConfidenceBadge from "./ConfidenceBadge";
import GlassPanel from "../shared/GlassPanel";

interface ResultViewerProps {
  report: BranchSimulationReport | null;
}

function InferenceCard({
  label,
  icon,
  item,
}: {
  label: string;
  icon: string;
  item: { content: string; confidence: "medium" | "low" } | null;
}) {
  return (
    <GlassPanel>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-system-log text-sm">{icon}</span>
          <span className="font-label-mono text-system-log text-xs">{label}</span>
        </div>
        {item && <ConfidenceBadge confidence={item.confidence} />}
      </div>
      {item ? (
        <p className="font-body-narrative text-primary text-sm leading-relaxed">{item.content}</p>
      ) : (
        <p className="font-body-ui text-system-log/50 text-sm">无推理结果</p>
      )}
    </GlassPanel>
  );
}

export default function ResultViewer({ report }: ResultViewerProps) {
  if (!report) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <span className="material-symbols-outlined text-5xl text-system-log/10 block mb-3">
            call_split
          </span>
          <p className="font-body-ui text-system-log/50">
            输入分支描述并点击"执行模拟"查看结果
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Branch description header */}
      <div className="p-4 bg-primary-container/5 border border-primary-container/20 rounded-lg">
        <div className="flex items-center gap-2 mb-1">
          <span className="material-symbols-outlined text-primary-container text-sm">
            description
          </span>
          <span className="font-label-mono text-system-log text-xs">分支描述</span>
        </div>
        <p className="font-body-narrative text-primary text-sm">{report.branch_point_description}</p>
        <div className="flex items-center gap-3 mt-2 text-xs text-system-log/50 font-label-mono">
          <span>Token: {report.tokens_used_total}</span>
          <span>{new Date(report.created_at).toLocaleString("zh-CN")}</span>
        </div>
      </div>

      {/* Deterministic section */}
      <DeterministicTable report={report} />

      {/* LLM inference section */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-system-log text-lg">smart_toy</span>
          <h3 className="font-label-mono text-system-log uppercase tracking-wider text-sm">
            LLM 推理
          </h3>
        </div>
        <div className="grid grid-cols-1 gap-3">
          <InferenceCard
            label="紧张曲线预测"
            icon="show_chart"
            item={report.tension_curve_projection}
          />
          <InferenceCard
            label="伏笔风险评估"
            icon="warning"
            item={report.foreshadowing_risk_assessment}
          />
          <InferenceCard
            label="替代建议"
            icon="lightbulb"
            item={report.alternative_suggestions}
          />
        </div>
      </div>
    </div>
  );
}
