import { useEffect, useRef, useState } from "react";
import api, { Concept, StoryDNA } from "../../api/client";
import { useWizard } from "./WizardContext";
import { RegenerateModal } from "../shared/RegenerateModal";

interface ConceptStepProps {
  projectId: string;
}

const EMPTY_CONCEPT: Concept = {
  title: "", genre: "", premise: "", tone: "", theme: "", target_audience: "", style_template: "",
};

const EMPTY_DNA: StoryDNA = {
  core_contradiction: { statement: "", side_a: "", side_b: "" },
  value_stack: [],
};

export default function ConceptStep({ projectId }: ConceptStepProps) {
  const wizard = useWizard();
  const [concept, setConcept] = useState<Concept>(wizard.data.concept ?? EMPTY_CONCEPT);
  const [dna, setDna] = useState<StoryDNA>(wizard.data.story_dna ?? EMPTY_DNA);
  const [busy, setBusy] = useState(false);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  // Mirror the latest state so handlers registered in the modal footer
  // (with limited deps) read fresh values, not the snapshot from when the
  // useEffect last ran.
  const conceptRef = useRef(concept);
  conceptRef.current = concept;
  const dnaRef = useRef(dna);
  dnaRef.current = dna;

  const handleStart = async (userModifications: string = "") => {
    wizard.startStep(1);
    setBusy(true);
    try {
      const result = await api.generateConcept(projectId, userModifications);
      setConcept(result.concept);
      setDna(result.story_dna);
      // v1.8.4: mark generated so step 1 stays reachable in the indicator
      // when the user navigates away before clicking "下一步".
      wizard.markStepGenerated(1, { concept: result.concept, story_dna: result.story_dna });
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "概念生成失败");
    } finally {
      setBusy(false);
    }
  };

  const handleNext = async () => {
    setBusy(true);
    try {
      await api.updateConcept(projectId, conceptRef.current, dnaRef.current);
      try {
        await api.advance(projectId, "STAGE2");
      } catch {
        // best-effort: preconditions may not be met if user goes back and re-saves
      }
      wizard.saveStep(1, { concept: conceptRef.current, story_dna: dnaRef.current });
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "概念保存失败");
    } finally {
      setBusy(false);
    }
  };

  // Sync local `concept`/`dna` state from wizard.data when prefill lands.
  // Only overwrite if the user hasn't typed anything yet (local state still
  // matches the EMPTY defaults). Without this, a user who re-enters the
  // wizard with stale sessionStorage (data.concept=null but file exists on
  // disk) would see an empty form.
  useEffect(() => {
    const persisted = wizard.data.concept;
    if (persisted && concept.title === "" && concept.genre === "") {
      setConcept(persisted);
    }
    const persistedDna = wizard.data.story_dna;
    if (persistedDna && dna.core_contradiction.statement === "" && dna.value_stack.length === 0) {
      setDna(persistedDna);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.data.concept, wizard.data.story_dna]);

  // Auto-trigger generation on mount if no concept has been generated yet.
  // Errors keep the error UI visible so the user can hit "重新生成" in the footer.
  //
  // v1.8.2: wait for prefill to finish before deciding — same race-condition
  // fix as OutlineStep (proj_cc4ca4ae regression).
  useEffect(() => {
    if (!wizard.prefillComplete) return;
    if (
      !wizard.data.concept &&
      wizard.status !== "generating" &&
      wizard.status !== "error"
    ) {
      handleStart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.prefillComplete]);

  // 重新生成 / 确认修改并继续 are rendered by the modal footer; the step
  // just registers the handlers and the current busy state.
  useEffect(() => {
    const canRegenerate =
      !!wizard.data.concept ||
      wizard.status === "completed" ||
      wizard.status === "error";
    const canSave = wizard.status === "completed" || !!wizard.data.concept;
    wizard.setRegenerateHandler(canRegenerate ? () => setShowRegenerateModal(true) : null, busy);
    wizard.setNextHandler(canSave ? handleNext : null, busy);
    return () => {
      wizard.setRegenerateHandler(null, false);
      wizard.setNextHandler(null, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.status, !!wizard.data.concept, busy]);

  return (
    <div data-testid="concept-step" className="space-y-4">
      {wizard.status === "generating" && (
        <div data-testid="concept-loading" className="text-center py-12">
          <span className="material-symbols-outlined text-4xl text-primary-container animate-spin inline-block">progress_activity</span>
          <p className="font-body-ui text-system-log mt-3 text-sm">正在生成概念与 Story DNA…</p>
        </div>
      )}

      {wizard.status === "error" && (
        <div data-testid="concept-error" className="p-4 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-sm">
          {wizard.errorMessage}
        </div>
      )}

      {(wizard.status === "completed" || wizard.data.concept) && (
        <div data-testid="concept-form" className="space-y-3">
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
            <label className="block font-label-mono text-system-log mb-1 text-xs">前提</label>
            <textarea
              data-testid="concept-premise"
              value={concept.premise}
              onChange={(e) => setConcept({ ...concept, premise: e.target.value })}
              rows={3}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
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
            <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">核心矛盾</div>
            <textarea
              data-testid="concept-statement"
              value={dna.core_contradiction.statement}
              onChange={(e) => setDna({ ...dna, core_contradiction: { ...dna.core_contradiction, statement: e.target.value } })}
              rows={2}
              placeholder="一句话概述核心冲突"
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
            />
            <div className="grid grid-cols-2 gap-3">
              <textarea
                value={dna.core_contradiction.side_a}
                onChange={(e) => setDna({ ...dna, core_contradiction: { ...dna.core_contradiction, side_a: e.target.value } })}
                rows={2}
                placeholder="立场 A"
                className="bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
              />
              <textarea
                value={dna.core_contradiction.side_b}
                onChange={(e) => setDna({ ...dna, core_contradiction: { ...dna.core_contradiction, side_b: e.target.value } })}
                rows={2}
                placeholder="立场 B"
                className="bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
              />
            </div>
          </div>

          {/* 重新生成 / 确认修改并继续 buttons moved to modal footer (see useEffect above). */}
        </div>
      )}

      <RegenerateModal
        open={showRegenerateModal}
        target="概念"
        onConfirm={async (text) => {
          setShowRegenerateModal(false);
          await handleStart(text);
        }}
        onCancel={() => setShowRegenerateModal(false)}
      />
    </div>
  );
}
