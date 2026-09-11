import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DropdownSelect } from "@/components/ds";
import { useCreativeDimensions } from "@/hooks/useCreativeDimensions";
import type { RawIntent } from "./types";

interface Props {
  projectId: string;
  initial: RawIntent | null;
  /**
   * 新建项目时用户在 CreateProjectModal 选的题材模板 ID。
   * 当 rawIntent 还没落盘(initial === null)时,用它预填题材 dropdown,
   * 避免回退到硬编码的 DEFAULT_GENRE_FALLBACK。
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

const DEFAULT_GENRE_FALLBACK = "cool_novel";
const MAX_PROMPT = 1000;

const KIND_LABEL = { subject: "题材", tone: "基调", style: "风格" } as const;
type DropdownKind = keyof typeof KIND_LABEL;

function resolveInitialValue(
  initialValue: string | undefined,
  activeIds: Set<string>,
  fallbackId: string | undefined,
): string {
  if (initialValue && activeIds.has(initialValue)) return initialValue;
  if (fallbackId) return fallbackId;
  return "";
}

export default function S1InputStep({
  projectId, initial, defaultGenre, onSubmitted, onSubmitReady,
}: Props) {
  const { subject, tone, style, loading, error } = useCreativeDimensions();

  const subjectOptions = useMemo(() => subject.map((e) => ({ value: e.id, label: e.name })), [subject]);
  const toneOptions    = useMemo(() => tone.map((e) => ({ value: e.id, label: e.name })), [tone]);
  const styleOptions   = useMemo(() => style.map((e) => ({ value: e.id, label: e.name })), [style]);

  const subjectActiveIds = useMemo(() => new Set(subject.map((e) => e.id)), [subject]);
  const toneActiveIds    = useMemo(() => new Set(tone.map((e) => e.id)), [tone]);
  const styleActiveIds   = useMemo(() => new Set(style.map((e) => e.id)), [style]);

  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [genrePrimary, setGenrePrimary] = useState(() =>
    resolveInitialValue(initial?.genre_primary ?? defaultGenre, subjectActiveIds, subject[0]?.id) || DEFAULT_GENRE_FALLBACK
  );
  const [toneVal, setTone] = useState(() => resolveInitialValue(initial?.tone, toneActiveIds, tone[0]?.id));
  const [styleVal, setStyle] = useState(() => resolveInitialValue(initial?.style, styleActiveIds, style[0]?.id));

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
  // no active ids). Snap to the first active option so the trigger
  // button always renders a meaningful label.
  //
  // 第二个责任:defaultGenre 在 S1InputStep 首次渲染后才异步到达(useThreeBDivergence
  // 的 getProjectStatus 在 mount effect 里发起,完成时 defaultGenre 从 "" 变 "xuanyi")。
  // useState 的 lazy initializer 只跑一次,故需此 effect 把迟到的 defaultGenre 写入 state。
  // 仅在 initial 为空(用户尚未提交过灵感输入)时覆盖,避免覆盖用户已选的值。
  useEffect(() => {
    if (subject.length > 0 && !subjectActiveIds.has(genrePrimary)) {
      setGenrePrimary(subject[0].id);
      return;
    }
    if (
      defaultGenre &&
      !initial?.genre_primary &&
      subjectActiveIds.has(defaultGenre) &&
      genrePrimary !== defaultGenre
    ) {
      setGenrePrimary(defaultGenre);
    }
  }, [subject, subjectActiveIds, genrePrimary, defaultGenre, initial?.genre_primary]);
  useEffect(() => {
    if (tone.length > 0 && !toneActiveIds.has(toneVal)) {
      setTone(tone[0].id);
    }
  }, [tone, toneActiveIds, toneVal]);
  useEffect(() => {
    if (style.length > 0 && !styleActiveIds.has(styleVal)) {
      setStyle(style[0].id);
    }
  }, [style, styleActiveIds, styleVal]);

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
