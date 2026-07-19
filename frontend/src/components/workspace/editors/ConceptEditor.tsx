import { useEffect, useRef, useState } from "react";
import api, { Concept, ConceptResponse, StoryDNA } from "../../../api/client";
import { useAutoHeight } from "../../../hooks/useAutoHeight";

interface BaseEditorProps {
  projectId: string;
  data: unknown;
  onSaved: () => void;
  readOnly?: boolean;
}

const EMPTY_CONCEPT: Concept = {
  title: "", genre: "", premise: "", tone: "", theme: "", target_audience: "", style_template: "",
};

const EMPTY_DNA: StoryDNA = {
  core_contradiction: { statement: "", side_a: "", side_b: "" },
  value_stack: [],
};

function readPayload(data: unknown): { concept: Concept; storyDna: StoryDNA } {
  const payload = data as Partial<ConceptResponse> | null;
  return {
    concept: payload?.concept ?? EMPTY_CONCEPT,
    storyDna: payload?.story_dna ?? EMPTY_DNA,
  };
}

/**
 * In-place editor for Stage1 Concept + Story DNA. v1.8 Bug 3 fix: replaces
 * the old preview-only truncation in ContextPanel with a full editable form.
 * Save → api.updateConcept. Cancel reverts to the last-saved snapshot.
 */
export default function ConceptEditor({ projectId, data, onSaved, readOnly }: BaseEditorProps) {
  const seed = readPayload(data);
  const [concept, setConcept] = useState<Concept>(seed.concept);
  const [dna, setDna] = useState<StoryDNA>(seed.storyDna);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conceptRef = useRef(concept);
  conceptRef.current = concept;
  const dnaRef = useRef(dna);
  dnaRef.current = dna;
  const premiseRef = useRef<HTMLTextAreaElement>(null);
  const statementRef = useRef<HTMLTextAreaElement>(null);
  const sideARef = useRef<HTMLTextAreaElement>(null);
  const sideBRef = useRef<HTMLTextAreaElement>(null);
  useAutoHeight(premiseRef, [concept.premise]);
  useAutoHeight(statementRef, [dna.core_contradiction.statement]);
  useAutoHeight(sideARef, [dna.core_contradiction.side_a]);
  useAutoHeight(sideBRef, [dna.core_contradiction.side_b]);

  // Re-seed local state whenever the parent's data refetch lands (e.g. after
  // a save). Without this the form would keep showing the user's edits even
  // after the parent re-fetched and the underlying file changed.
  useEffect(() => {
    setConcept(readPayload(data).concept);
    setDna(readPayload(data).storyDna);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.updateConcept(projectId, conceptRef.current, dnaRef.current);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    const reset = readPayload(data);
    setConcept(reset.concept);
    setDna(reset.storyDna);
    setError(null);
  };

  return (
    <div data-testid="concept-editor" className="space-y-3">
      <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">概念</div>

      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">标题</label>
        <input
          data-testid="concept-title"
          value={concept.title}
          onChange={(e) => setConcept({ ...concept, title: e.target.value })}
          className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
        />
      </div>
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">类型 (genre)</label>
        <input
          data-testid="concept-genre"
          value={concept.genre}
          onChange={(e) => setConcept({ ...concept, genre: e.target.value })}
          className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
        />
      </div>
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">前提 (premise)</label>
        <textarea
          ref={premiseRef}
          data-testid="concept-premise"
          value={concept.premise}
          onChange={(e) => setConcept({ ...concept, premise: e.target.value })}
          className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container overflow-hidden"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">基调</label>
          <input
            data-testid="concept-tone"
            value={concept.tone}
            onChange={(e) => setConcept({ ...concept, tone: e.target.value })}
            className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
          />
        </div>
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">主题</label>
          <input
            data-testid="concept-theme"
            value={concept.theme}
            onChange={(e) => setConcept({ ...concept, theme: e.target.value })}
            className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">目标读者</label>
          <input
            value={concept.target_audience}
            onChange={(e) => setConcept({ ...concept, target_audience: e.target.value })}
            className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
          />
        </div>
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">风格模板</label>
          <input
            value={concept.style_template}
            onChange={(e) => setConcept({ ...concept, style_template: e.target.value })}
            className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
          />
        </div>
      </div>

      <div className="border-t border-outline-variant pt-3 space-y-2">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">核心矛盾 (Story DNA)</div>
        <textarea
          ref={statementRef}
          data-testid="concept-statement"
          value={dna.core_contradiction.statement}
          onChange={(e) => setDna({ ...dna, core_contradiction: { ...dna.core_contradiction, statement: e.target.value } })}
          placeholder="一句话概述核心冲突"
          className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container overflow-hidden"
        />
        <div className="grid grid-cols-2 gap-3">
          <textarea
            ref={sideARef}
            data-testid="concept-side-a"
            value={dna.core_contradiction.side_a}
            onChange={(e) => setDna({ ...dna, core_contradiction: { ...dna.core_contradiction, side_a: e.target.value } })}
            placeholder="立场 A"
            className="bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container overflow-hidden"
          />
          <textarea
            ref={sideBRef}
            data-testid="concept-side-b"
            value={dna.core_contradiction.side_b}
            onChange={(e) => setDna({ ...dna, core_contradiction: { ...dna.core_contradiction, side_b: e.target.value } })}
            placeholder="立场 B"
            className="bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container overflow-hidden"
          />
        </div>
      </div>

      {error && (
        <div data-testid="concept-editor-error" className="p-2 bg-error-container/20 border border-error rounded text-error font-body-ui text-xs">
          {error}
        </div>
      )}

      <footer className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          data-testid="concept-editor-cancel"
          onClick={handleCancel}
          disabled={busy}
          className="px-3 py-1 text-xs bg-surface-container text-system-log rounded-lg hover:bg-surface-container-low disabled:opacity-40"
        >取消</button>
        <button
          type="button"
          data-testid="concept-editor-save"
          onClick={handleSave}
          disabled={busy || readOnly}
          title={readOnly ? "托管运行中,元数据已锁定" : undefined}
          className="px-4 py-1 text-xs bg-tertiary-container text-surface-container-low rounded-lg hover:opacity-90 disabled:opacity-40"
        >{busy ? "保存中…" : "保存"}</button>
      </footer>
    </div>
  );
}
