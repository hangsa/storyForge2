import { useState } from "react";
import { PrimaryButton, SecondaryButton } from "@/components/ds";
import type { DimensionDecomposition, Unit } from "./types";

interface Props {
  dimensions: DimensionDecomposition[];
  causalMap: string;
  topLevelSummary: string;
  loading: boolean;
  followUpLoadingUnitId: string | null;
  onFollowUp: (unitId: string, userQuestion: string | null) => void;
  onPrev: () => void;
  onNext: () => void;
}

const DIMENSION_LABELS: Record<string, string> = {
  ontology: "世界构成 (Ontology)",
  energetics: "能量体系 (Energetics)",
  power_structure: "社会控制 (Power Structure)",
  protagonist_engine: "主角机制 (Protagonist Engine)",
  narrative_physics: "叙事动力 (Narrative Physics)",
};

export default function S2DecomposeStep({
  dimensions, causalMap, topLevelSummary, loading, followUpLoadingUnitId,
  onFollowUp, onPrev, onNext,
}: Props) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="space-y-4 flex-1 min-h-0 overflow-y-auto">
        <header className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
          Stage 2 · 第一性拆解 · 5 维度
        </header>

        {causalMap && (
          <pre className="bg-surface-container border border-outline-variant rounded-lg p-3 text-xs text-primary whitespace-pre-wrap" data-testid="causal-map">
            {causalMap}
          </pre>
        )}

        {dimensions.map((dim) => (
          <DimensionBlock
            key={dim.dimension}
            dimension={dim}
            followUpLoadingUnitId={followUpLoadingUnitId}
            onFollowUp={onFollowUp}
          />
        ))}

        {topLevelSummary && (
          <div className="border-t border-outline-variant pt-3" data-testid="top-level-summary">
            <h3 className="font-mono text-primary-container text-[10px] uppercase tracking-wider mb-1">
              总览
            </h3>
            <p className="text-sm text-primary">{topLevelSummary}</p>
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between px-margin-desktop py-3 border-t border-outline-variant gap-3 shrink-0">
        <SecondaryButton label="上一步:输入" onClick={onPrev} />
        <PrimaryButton
          label={loading ? "拆解中…" : "下一步:发散 →"}
          loading={loading}
          onClick={onNext}
        />
      </footer>
    </div>
  );
}

function DimensionBlock({
  dimension, followUpLoadingUnitId, onFollowUp,
}: {
  dimension: DimensionDecomposition;
  followUpLoadingUnitId: string | null;
  onFollowUp: (unitId: string, userQuestion: string | null) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [followUpUnitId, setFollowUpUnitId] = useState<string | null>(null);

  return (
    <section className="bg-surface-container-low border border-outline-variant rounded-lg p-3" data-testid={`dimension-${dimension.dimension}`}>
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full text-left"
      >
        <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
        <h3 className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
          {DIMENSION_LABELS[dimension.dimension] ?? dimension.dimension}
        </h3>
      </button>
      {dimension.insight && (
        <p className="text-xs text-on-surface-variant mt-1 ml-5">
          核心洞察:{dimension.insight}
        </p>
      )}
      {!collapsed && (
        <div className="space-y-2 mt-2">
          {dimension.units.map((u) => (
            <UnitCard
              key={u.id}
              unit={u}
              loading={followUpLoadingUnitId === u.id}
              followUpUnitId={followUpUnitId}
              setFollowUpUnitId={setFollowUpUnitId}
              onSubmit={(text) => {
                onFollowUp(u.id, text.trim() || null);
                setFollowUpUnitId(null);
              }}
              onCancel={() => {
                setFollowUpUnitId(null);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function UnitCard({
  unit, loading, followUpUnitId,
  setFollowUpUnitId, onSubmit, onCancel,
}: {
  unit: Unit;
  loading: boolean;
  followUpUnitId: string | null;
  setFollowUpUnitId: (id: string | null) => void;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [followUpText, setFollowUpText] = useState("");
  const showDialog = followUpUnitId === unit.id;
  return (
    <div
      className={
        "bg-surface-container border border-outline-variant rounded-lg p-3 text-sm " +
        (loading ? "opacity-50" : "")
      }
      data-testid={`unit-${unit.id}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
            {unit.unit_name} [Unit #{unit.id}]
          </div>
          <div className="text-primary mt-1">{unit.description}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            disabled={unit.is_irreducible}
            onClick={() => setFollowUpUnitId(unit.id)}
            className={
              "px-3 py-1.5 rounded text-sm " +
              (unit.is_irreducible
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-primary-container/15 text-primary-container hover:bg-primary-container/25")
            }
            data-testid={`follow-up-${unit.id}`}
          >
            {unit.is_irreducible ? "已不可再分" : (unit.follow_up_count > 0 ? `已追问 ${unit.follow_up_count} 次` : "追问")}
          </button>
        </div>
      </div>

      {showDialog && (
        <div className="mt-3 p-3 border border-primary-container/30 rounded-lg bg-primary-container/5 space-y-2">
          <textarea
            placeholder="(留空使用默认追问)"
            className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-sm"
            value={followUpText}
            onChange={(e) => setFollowUpText(e.target.value)}
            rows={2}
            data-testid={`follow-up-input-${unit.id}`}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1 rounded bg-gray-100 text-sm"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => onSubmit(followUpText)}
              className="px-3 py-1 rounded bg-blue-600 text-white text-sm"
            >
              确认追问
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
