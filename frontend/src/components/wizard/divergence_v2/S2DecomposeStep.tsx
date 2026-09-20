import { useState } from "react";
import { SecondaryButton } from "@/components/ds";
import { RegenerateModal } from "@/components/shared/RegenerateModal";
import { EditPromptModal } from "./EditPromptModal";
import type { DimensionDecomposition, Unit, Operator } from "./types";

interface Props {
  dimensions: DimensionDecomposition[];
  topLevelSummary: string;
  decomposePrompt: string;       // 当前专用提示词(来自 backend override)
  promptBusy: boolean;            // PUT 是否 in-flight
  onSavePrompt: (newText: string) => void | Promise<void>;  // 保存编辑
  followUpLoadingUnitId: string | null;
  onFollowUp: (unitId: string, userQuestion: string | null, operator: string) => void;
  // Footer navigation (上一步 / 下一步 / 重新生成) is registered through the
  // page-level wizard footer by CreativeDivergenceStep. The Stage-2 header
  // and the causal_map <pre> block were removed on 2026-09-08 (see git
  // history).
  //
  // The 「总览」 h3 title row above the top-level summary was removed on
  // 2026-09-11 — the heading felt redundant with the body text below it.
  // The summary paragraph itself is still surfaced (without the heading).
  //
  // 2026-09-15: the 5 维度 (ontology / energetics / power_structure /
  // protagonist_engine / narrative_physics) are now presented as a sticky
  // horizontal tab strip at the top, with the active panel below. Inactive
  // panels are kept in DOM under `hidden` so existing testids
  // (dimension-{key}, unit-{id}, follow-up-{id}) still resolve — only one
  // panel is visually rendered at a time.
}

const DIMENSION_LABELS: Record<string, { label: string; icon: string }> = {
  ontology: { label: "世界构成", icon: "public" },
  energetics: { label: "能量体系", icon: "bolt" },
  power_structure: { label: "社会控制", icon: "gavel" },
  protagonist_engine: { label: "主角机制", icon: "person" },
  narrative_physics: { label: "叙事动力", icon: "auto_stories" },
};

const DIMENSION_ORDER = ["ontology", "energetics", "power_structure", "protagonist_engine", "narrative_physics"] as const;

// Round 5 of the v2 wizard 6-item optimization: narrative_physics 维度的
// `insight` 字段本身就是"核心矛盾",把它以虚拟 unit 的形式展示在该维度
// 顶部,unit_name="核心矛盾",is_irreducible=true (无追问按钮)。
const CORE_CONTRADICTION_ID = "__core_contradiction__";

// 追问 modal 的算子选项 — 默认无算子(原追问式深化行为不变)。
// 自适应模式按 adaptive_diverge.yaml 的"扫描-路由-主辅算子"方法论深化,
// 结合用户修改意见(可空)综合生成。
const FOLLOW_UP_OPERATORS = [
  { value: "none", label: "无算子" },
  { value: "adaptive", label: "自适应" },
] as const;

// 自适应追问后,unit 上会写入 main_operator / aux_operator / chain_reaction。
// UnitCard 在 unit_name 后用小字展示这俩算子标签,让用户能看见本轮应用了什么。
const OPERATOR_LABELS: Record<Operator, string> = {
  distort: "扭曲",
  break: "打破",
  blend: "融合",
  chain: "组合链",
};

function withCoreContradictionUnit(dim: DimensionDecomposition): DimensionDecomposition {
  if (dim.dimension !== "narrative_physics" || !dim.insight?.trim()) {
    return dim;
  }
  const virtual: Unit = {
    id: CORE_CONTRADICTION_ID,
    dimension: "narrative_physics",
    unit_name: "核心矛盾",
    description: dim.insight,
    follow_up_count: 0,
    is_irreducible: true,
  };
  return { ...dim, units: [virtual, ...dim.units] };
}

