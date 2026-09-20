import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DropdownSelect } from "@/components/ds";
import { useCreativeDimensions } from "@/hooks/useCreativeDimensions";
import type { RawIntent } from "./types";

interface Props {
  projectId: string;
  initial: RawIntent | null;
  /**
   * 新建项目时用户在 CreateProjectModal 选的题材模板 ID(slug 如 "cool_novel"/"qihuan")。
   * 当 rawIntent 还没落盘(initial === null)时,用它预填题材 dropdown,避免回退到硬编码 fallback。
   * rawIntent 已存在时,initial.genre_primary 优先级更高。
   */
  defaultGenre?: string;
  onSubmitted: (intent: RawIntent) => void;
  /**
   * Bubble the latest submit handler + form validity up so the parent can
   * wire it into the page-level wizard footer (the "下一步:拆解 →" button
   * in WorkspaceWizardPanel). When validity flips false, the parent gets
   * `null` and disables the footer button. Handler is stable across renders
   * because it reads form state via ref.
   */
  onSubmitReady?: (handler: (() => void) | null, valid: boolean) => void;
}

const DEFAULT_GENRE_FALLBACK = "玄幻";
const MAX_PROMPT = 1000;

const KIND_LABEL = { subject: "题材", tone: "基调", style: "风格" } as const;
type DropdownKind = keyof typeof KIND_LABEL;

/**
 * Resolve the initial dropdown value for a dimension from a saved raw_intent
 * field or a defaultGenre prop.
 *
 * 历史原因:`raw_intent.genre_primary/tone/style` 旧版本存的是数据 store 里的
 * slug id(如 "cool_novel"/"9edeacbe"/"rexue"),而不是用户可见的 name。
 * S1InputStep 现在把 dropdown 的 value 改成 name(用户看到的标签 = 后端收到的值),
 * 所以这里要做三段兼容:
 *   1. exact name match → 直接返回 name
 *   2. legacy id match  → 用旧 id 反查到对应 entry,返回 entry.name
 *   3. 全没命中         → fallbackName / entries[0].name / ""
 *
 * 旧项目(proj_4e6f888f 等)即便不跑迁移脚本也能在这里被救回来 —— 重开 S1 时
 * dropdown 自动显示「奇幻」「热血」「爽文」而不是「9edeacbe」「黑暗」。
 */
function resolveInitialValue(
  initialValue: string | undefined,
  entries: ReadonlyArray<{ id: string; name: string }>,
  fallbackName: string | undefined,
): string {
  if (initialValue) {
    const byName = entries.find((e) => e.name === initialValue);
    if (byName) return byName.name;
    const byId = entries.find((e) => e.id === initialValue);
    if (byId) return byId.name;
  }
  if (fallbackName) return fallbackName;
  if (entries.length > 0) return entries[0].name;
  return "";
}

