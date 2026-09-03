import type { CanvasV4State } from "@/api/client";
import { IdeaRootNode } from "./IdeaRootNode";
import { OptionNode } from "./OptionNode";
import { TreePath } from "./TreePath";

type Slot = "a" | "b" | "c";

interface Props {
  canvas: CanvasV4State;
}

// Coordinate system (matches docs/design/canvas-reconstruction/code.html lines 226-371).
// - IdeaRoot at x = 60 (relative to canvas), center y = 200
// - Each step column 200px wide with 100px gap
// - Step column starts at x = 300 (Step 1), 600 (Step 2), 900 (Step 3), ...
// - Option slots vertically stacked: a=50, b=200, c=350 (with column 400px tall, top padding 25)
// - Center nodes sit at y = 200 (root + current step column)
const ROOT_X = 60;
const COL_WIDTH = 200;
const COL_GAP = 100;
const COL_START_X = 300; // x coordinate where a step column's leftmost node sits
const SLOT_Y: Record<Slot, number> = { a: 50, b: 200, c: 350 };
const CENTER_Y = 200;

export function TreeCanvas({ canvas }: Props) {
  const steps = canvas.creative_path;

  // Resolve each step's selected option → "a"/"b"/"c".
  // Walk the options array by index rather than parsing the option id —
  // the previous regex (`/_([abc])$/`) silently misrouted for any id that
  // didn't end in a single `a`/`b`/`c` character (e.g. `_alpha`), turning
  // a real selected option into a "phantom root connector".
  const selectedSlotByStep: Record<number, Slot | null> = {};
  steps.forEach((s) => {
    const selIdx = s.selected_option_id
      ? s.options.findIndex((o) => o.id === s.selected_option_id)
      : -1;
    selectedSlotByStep[s.step] =
      selIdx >= 0 && selIdx < 3 ? (["a", "b", "c"][selIdx] as Slot) : null;
  });

  // Build path segments connecting previous selected → next column's options.
  // Active = solid glow (matches the design's primary connector path).
  const pathSegments: Array<{
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    active: boolean;
  }> = [];

  steps.forEach((s, idx) => {
    const colLeftX = COL_START_X + idx * (COL_WIDTH + COL_GAP);
    const selSlot = selectedSlotByStep[s.step];

    (["a", "b", "c"] as Slot[]).forEach((slot) => {
      let fromX: number;
      let fromY: number;

      if (idx === 0) {
        // from root idea
        fromX = ROOT_X + 50; // circle right edge, root sits in 200px column starting at x=0
        fromY = CENTER_Y;
      } else {
        const prevSlot = selectedSlotByStep[steps[idx - 1].step];
        if (!prevSlot) {
          // No ancestor selection — render dashed "phantom" connectors from root.
          fromX = ROOT_X + 50;
          fromY = CENTER_Y;
        } else {
          const prevColX =
            COL_START_X + (idx - 1) * (COL_WIDTH + COL_GAP) + 50; // node right edge
          fromX = prevColX;
          fromY = SLOT_Y[prevSlot];
        }
      }

      const targetX = colLeftX; // node left edge of this slot
      const targetY = SLOT_Y[slot];

      const isActive = selSlot === slot;
      pathSegments.push({
        fromX,
        fromY,
        toX: targetX,
        toY: targetY,
        active: isActive,
      });
    });
  });

  return (
    <div
      data-testid="tree-canvas"
      className="relative flex-1 mt-md min-h-[600px]"
      style={{ minWidth: 1200 }}
    >
      <TreePath paths={pathSegments} />
      <div className="relative z-10 w-full h-full flex">
        <div className="w-[200px] flex flex-col items-center justify-center relative h-[400px]">
          <IdeaRootNode prompt={canvas.root_idea?.prompt ?? ""} />
        </div>
        {steps.map((s) => (
          <div
            key={s.step}
            data-testid={`step-column-${s.step}`}
            className="w-[200px] flex flex-col justify-between py-[25px] h-[400px] relative"
          >
            {(["a", "b", "c"] as Slot[]).map((slot) => {
              const opt = s.options.find((o) => o.id === `opt_${s.step}_${slot}`);
              const isSelected = s.selected_option_id === `opt_${s.step}_${slot}`;
              const isFaded = !isSelected && s.state === "completed";
              return (
                <OptionNode
                  key={slot}
                  testId={`option-node-${s.step}-${slot}`}
                  slot={slot}
                  label={opt?.title ?? slot.toUpperCase()}
                  selected={isSelected}
                  faded={isFaded}
                />
              );
            })}
            {s.state === "active" && (
              <div
                data-testid={`step-${s.step}-current-node`}
                className="absolute top-[150px] left-1/2 transform -translate-x-1/2 flex flex-col items-center animate-pulse"
              >
                <div className="w-14 h-14 rounded-full bg-surface border-2 border-primary glow-active flex items-center justify-center">
                  <div className="w-6 h-6 rounded-full bg-primary" />
                </div>
                <span className="font-label-sm text-label-sm text-primary font-bold mt-sm">
                  Step {s.step}: {s.operation}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
