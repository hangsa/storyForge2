import { useState } from "react";
import api from "@/api/client";
import type { RawIntent } from "./types";

interface Props {
  projectId: string;
  initial: RawIntent | null;
  onSubmitted: (intent: RawIntent, divergeResp: Record<string, unknown>) => void;
}

export default function S1InputStep({ projectId, initial, onSubmitted }: Props) {
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [genrePrimary, setGenrePrimary] = useState(initial?.genre_primary ?? "");
  const [genreSecondary, setGenreSecondary] = useState<string | null>(
    initial?.genre_secondary ?? null,
  );
  const [submitting, setSubmitting] = useState(false);

  const valid = prompt.length >= 10 && genrePrimary.length > 0;

  async function handleSubmit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const intent: RawIntent = {
        prompt,
        genre_primary: genrePrimary,
        genre_secondary: genreSecondary,
      };
      const resp = await api.postThreeBDiverge(projectId, intent);
      onSubmitted(intent, resp);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="prompt" className="block text-sm font-medium">
          灵感点子 (≥10 字)
        </label>
        <textarea
          id="prompt"
          className="w-full border rounded p-2"
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="genre_primary" className="block text-sm font-medium">
          主类型
        </label>
        <input
          id="genre_primary"
          className="w-full border rounded p-2"
          value={genrePrimary}
          onChange={(e) => setGenrePrimary(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="genre_secondary" className="block text-sm font-medium">
          副类型 (可选)
        </label>
        <input
          id="genre_secondary"
          className="w-full border rounded p-2"
          value={genreSecondary ?? ""}
          onChange={(e) => setGenreSecondary(e.target.value || null)}
        />
      </div>
      <button
        type="button"
        disabled={!valid || submitting}
        onClick={handleSubmit}
        className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
      >
        {submitting ? "发散中…" : "开始 3B 发散"}
      </button>
    </div>
  );
}