export default function S1InputStep({
  projectId, initial, defaultGenre, onSubmitted, onSubmitReady,
}: Props) {
  const { subject, tone, style, loading, error } = useCreativeDimensions();

  const subjectOptions = useMemo(() => subject.map((e) => ({ value: e.name, label: e.name })), [subject]);
  const toneOptions    = useMemo(() => tone.map((e) => ({ value: e.name, label: e.name })), [tone]);
  const styleOptions   = useMemo(() => style.map((e) => ({ value: e.name, label: e.name })), [style]);

  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [genrePrimary, setGenrePrimary] = useState(() =>
    resolveInitialValue(initial?.genre_primary ?? defaultGenre, subject, subject[0]?.name) || DEFAULT_GENRE_FALLBACK
  );
  const [toneVal, setTone] = useState(() => resolveInitialValue(initial?.tone, tone, tone[0]?.name));
  const [styleVal, setStyle] = useState(() => resolveInitialValue(initial?.style, style, style[0]?.name));

  const subjectDisabled = subjectOptions.length === 0;
  const toneDisabled    = toneOptions.length === 0;
  const styleDisabled   = styleOptions.length === 0;

  const anyDisabled = subjectDisabled || toneDisabled || styleDisabled;
  const valid = prompt.length >= 10 && !subjectDisabled;

  // Sync the dropdown state when the creative-dimensions catalog loads
  // (or when the active set changes underneath us). The lazy initializer
  // above ran with the empty first-render data; once the catalog
  // resolves, the previous state may no longer match any active option
  // (e.g. `toneVal === ""` because resolveInitialValue returned "" with
  // no active entries). Snap to the first active option so the trigger
  // button always renders a meaningful label.
  //
  // 第二个责任:defaultGenre 在 S1InputStep 首次渲染后才异步到达(useB3Divergence
  // 的 getProjectStatus 在 mount effect 里发起,完成时 defaultGenre 从 "" 变 "xuanyi")。
  // useState 的 lazy initializer 只跑一次,故需此 effect 把迟到的 defaultGenre 写入 state。
  // 仅在 initial 为空(用户尚未提交过灵感)时覆盖,避免覆盖用户已选的值。
  // defaultGenre 可能是 slug(项目 create 时存的是 id)或 name(任何后续传递),
  // resolveInitialValue 内部已统一处理,这里只需把对应 name 写入 state。
  useEffect(() => {
    if (subject.length > 0 && !subject.some((e) => e.name === genrePrimary)) {
      setGenrePrimary(subject[0].name);
      return;
    }
    if (defaultGenre && !initial?.genre_primary) {
      const match = subject.find((e) => e.id === defaultGenre || e.name === defaultGenre);
      if (match && match.name !== genrePrimary) {
        setGenrePrimary(match.name);
      }
    }
  }, [subject, genrePrimary, defaultGenre, initial?.genre_primary]);
  useEffect(() => {
    if (tone.length > 0 && !tone.some((e) => e.name === toneVal)) {
      setTone(tone[0].name);
    }
  }, [tone, toneVal]);
  useEffect(() => {
    if (style.length > 0 && !style.some((e) => e.name === styleVal)) {
      setStyle(style[0].name);
    }
  }, [style, styleVal]);

  const stateRef = useRef({ prompt, genrePrimary, tone: toneVal, style: styleVal });
  stateRef.current = { prompt, genrePrimary, tone: toneVal, style: styleVal };

  const handleSubmit = useCallback(() => {
    const s = stateRef.current;
    if (s.prompt.length < 10 || subjectDisabled) return;
    const intent: RawIntent = {
      prompt: s.prompt,
      genre_primary: s.genrePrimary,
      tone: s.tone,
      style: s.style,
    };
    onSubmitted(intent);
  }, [onSubmitted, subjectDisabled]);

  useEffect(() => {
    onSubmitReady?.(valid ? handleSubmit : null, valid);
    return () => onSubmitReady?.(null, false);
  }, [valid, handleSubmit, onSubmitReady]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-2 pb-4">
        <div className="h-full bg-surface-container-low border border-outline-variant rounded-lg p-4 flex flex-col">
          <label
            htmlFor="prompt"
            className="block font-display text-sm font-medium text-primary mb-1 shrink-0"
          >
            灵感点子 <span className="text-on-surface-variant text-xs">(≥10 字)</span>
          </label>
          <textarea
            id="prompt"
            className="w-full flex-1 min-h-[16rem] bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container resize-y"
            maxLength={MAX_PROMPT}
            placeholder="一句话描述你想写的故事核心 — 比如:赛博朋克 + 修仙 + 双男主"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="flex justify-end mt-1 shrink-0">
            <span className={`font-mono text-[10px] ${prompt.length < 10 ? "text-on-surface-variant" : "text-primary-container"}`}>
              {prompt.length} / {MAX_PROMPT} 字
            </span>
          </div>
        </div>
      </div>

      {anyDisabled && (
        <div className="px-6 pt-2 text-error text-xs" data-testid="dimensions-disabled-hint">
          {subjectDisabled && <span>题材暂无生效选项，</span>}
          {toneDisabled && <span>基调暂无生效选项，</span>}
          {styleDisabled && <span>风格暂无生效选项，</span>}
          <a
            href="/creative-dimensions"
            className="underline"
            data-testid="goto-dimensions-link"
          >
            前往配置
          </a>
        </div>
      )}

      <div className="px-6 pt-3 pb-4 border-t border-outline-variant shrink-0">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-3">
          <div className="flex items-center gap-2 min-w-0">
            <label className="font-display text-sm font-medium text-primary whitespace-nowrap shrink-0">
              {KIND_LABEL.subject}
            </label>
            <DropdownSelect
              options={subjectOptions}
              value={genrePrimary}
              onChange={setGenrePrimary}
              direction="up"
              disabled={subjectDisabled}
            />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <label className="font-display text-sm font-medium text-primary whitespace-nowrap shrink-0">
              {KIND_LABEL.tone}
            </label>
            <DropdownSelect
              options={toneOptions}
              value={toneVal}
              onChange={setTone}
              direction="up"
              disabled={toneDisabled}
            />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <label className="font-display text-sm font-medium text-primary whitespace-nowrap shrink-0">
              {KIND_LABEL.style}
            </label>
            <DropdownSelect
              options={styleOptions}
              value={styleVal}
              onChange={setStyle}
              direction="up"
              disabled={styleDisabled}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
