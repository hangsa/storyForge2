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
  const displayContent = d.content.length > 24
    ? d.content.slice(0, 24) + "..."
    : d.content;

  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-system-log/40" />
      <div
        data-testid={`node-${d.label}`}
        className={`
          px-2 py-1 rounded-md min-w-[130px] max-w-[160px] transition-all duration-150 border
          ${isDimmed ? "opacity-50 cursor-default border-dashed border-system-log/30" : "cursor-pointer border-solid"}
          ${d.isRoot && !isDimmed ? "border-primary-container ring-1 ring-primary-container/30" : ""}
          ${selected || d.isSelected ? "ring-1 ring-primary" : ""}
          ${d.isPath && !isDimmed ? "border-l-2" : ""}
          ${d.isLeaf && !d.isRoot ? "border-dashed" : "border-solid"}
          bg-surface-container-low
        `}
      >
        {/* Header row: dimmed indicator + novelty score */}
        <div className="flex items-center justify-between gap-1 mb-0.5">
          {isDimmed ? (
            <span className="font-label-mono text-[10px] px-1 py-0.5 rounded-full text-system-log/70 bg-system-log/10">
              未选
            </span>
          ) : (
            <span />
          )}
          {d.noveltyScore > 0 && (
            <span className="font-label-mono text-[10px] text-system-log">
              {d.noveltyScore.toFixed(0)}
            </span>
          )}
        </div>

        {/* Content text */}
        <p className="font-body-narrative text-primary text-xs leading-tight break-words">
          {displayContent}
        </p>

        {/* Depth indicator + expand action */}
        <div className="flex items-center justify-between mt-0.5">
          <div className="flex items-center gap-0.5">
            <span className="font-label-mono text-[10px] text-system-log/50">
              L{d.depth}
            </span>
            {d.isPath && (
              <span className="material-symbols-outlined text-[10px] text-system-log">
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
              className="text-[10px] px-1 py-0.5 rounded-full bg-primary-container/20 text-primary-container
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
