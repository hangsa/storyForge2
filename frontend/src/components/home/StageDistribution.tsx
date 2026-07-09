const STAGE_DOT: Record<string, string> = {
  INIT: "bg-system-log",
  STAGE1: "bg-blue-400",
  STAGE2: "bg-purple-400",
  STAGE3: "bg-amber-400",
  STAGE4: "bg-primary-container",
  STAGE5: "bg-pink-400",
  STAGE6: "bg-emerald-400",
  COMPLETED: "bg-green-400",
};

const STAGE_LABEL: Record<string, string> = {
  INIT: "初始化",
  STAGE1: "概念",
  STAGE2: "世界观",
  STAGE3: "大纲",
  STAGE4: "工作台",
  STAGE5: "诊断",
  STAGE6: "导出",
  COMPLETED: "已完成",
};

const STAGE_ORDER = ["INIT", "STAGE1", "STAGE2", "STAGE3", "STAGE4", "STAGE5", "STAGE6", "COMPLETED"];

interface StageDistributionProps {
  distribution: Record<string, number> | null;
}

export default function StageDistribution({ distribution }: StageDistributionProps) {
  return (
    <div data-testid="stage-distribution" className="space-y-1.5">
      {STAGE_ORDER.map((stage) => {
        const count = distribution?.[stage] ?? 0;
        return (
          <div
            key={stage}
            data-testid={`stage-row-${stage}`}
            className="flex items-center gap-2 text-xs"
          >
            <span className={`w-2 h-2 rounded-full ${STAGE_DOT[stage] || "bg-system-log"}`} />
            <span className="flex-1 font-label-mono text-system-log">
              {STAGE_LABEL[stage] || stage}
            </span>
            <span className="font-label-mono text-primary tabular-nums">{count}</span>
          </div>
        );
      })}
    </div>
  );
}