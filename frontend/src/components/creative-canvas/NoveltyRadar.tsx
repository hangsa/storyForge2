import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
import type { NoveltyScoreDetail } from "../../api/client";

interface NoveltyRadarProps {
  scores: NoveltyScoreDetail;
}

export default function NoveltyRadar({ scores }: NoveltyRadarProps) {
  const data = [
    { axis: "市场饱和度", value: scores.market_saturation_score, fullMark: 100 },
    { axis: "套话相似度", value: scores.trope_similarity_score, fullMark: 100 },
    { axis: "矛盾深度", value: scores.contradiction_depth_score, fullMark: 100 },
    { axis: "讨论潜力", value: scores.discussion_potential_score, fullMark: 100 },
  ];

  // Color band by total score: red <40, yellow 40-80, green >80
  const total = scores.total;
  const stroke = total >= 80 ? "#22c55e" : total < 40 ? "#ef4444" : "#7c3aed";
  const fill = total >= 80 ? "#22c55e" : total < 40 ? "#ef4444" : "#7c3aed";

  return (
    <div className="w-full h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid stroke="rgba(255,255,255,0.1)" />
          <PolarAngleAxis
            dataKey="axis"
            tick={{ fill: "#9ca3af", fontSize: 11, fontFamily: "var(--font-label-mono)" }}
          />
          <PolarRadiusAxis
            domain={[0, 100]}
            tick={{ fill: "#9ca3af", fontSize: 10 }}
            axisLine={false}
            tickCount={4}
          />
          <Radar
            name="新颖度"
            dataKey="value"
            stroke={stroke}
            strokeWidth={2}
            fill={fill}
            fillOpacity={0.25}
          />
        </RadarChart>
      </ResponsiveContainer>

      {/* Threshold legend */}
      <div className="flex items-center justify-center gap-4 mt-1">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/30 border border-red-500/60" />
          <span className="font-label-mono text-xs text-system-log">红海 (&lt;40)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-yellow-500/30 border border-yellow-500/60" />
          <span className="font-label-mono text-xs text-system-log">中等 (40-80)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-green-500/30 border border-green-500/60" />
          <span className="font-label-mono text-xs text-system-log">蓝海 (&gt;80)</span>
        </div>
      </div>
    </div>
  );
}
