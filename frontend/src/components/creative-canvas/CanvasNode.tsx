import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

const DIMENSION_COLORS: Record<string, string> = {
  "角色动机": "#7c3aed",
  "世界观规则": "#0891b2",
  "情节方向": "#ea580c",
  "读者体验": "#059669",
};

const DIMENSION_ICONS: Record<string, string> = {
  "角色动机": "person",
  "世界观规则": "public",
  "情节方向": "timeline",
  "读者体验": "visibility",
};

export interface CanvasNodeData {
  label: string;
  content: string;
  dimension: string;
  depth: number;
  noveltyScore: number;
  isRoot: boolean;
  isSelected: boolean;
  isPath: boolean;
  isLeaf: boolean;
  isExpanded: boolean;
  onExpand: () => void;
}

export default function CanvasNode({ data, selected }: NodeProps) {
  const d = data as unknown as CanvasNodeData;
  const color = DIMENSION_COLORS[d.dimension] || "#6b7280";
  const icon = DIMENSION_ICONS[d.dimension] || "help";
  const displayContent = d.content.length > 30
    ? d.content.slice(0, 30) + "..."
    : d.content;

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-system-log/40" />
      <div
        className={`
          px-3 py-2 rounded-lg min-w-[180px] max-w-[220px] cursor-pointer
          transition-all duration-150 border-2
          ${d.isRoot ? "border-primary-container ring-2 ring-primary-container/30" : ""}
          ${selected || d.isSelected ? "ring-2 ring-primary ring-offset-1" : ""}
          ${d.isPath ? "border-l-4" : ""}
          ${d.isLeaf && !d.isRoot ? "border-dashed" : "border-solid"}
          bg-surface-container-low
        `}
        style={{
          borderColor: d.isPath ? color : undefined,
          borderLeftWidth: d.isPath ? "4px" : undefined,
        }}
      >
        {/* Header row: dimension badge + novelty score */}
        <div className="flex items-center justify-between gap-2 mb-1">
          <span
            className="text-xs px-1.5 py-0.5 rounded-full font-label-mono text-white"
            style={{ backgroundColor: color }}
          >
            <span className="material-symbols-outlined text-xs align-middle mr-0.5">
              {icon}
            </span>
            {d.dimension}
          </span>
          {d.noveltyScore > 0 && (
            <span className="font-label-mono text-xs text-system-log">
              {d.noveltyScore.toFixed(0)}
            </span>
          )}
        </div>

        {/* Content text */}
        <p className="font-body-narrative text-primary text-sm leading-snug break-words">
          {displayContent}
        </p>

        {/* Depth indicator + expand action */}
        <div className="flex items-center justify-between mt-1.5">
          <div className="flex items-center gap-1">
            <span className="font-label-mono text-xs text-system-log/50">
              L{d.depth}
            </span>
            {d.isPath && (
              <span className="material-symbols-outlined text-xs text-system-log">
                check_circle
              </span>
            )}
          </div>
          {d.isLeaf && !d.isExpanded && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                d.onExpand();
              }}
              className="text-xs px-1.5 py-0.5 rounded-full bg-primary-container/20 text-primary-container
                         hover:bg-primary-container/40 transition-colors font-label-mono"
            >
              + 展开
            </button>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-system-log/40" />
    </>
  );
}
