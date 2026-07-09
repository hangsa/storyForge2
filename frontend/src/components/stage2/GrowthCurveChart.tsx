import type { GrowthStage } from "../../api/client";

interface Props {
  stages: GrowthStage[];
  width?: number;
  height?: number;
}

const STAGE_NAME_TO_Y: Record<string, number> = {
  起点: 1,
  转折: 2,
  低谷: 0,
  回升: 3,
  终点: 4,
};

function yForStage(name: string): number {
  return STAGE_NAME_TO_Y[name] ?? 2;
}

export default function GrowthCurveChart({ stages, width = 560, height = 220 }: Props) {
  const points = stages
    .filter((s) => s.bound_chapter != null)
    .map((s) => ({
      x: s.bound_chapter as number,
      y: yForStage(s.stage_name),
      name: s.stage_name,
    }));

  if (points.length === 0) {
    return <div className="text-sm text-gray-500">暂无成长阶段可显示</div>;
  }

  const xs = points.map((p) => p.x);
  const xMin = Math.max(1, Math.min(...xs) - 1);
  const xMax = Math.max(...xs) + 1;
  const padX = 40;
  const padY = 30;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const xScale = (x: number) => padX + ((x - xMin) / (xMax - xMin || 1)) * innerW;
  const yScale = (y: number) => padY + innerH - (y / 4) * innerH;

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.x)} ${yScale(p.y)}`)
    .join(" ");

  return (
    <svg width={width} height={height} role="img" aria-label="角色成长曲线">
      <line x1={padX} y1={padY + innerH} x2={width - padX} y2={padY + innerH}
            stroke="#9ca3af" strokeWidth={1} />
      <path d={pathD} fill="none" stroke="#6366f1" strokeWidth={2} />
      {points.map((p) => (
        <g key={`${p.x}-${p.name}`}>
          <circle cx={xScale(p.x)} cy={yScale(p.y)} r={5} fill="#6366f1" />
          <text x={xScale(p.x)} y={yScale(p.y) - 10} textAnchor="middle"
                fontSize="11" fill="#374151">{p.name}</text>
          <text x={xScale(p.x)} y={padY + innerH + 16} textAnchor="middle"
                fontSize="10" fill="#6b7280">Ch{p.x}</text>
        </g>
      ))}
    </svg>
  );
}
