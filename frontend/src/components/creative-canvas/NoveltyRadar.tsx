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
          {/* Red ocean warning zone */}
          <Radar
            name="redOcean"
            dataKey={() => 40}
            fill="#ef4444"
            fillOpacity={0.08}
            stroke="none"
            legendType="none"
          />
          {/* Blue ocean indicator zone */}
          <Radar
            name="blueOcean"
            dataKey={() => 80}
            fill="#22c55e"
            fillOpacity={0.06}
            stroke="none"
            legendType="none"
          />
          <Radar
            name="新颖度"
            dataKey="value"
            stroke="#7c3aed"
            strokeWidth={2}
            fill="#7c3aed"
            fillOpacity={0.2}
          />
        </RadarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-1">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/40" />
          <span className="font-label-mono text-xs text-system-log">红海 (&lt;40)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/40" />
          <span className="font-label-mono text-xs text-system-log">蓝海 (&gt;80)</span>
        </div>
      </div>
    </div>
  );
}