export default function S2DecomposeStep({
  dimensions, topLevelSummary, decomposePrompt, promptBusy,
  onSavePrompt, followUpLoadingUnitId, onFollowUp,
}: Props) {
  // Defense-in-depth: callers upstream (reducer / HYDRATE) already coerce
  // undefined to [], but a stray malformed payload must not crash the
  // render with `dimensions.length`.
  const safeDimensions = Array.isArray(dimensions) ? dimensions : [];

  // Round 3: 追问弹窗提到顶层,共享一个 RegenerateModal,避免每个 unit
  // 都维护自己的 inline dialog 状态(text 泄漏 / 弹窗叠加 / 焦点跳跃)。
  const [followUpTarget, setFollowUpTarget] = useState<{ unitId: string; unitName: string } | null>(null);
  // 追问算子选择 — 默认 "none",即原追问式深化。选 "adaptive" 时后端
  // 会按自适应方法论生成,并把 main_operator/aux_operator/chain_reaction
  // 写回 Unit。模态关闭时重置回默认。
  const [followUpOperator, setFollowUpOperator] = useState<string>("none");
  // Round 7: edit-decompose-prompt modal state.
  const [editPromptOpen, setEditPromptOpen] = useState(false);

  // 2026-09-15: 维度 tab 化。默认选中 DIMENSION_ORDER 中第一个存在的维度;
  // 若全是 unknown 维度,fallback 到 safeDimensions[0]。
  const orderedKeys: string[] = [
    ...DIMENSION_ORDER.filter((k) => safeDimensions.some((d) => d.dimension === k)),
    ...safeDimensions
      .filter((d) => !DIMENSION_ORDER.includes(d.dimension as typeof DIMENSION_ORDER[number]))
      .map((d) => d.dimension),
  ];
  const [activeKey, setActiveKey] = useState<string>(
    () => orderedKeys[0] ?? "",
  );

  // Apply 核心矛盾 prepend once per dim so tab count matches panel unit count
  // (narrative_physics + virtual unit = 2, not 1).
  const effectiveDimByKey: Record<string, DimensionDecomposition> = Object.fromEntries(
    orderedKeys.map((k) => {
      const d = safeDimensions.find((x) => x.dimension === k);
      return [k, d ? withCoreContradictionUnit(d) : d];
    }).filter(([, d]) => d !== undefined) as [string, DimensionDecomposition][],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto px-6">
        {topLevelSummary && (
          // The 「总览」 h3 title row above this paragraph was removed on
          // 2026-09-11 — it felt redundant. The summary block keeps a
          // tighter py-2 (vs the original p-4) so the overall conclusion
          // sits as a compact header strip above the 5 dimensions rather
          // than dominating the page.
          // Round 7 (2026-09-12): the edit-decompose-prompt icon anchors on
          // this block; clicking opens EditPromptModal prefilled with the
          // current specialized prompt.
          <div
            className="bg-primary-container/5 rounded-lg py-2 px-3"
            data-testid="top-level-summary"
          >
            <div className="flex items-start gap-2">
              <button
                type="button"
                aria-label="查看/编辑本次拆解的专用提示词"
                data-testid="edit-decompose-prompt-btn"
                onClick={() => setEditPromptOpen(true)}
                className="shrink-0 mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded hover:bg-primary-container/15 text-primary-container"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px] leading-none">edit_note</span>
              </button>
              <p className="flex-1 text-sm text-primary">{topLevelSummary}</p>
            </div>
          </div>
        )}

        {orderedKeys.length > 0 && (
          // 2026-09-15: sticky 横向 tab,5 维度平铺,点击切换 activeKey。
          // Inactive panels 在 DOM 中保留(用 `hidden` 隐藏),所有现有 testid
          // (dimension-{key} / unit-{id} / follow-up-{id}) 仍然可定位,
          // 这样 tab 化改造对单测零侵入。
          <div
            role="tablist"
            aria-label="拆解维度"
            data-testid="dimension-tabs"
            className="sticky top-0 z-10 -mx-6 px-6 bg-surface-container-low/95 backdrop-blur-sm flex gap-1 mt-3 border-b border-outline-variant overflow-x-auto"
          >
            {orderedKeys.map((key) => {
              const dim = effectiveDimByKey[key];
              if (!dim) return null;
              const meta = DIMENSION_LABELS[key] ?? { label: key, icon: "auto_awesome" };
              const isActive = activeKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`dimension-panel-${key}`}
                  data-testid={`dimension-tab-${key}`}
                  onClick={() => setActiveKey(key)}
                  className={
                    "shrink-0 px-3 py-2 text-sm font-display font-medium border-b-2 -mb-px flex items-center gap-2 transition-colors " +
                    (isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-on-surface-variant hover:text-primary hover:border-outline-variant")
                  }
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-base leading-none">
                    {meta.icon}
                  </span>
                  <span>{meta.label}</span>
                  <span className="font-mono text-[10px] opacity-70" aria-label={`${dim.units.length} 个单元`}>
                    {dim.units.length}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {orderedKeys.map((key) => {
          const dim = effectiveDimByKey[key];
          if (!dim) return null;
          const isActive = activeKey === key;
          return (
            <div
              key={key}
              id={`dimension-panel-${key}`}
              role="tabpanel"
              aria-labelledby={`dimension-tab-${key}`}
              hidden={!isActive}
              data-testid={`dimension-${key}`}
            >
              <DimensionBlock
                dimension={dim}
                followUpLoadingUnitId={followUpLoadingUnitId}
                onFollowUpClick={(unitId, unitName) => setFollowUpTarget({ unitId, unitName })}
              />
            </div>
          );
        })}
      </div>

      <RegenerateModal
        open={followUpTarget !== null}
        target={followUpTarget ? followUpTarget.unitName : ""}
        titlePrefix="追问"
        confirmLabel="追问"
        busy={followUpLoadingUnitId !== null}
        // 算子选择器:仅在追问 modal 中显示(传了 operators prop),
        // S2 重新生成 modal 不受影响(继续显示原"留空 = 仅重新生成"提示行)。
        operator={followUpOperator}
        operators={FOLLOW_UP_OPERATORS}
        onOperatorChange={setFollowUpOperator}
        onConfirm={(text) => {
          if (!followUpTarget) return;
          onFollowUp(followUpTarget.unitId, text.trim() || null, followUpOperator);
          setFollowUpTarget(null);
          setFollowUpOperator("none");
        }}
        onCancel={() => {
          setFollowUpTarget(null);
          setFollowUpOperator("none");
        }}
      />

      <EditPromptModal
        open={editPromptOpen}
        initialText={decomposePrompt}
        busy={promptBusy}
        onSave={async (text) => {
          await onSavePrompt(text);
          setEditPromptOpen(false);
        }}
        onCancel={() => setEditPromptOpen(false)}
      />
    </div>
  );
}

function DimensionBlock({
  dimension, followUpLoadingUnitId, onFollowUpClick,
}: {
  dimension: DimensionDecomposition;
  followUpLoadingUnitId: string | null;
  onFollowUpClick: (unitId: string, unitName: string) => void;
}) {
  // 2026-09-15: 维度 header 折叠按钮移除 — 改用 tab strip 切换可见性后,
  // 单个面板不再需要内嵌展开/折叠。每个 panel 现在只剩 insight + units,
  // label/count 已上移到 tab 按钮上。
  return (
    <section className="py-3 space-y-3">
      {dimension.insight && (
        <p
          className="text-xs text-on-surface-variant"
          data-testid={`dimension-insight-${dimension.dimension}`}
        >
          <span className="font-medium">核心洞察:</span>{dimension.insight}
        </p>
      )}
      <div className="space-y-2">
        {dimension.units.map((u) => (
          <UnitCard
            key={u.id}
            unit={u}
            loading={followUpLoadingUnitId === u.id}
            onFollowUpClick={() => onFollowUpClick(u.id, u.unit_name)}
          />
        ))}
      </div>
    </section>
  );
}

function UnitCard({
  unit, loading, onFollowUpClick,
}: {
  unit: Unit;
  loading: boolean;
  onFollowUpClick: () => void;
}) {
  const isVirtualCore = unit.id === CORE_CONTRADICTION_ID;
  const followUpLabel = isVirtualCore
    ? "核心矛盾"
    : unit.is_irreducible
      ? "已不可再分"
      : "追问";
  return (
    <div
      className={
        "bg-surface-container border border-outline-variant rounded-lg p-3 text-sm " +
        (loading ? "opacity-50" : "")
      }
      data-testid={`unit-${unit.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-display text-sm font-semibold text-primary">{unit.unit_name}</span>
            {/* 自适应追问后展示本轮使用的算子。无算子追问保持 null,不渲染。 */}
            {unit.main_operator && (
              <span
                className="font-mono text-[10px] text-on-surface-variant"
                data-testid={`unit-operator-${unit.id}`}
              >
                · {OPERATOR_LABELS[unit.main_operator]}
                {unit.aux_operator ? ` + ${OPERATOR_LABELS[unit.aux_operator]}` : ""}
              </span>
            )}
            {/* 2026-09-19: 把"已追问 N 次"从按钮文案移到此处,与算子同字号同行展示;无追问历史的单元保持不渲染,避免视觉噪音。 */}
            {!isVirtualCore && !unit.is_irreducible && unit.follow_up_count > 0 && (
              <span
                className="font-mono text-[10px] text-on-surface-variant"
                data-testid={`unit-followup-count-${unit.id}`}
              >
                · 已追问 {unit.follow_up_count} 次
              </span>
            )}
            {isVirtualCore && (
              <span
                className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary-container/20 text-primary-container"
                data-testid={`core-contradiction-badge-${unit.id}`}
              >
                📌 核心矛盾
              </span>
            )}
          </div>
          <div className="text-primary mt-1">{unit.description}</div>
        </div>
        {!isVirtualCore && (
          <SecondaryButton
            label={followUpLabel}
            icon="forum"
            size="sm"
            testId={`follow-up-${unit.id}`}
            disabled={unit.is_irreducible}
            onClick={onFollowUpClick}
          />
        )}
      </div>
    </div>
  );
}