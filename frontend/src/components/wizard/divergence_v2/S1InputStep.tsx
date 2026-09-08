import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGenres } from "@/hooks/useGenres";
import { DropdownSelect } from "@/components/ds";
import type { RawIntent } from "./types";

interface Props {
  projectId: string;
  initial: RawIntent | null;
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

const NO_SECONDARY = "__none__";
const MAX_PROMPT = 1000;

export default function S1InputStep({
  projectId, initial, onSubmitted, onSubmitReady,
}: Props) {
  const genres = useGenres(true);
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [genrePrimary, setGenrePrimary] = useState(initial?.genre_primary ?? "");
  const [genreSecondary, setGenreSecondary] = useState<string>(
    initial?.genre_secondary ?? NO_SECONDARY,
  );

  const genreOptions = useMemo(
    () => genres.map((g) => ({ value: g.id, label: g.label_zh })),
    [genres],
  );
  const genreOptionsWithNone = useMemo(
    () => [{ value: NO_SECONDARY, label: "无" }, ...genreOptions],
    [genreOptions],
  );

  const valid = prompt.length >= 10 && genrePrimary.length > 0;

  // Latest-values bridge: the handler we expose to the parent stays stable
  // (so it can be registered as a wizard-footer click target without
  // re-binding on every keystroke) but always reads fresh form state.
  const stateRef = useRef({ prompt, genrePrimary, genreSecondary });
  stateRef.current = { prompt, genrePrimary, genreSecondary };

  const handleSubmit = useCallback(() => {
    const { prompt, genrePrimary, genreSecondary } = stateRef.current;
    if (prompt.length < 10 || !genrePrimary) return;
    const intent: RawIntent = {
      prompt,
      genre_primary: genrePrimary,
      genre_secondary: genreSecondary === NO_SECONDARY ? null : genreSecondary,
    };
    // 父级 orchestrator 负责触发 /decompose + /diverge
    onSubmitted(intent);
  }, [onSubmitted]);

  useEffect(() => {
    onSubmitReady?.(valid ? handleSubmit : null, valid);
    return () => onSubmitReady?.(null, false);
  }, [valid, handleSubmit, onSubmitReady]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-2 pb-4">
        <div className="bg-surface-container-low border border-outline-variant rounded-lg p-4 space-y-3">
          <div>
            <label
              htmlFor="prompt"
              className="block font-display text-sm font-medium text-primary mb-1"
            >
              灵感点子 <span className="text-on-surface-variant text-xs">(≥10 字)</span>
            </label>
            <textarea
              id="prompt"
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container resize-y"
              rows={8}
              maxLength={MAX_PROMPT}
              placeholder="一句话描述你想写的故事核心 — 比如:赛博朋克 + 修仙 + 双男主"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="flex justify-end mt-1">
              <span className={`font-mono text-[10px] ${prompt.length < 10 ? "text-on-surface-variant" : "text-primary-container"}`}>
                {prompt.length} / {MAX_PROMPT} 字
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="genre_primary"
                className="block font-display text-sm font-medium text-primary mb-1"
              >
                主类型
              </label>
              {genreOptions.length > 0 ? (
                <DropdownSelect
                  label="类型"
                  options={genreOptions}
                  value={genrePrimary}
                  onChange={setGenrePrimary}
                />
              ) : (
                <input
                  id="genre_primary"
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary"
                  value={genrePrimary}
                  onChange={(e) => setGenrePrimary(e.target.value)}
                />
              )}
            </div>
            <div>
              <label
                htmlFor="genre_secondary"
                className="block font-display text-sm font-medium text-primary mb-1"
              >
                副类型 <span className="text-on-surface-variant text-xs">(可选)</span>
              </label>
              {genreOptionsWithNone.length > 0 ? (
                <DropdownSelect
                  label="类型"
                  options={genreOptionsWithNone}
                  value={genreSecondary}
                  onChange={setGenreSecondary}
                />
              ) : (
                <input
                  id="genre_secondary"
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary"
                  value={genreSecondary === NO_SECONDARY ? "" : genreSecondary}
                  onChange={(e) =>
                    setGenreSecondary(e.target.value || NO_SECONDARY)
                  }
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
