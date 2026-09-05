import { useMemo, useState } from "react";
import api from "@/api/client";
import { useGenres } from "@/hooks/useGenres";
import { DropdownSelect, PrimaryButton } from "@/components/ds";
import type { DivergeResponse, RawIntent } from "./types";

interface Props {
  projectId: string;
  initial: RawIntent | null;
  onSubmitted: (intent: RawIntent, divergeResp: DivergeResponse) => void;
}

const NO_SECONDARY = "__none__";

export default function S1InputStep({ projectId, initial, onSubmitted }: Props) {
  const genres = useGenres(true);
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [genrePrimary, setGenrePrimary] = useState(initial?.genre_primary ?? "");
  const [genreSecondary, setGenreSecondary] = useState<string>(
    initial?.genre_secondary ?? NO_SECONDARY,
  );
  const [submitting, setSubmitting] = useState(false);

  const genreOptions = useMemo(
    () => genres.map((g) => ({ value: g.id, label: g.label_zh })),
    [genres],
  );
  const genreOptionsWithNone = useMemo(
    () => [{ value: NO_SECONDARY, label: "无" }, ...genreOptions],
    [genreOptions],
  );

  const valid = prompt.length >= 10 && genrePrimary.length > 0;

  async function handleSubmit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const intent: RawIntent = {
        prompt,
        genre_primary: genrePrimary,
        genre_secondary:
          genreSecondary === NO_SECONDARY ? null : genreSecondary,
      };
      const resp = await api.postThreeBDiverge(projectId, intent);
      onSubmitted(intent, resp);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
        Stage 1 · 灵感输入
      </header>

      <div className="border border-outline-variant rounded-lg p-4 space-y-3">
        <div>
          <label
            htmlFor="prompt"
            className="block font-mono text-primary-container mb-1 text-xs"
          >
            灵感点子 (≥10 字)
          </label>
          <textarea
            id="prompt"
            className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="genre_primary"
              className="block font-mono text-primary-container mb-1 text-xs"
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
                className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
                value={genrePrimary}
                onChange={(e) => setGenrePrimary(e.target.value)}
              />
            )}
          </div>
          <div>
            <label
              htmlFor="genre_secondary"
              className="block font-mono text-primary-container mb-1 text-xs"
            >
              副类型 (可选)
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
                className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
                value={genreSecondary === NO_SECONDARY ? "" : genreSecondary}
                onChange={(e) =>
                  setGenreSecondary(e.target.value || NO_SECONDARY)
                }
              />
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <PrimaryButton
          label={submitting ? "发散中…" : "开始 3B 发散"}
          icon={submitting ? undefined : "auto_awesome"}
          loading={submitting}
          disabled={!valid}
          onClick={handleSubmit}
        />
      </div>
    </div>
  );
}