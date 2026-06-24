import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

export interface CanvasNodeData {
  label: string;
  content: string;
  branchStatus: "active" | "dimmed";
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
  const isDimmed = d.branchStatus === "dimmed";
  const displayContent = d.content.length > 30
    ? d.content.slice(0, 30) + "..."
    : d.content;

  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-system-log/40" />
      <div
        data-testid={`node-${d.label}`}
        className={`
          px-3 py-2 rounded-lg min-w-[180px] max-w-[220px] transition-all duration-150 border-2
          ${isDimmed ? "opacity-50 cursor-default border-dashed border-system-log/30" : "cursor-pointer border-solid"}
          ${d.isRoot && !isDimmed ? "border-primary-container ring-2 ring-primary-container/30" : ""}
          ${selected || d.isSelected ? "ring-2 ring-primary ring-offset-1" : ""}
          ${d.isPath && !isDimmed ? "border-l-4" : ""}
          ${d.isLeaf && !d.isRoot ? "border-dashed" : "border-solid"}
          bg-surface-container-low
        `}
      >
        {/* Header row: dimmed indicator + novelty score */}
        <div className="flex items-center justify-between gap-2 mb-1">
          {isDimmed ? (
            <span className="font-label-mono text-xs px-1.5 py-0.5 rounded-full text-system-log/70 bg-system-log/10">
              未选
            </span>
          ) : (
            <span />
          )}
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
          {d.isLeaf && !d.isExpanded && !isDimmed && (
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
      <Handle type="source" position={Position.Right} className="!bg-system-log/40" />
    </>
  );
}
