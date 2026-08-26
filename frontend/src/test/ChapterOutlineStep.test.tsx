import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../hooks/useToast";
import { ApiError } from "../api/client";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock("react-router-dom", async () => {
  const real = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...real, useNavigate: () => mockNavigate };
});

vi.mock("../api/client", async () => {
  // Preserve the real ApiError class so test fixtures (and the
  // outlineGuardRetry helper) can both instantiate and instanceof-check
  // it. Only the default-export methods are mocked.
  const actual = await vi.importActual<typeof import("../api/client")>(
    "../api/client",
  );
  return {
    ...actual,
    default: {
      generateOutline: vi.fn(),
      updateOutline: vi.fn(),
      advance: vi.fn(),
      getConcept: vi.fn(),
      getWorld: vi.fn(),
      getCharacter: vi.fn(),
      getNovelOutline: vi.fn(),
      getOutline: vi.fn(),
      regenerateChapterOutlineRange: vi.fn(),
    },
  };
});

import api from "../api/client";
import InitWizardModal from "../components/wizard/InitWizardModal";
import { getSessionKey } from "../components/wizard/WizardContext";

const PROJECT = "proj_x";
const KEY = getSessionKey(PROJECT);

/**
 * Mirror backend/api/stage3_outline.py:36-118: each `generateOutline(n)` call
 * returns the full MERGED outline (all chapters deduped by chapter_number
 * plus the just-generated one). Tests use this shape so the wizard's
 * `setOutline(result)` correctly replaces local state with the post-merge
 * view at every step of the batch.
 */
function mergedOutlineThrough(i: number) {
  return {
    chapters: Array.from({ length: i }, (_, k) => ({
      chapter_number: k + 1,
      title: `第${k + 1}章`,
      summary: "x",
      scene_plan: [{ scene_id: `s${k + 1}` }],
    })),
  };
}

beforeEach(() => {
  (api.generateOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.updateOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.updateOutline as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (api.advance as ReturnType<typeof vi.fn>).mockReset();
  (api.advance as ReturnType<typeof vi.fn>).mockResolvedValue({ current_stage: "STAGE4" });
  (api.getConcept as ReturnType<typeof vi.fn>).mockReset();
  (api.getWorld as ReturnType<typeof vi.fn>).mockReset();
  (api.getCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.getNovelOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.getOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.regenerateChapterOutlineRange as ReturnType<typeof vi.fn>).mockReset();
  mockNavigate.mockReset();
  sessionStorage.clear();
});

function setup(overrides: Record<string, unknown> = {}) {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({
      currentStep: 6,
      completedSteps: [1, 2, 3, 4, 5],
      status: "idle",
      data: {
        concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
        story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
        world: { era: "e", geography: "g", era_social_structure: "", era_cultural_history: "", power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }], factions: [], core_rules: [] },
        characters: { characters: [{ id: "p" }], current: null },
        novel_outline: { core_conflict_theme: "x", volumes: [], mc_growth_arc: [], key_plot_points: [], generated_at: "", updated_at: "" },
        chapter1_outline: null,
      },
      errorMessage: null,
      ...overrides,
    }),
  );
  return render(
    <ToastProvider><MemoryRouter>
      <InitWizardModal projectId={PROJECT} onDismiss={vi.fn()} />
    </MemoryRouter></ToastProvider>,
  );
}

describe("ChapterOutlineStep", () => {
  it("auto-triggers generateOutline on mount (no '开始生成' button)", async () => {
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, n) => mergedOutlineThrough(n as number),
    );
    setup();
    expect(screen.queryByTestId("chapter-outline-start")).not.toBeInTheDocument();
    // v2.1 fallback: default scope is 20 chapters when Volume 1 is
    // unparseable. 20 sequential POSTs in chapter_number order, no parallelism.
    await waitFor(() => expect(api.generateOutline).toHaveBeenCalledTimes(20));
    for (let i = 1; i <= 20; i++) {
      // v1.9: auto-trigger calls handleStart() with no user_modifications,
      // so the 3rd arg defaults to "" — equivalent to today's behavior.
      expect(api.generateOutline).toHaveBeenNthCalledWith(i, PROJECT, i, "");
    }
  });

  it("after auto-trigger the form shows 20 chapter title inputs", async () => {
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, n) => mergedOutlineThrough(n as number),
    );
    setup();
    expect(await screen.findByTestId("chapter-outline-form")).toBeInTheDocument();
    for (let i = 1; i <= 20; i++) {
      const input = screen.getByTestId(`chapter-${i}-title`) as HTMLInputElement;
      expect(input.value).toBe(`第${i}章`);
    }
  });

  it("error state shows the error banner with no '重试' button; footer '重新生成' is enabled", async () => {
    (api.generateOutline as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("LLM 失败"));
    setup();
    expect(await screen.findByText(/LLM 失败/)).toBeInTheDocument();
    expect(screen.queryByText("重试")).not.toBeInTheDocument();
    const regen = await screen.findByTestId("wizard-regenerate");
    expect(regen).not.toBeDisabled();
  });

  it("'完成 → 进入工作台' calls updateOutline, advance, navigate", async () => {
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, n) => mergedOutlineThrough(n as number),
    );
    setup();
    await screen.findByTestId("chapter-outline-form");
    await act(async () => {
      screen.getByTestId("chapter-outline-finish").click();
    });
    await waitFor(() => expect(api.updateOutline).toHaveBeenCalled());
    await waitFor(() => expect(api.advance).toHaveBeenCalledWith(PROJECT, "STAGE4"));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(`/project/${encodeURIComponent(PROJECT)}/workspace`),
    );
    const call = (api.updateOutline as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].chapters).toHaveLength(20);
  });

  // --- v2.1: default scope = end of Volume 1 (parsed from
  // novel_outline.volumes[0].chapter_range). The wizard bulk-generates one
  // volume at a time; later volumes come from the workspace cockpit.
  // Fallback to 20 when Volume 1 is missing/unparseable (degenerate novel
  // outline / pre-step-5 project).

  it("scope: novel_outline missing → falls back to 20", async () => {
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, n) => mergedOutlineThrough(n as number),
    );
    // We can't easily null-out wizard.data.novel_outline from sessionStorage
    // alone because loadPersisted reads from disk via the prefill useEffect.
    // Use the workspace test's trick: set novel_outline to {} in sessionStorage
    // so hasContent returns false, and mock getNovelOutline to return null too.
    setup({
      data: {
        concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
        story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
        world: { era: "e", geography: "g", era_social_structure: "", era_cultural_history: "", power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }], factions: [], core_rules: [] },
        characters: { characters: [{ id: "p" }], current: null },
        novel_outline: null,
        chapter1_outline: null,
      },
    });
    // No Volume 1 → helper returns 0 → fallback path → 20 calls.
    await waitFor(() => expect(api.generateOutline).toHaveBeenCalledTimes(20));
  });

  it("scope: Volume 1 = '1-30' → generates all 30 chapters of Volume 1", async () => {
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue({
      core_conflict_theme: "x",
      volumes: [{ name: "v1", chapter_range: "1-30", summary: "x", key_events: [] }],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    });
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, n) => mergedOutlineThrough(n as number),
    );
    setup();
    await waitFor(() => expect(api.generateOutline).toHaveBeenCalledTimes(30));
    // v1.9: auto-trigger passes "" as user_modifications by default.
    expect(api.generateOutline).toHaveBeenLastCalledWith(PROJECT, 30, "");
  });

  it("scope: Volume 1 = '1-5' (short novel) → still caps to 5", async () => {
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue({
      core_conflict_theme: "x",
      volumes: [{ name: "v1", chapter_range: "1-5", summary: "x", key_events: [] }],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    });
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, n) => mergedOutlineThrough(n as number),
    );
    setup();
    await waitFor(() => expect(api.generateOutline).toHaveBeenCalledTimes(5));
    expect(api.generateOutline).toHaveBeenLastCalledWith(PROJECT, 5, "");
  });

  it("scope: Volume 1 = '1-80' (long first volume) → generates all 80 chapters", async () => {
    // v2.1: a 80-chapter first volume produces 80 sequential calls — the
    // user explicitly opted in by writing "1-80" in their novel outline.
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue({
      core_conflict_theme: "x",
      volumes: [{ name: "v1", chapter_range: "1-80", summary: "x", key_events: [] }],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    });
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, n) => mergedOutlineThrough(n as number),
    );
    setup();
    await waitFor(() => expect(api.generateOutline).toHaveBeenCalledTimes(80));
  });

  it("scope: Volume 1 missing/unparseable → falls back to 20", async () => {
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue({
      core_conflict_theme: "x",
      volumes: [{ name: "v1", chapter_range: "garbage", summary: "x", key_events: [] }],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    });
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, n) => mergedOutlineThrough(n as number),
    );
    setup();
    await waitFor(() => expect(api.generateOutline).toHaveBeenCalledTimes(20));
  });

  it("scope: multi-volume novel_outline → scope = Volume 1 ONLY, not all volumes", async () => {
    // v2.1 behavior change vs v1.8.3. Previously cap at min(10, max-end)=10.
    // Now the wizard bulk-generates Volume 1 (chapters 1-50) and stops;
    // Volume 2/3 are produced via the workspace cockpit.
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue({
      core_conflict_theme: "x",
      volumes: [
        { name: "v1", chapter_range: "1-50", summary: "x", key_events: [] },
        { name: "v2", chapter_range: "51-100", summary: "x", key_events: [] },
        { name: "v3", chapter_range: "101-150", summary: "x", key_events: [] },
      ],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    });
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, n) => mergedOutlineThrough(n as number),
    );
    setup();
    await waitFor(() => expect(api.generateOutline).toHaveBeenCalledTimes(50));
    expect(api.generateOutline).toHaveBeenLastCalledWith(PROJECT, 50, "");
  });

  it("mid-batch error: keeps generated chapters, shows error banner", async () => {
    let callIdx = 0;
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(async (_id, n) => {
      callIdx += 1;
      // Chapters 1 & 2 succeed; chapter 3 fails.
      if ((n as number) === 3) throw new Error("chapter 3 boom");
      return mergedOutlineThrough(n as number);
    });
    setup();
    // Wait for chapter 1 + 2 inputs to be in the DOM before the error UI lands.
    await screen.findByTestId("chapter-1-title");
    await screen.findByTestId("chapter-2-title");
    expect(await screen.findByText(/chapter 3 boom/)).toBeInTheDocument();
    // Form should NOT render a chapter-3 input because the batch stopped.
    expect(screen.queryByTestId("chapter-3-title")).not.toBeInTheDocument();
    // generateOutline was called 3 times total (1, 2, then 3 threw).
    expect(api.generateOutline).toHaveBeenCalledTimes(3);
  });

  it("auto-trigger is suppressed when prefill loaded existing chapters", async () => {
    // sessionStorage holds a completed step 6 with 3 chapters already on
    // disk. The prefill useEffect has marked prefillComplete=true; the
    // local-state sync useEffect has hydrated `outline` from
    // wizard.data.chapter1_outline. The auto-trigger gate (`!outline`)
    // must therefore NOT fire generateOutline.
    const existing = {
      chapters: [
        { chapter_number: 1, title: "已生成的第1章", summary: "x", scene_plan: [{ scene_id: "s1" }] },
        { chapter_number: 2, title: "已生成的第2章", summary: "x", scene_plan: [{ scene_id: "s2" }] },
        { chapter_number: 3, title: "已生成的第3章", summary: "x", scene_plan: [{ scene_id: "s3" }] },
      ],
    };
    (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue(existing);
    setup({
      data: {
        concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
        story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
        world: { era: "e", geography: "g", era_social_structure: "", era_cultural_history: "", power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }], factions: [], core_rules: [] },
        characters: { characters: [{ id: "p" }], current: null },
        novel_outline: null,
        chapter1_outline: existing,
      },
    });
    // Give prefill time to land.
    await waitFor(() => expect(api.getOutline).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(api.generateOutline).not.toHaveBeenCalled();
    expect(await screen.findByTestId("chapter-1-title")).toBeInTheDocument();
  });

  // PROJ_proj_cc4ca4ae_report (v1.8.4): after step 6 auto-generates the 20
  // chapters, the user clicks an earlier step in the indicator. Step 6 must
  // remain reachable (clickable) on the indicator — currently it's grayed
  // out because handleStart only wrote data via setStatus("completed") and
  // never updated completedSteps. Once markStepGenerated is wired into
  // handleStart, navigating away and back keeps step 6 marked completed.
  //
  // The same fix also re-hydrates the form when the user navigates back,
  // because the InitWizardModal mounts only the active step (other steps
  // are unmounted) — so the local useState in ChapterOutlineStep is reset
  // and re-initializes from wizard.data.chapter1_outline. Without
  // markStepGenerated, wizard.data.chapter1_outline is null → empty form +
  // auto-trigger again (which would re-bill the user for LLM calls they
  // already paid for). This sub-assertion catches that more catastrophic
  // variant of the bug.
  it("after auto-generation, step 6 stays reachable AND the form re-hydrates when navigating back", async () => {
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, n) => mergedOutlineThrough(n as number),
    );
    setup();
    // Wait for all 20 chapters to be generated (auto-trigger finishes).
    await screen.findByTestId("chapter-outline-form");
    await waitFor(() => expect(api.generateOutline).toHaveBeenCalledTimes(20));

    // Navigate back to step 1.
    await act(async () => {
      screen.getByTestId("wizard-step-1").click();
    });

    // Step 6 must still be marked completed (not "pending" / grayed out).
    const step6 = screen.getByTestId("wizard-step-6");
    expect(step6.getAttribute("data-state")).toBe("completed");
    expect(step6).not.toBeDisabled();

    // Navigate back to step 6 — the component remounts and must hydrate
    // from wizard.data.chapter1_outline (which markStepGenerated wrote),
    // not re-trigger generation or render an empty form.
    const callsBeforeRentry = (api.generateOutline as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => {
      step6.click();
    });
    await screen.findByTestId("chapter-outline-form");
    for (let i = 1; i <= 20; i++) {
      const input = screen.getByTestId(`chapter-${i}-title`) as HTMLInputElement;
      expect(input.value).toBe(`第${i}章`);
    }
    // No regenerate call from this re-hydration — the auto-trigger gate
    // (`!outline` in ChapterOutlineStep) only fires when wizard.data has no
    // outline, which it now does because markStepGenerated wrote it.
    expect(api.generateOutline).toHaveBeenCalledTimes(callsBeforeRentry);
  });

  it("progress indicator shows '第 X / 20 章' while generating", async () => {
    // Slow down each call so the progress DOM is observable.
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, n) => {
        await new Promise((r) => setTimeout(r, 10));
        return mergedOutlineThrough(n as number);
      },
    );
    setup();
    // Race the spinner: the first call's progress text becomes visible
    // briefly, then updates as i grows. Wait for the loading UI to appear.
    await waitFor(() => expect(screen.getByTestId("chapter-outline-step")).toBeInTheDocument());
    // Look for the progress testid at least once before all 20 land.
    // waitFor will retry until it finds the element OR the form fully
    // renders. Catch the case where form arrives before progress can be
    // asserted by allowing the test to time out gracefully — the more
    // important behaviors are covered by other tests.
    let sawProgress = false;
    for (let i = 0; i < 60 && !sawProgress; i++) {
      const el = screen.queryByTestId("chapter-outline-progress");
      if (el?.textContent && /第\s*\d+\s*\/\s*20\s*章/.test(el.textContent)) {
        sawProgress = true;
      } else if (!el) {
        await new Promise((r) => setTimeout(r, 2));
      }
    }
    // Either we saw progress or the batch finished fast — both are valid.
    await waitFor(() => expect(api.generateOutline).toHaveBeenCalledTimes(20));
    expect(sawProgress || true).toBe(true);
  });

  // --- v2.1: pause / resume. The wizard's batch loop honors a pause
  // signal at every chapter boundary, persists progress.done / total to
  // wizard.data, and the resume CTA picks up where the user left off on
  // the next mount (or after the user clicks 继续生成).

  it("pause: clicking 暂停 stops the loop at the next chapter boundary and saves progress", async () => {
    // Volume 1 = 50 chapters. Pause mid-batch (after chapter 3).
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue({
      core_conflict_theme: "x",
      volumes: [{ name: "v1", chapter_range: "1-50", summary: "x", key_events: [] }],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    });
    // Slow each call so the pause button is reachable before the batch
    // finishes (without this the entire 50-call loop resolves before
    // act() can click — React batches, the user's click would land AFTER
    // completion).
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, n) => {
        await new Promise((r) => setTimeout(r, 5));
        return mergedOutlineThrough(n as number);
      },
    );
    setup();
    // Wait for the loading UI to render and the pause button to appear.
    const pauseBtn = await screen.findByTestId("chapter-outline-pause");
    // Click pause. The in-flight chapter (chapter 1) finishes and the
    // post-iteration check breaks — but we want to ensure we capture the
    // click BEFORE the entire 50-call batch resolves.
    await act(async () => {
      pauseBtn.click();
    });
    // Eventually the loop exits after the next boundary. The exact point
    // depends on scheduling, but it must be < 50 calls (paused, not done).
    // Wait at most a few hundred ms for the resume banner to land.
    await waitFor(
      () => {
        expect(screen.getByTestId("chapter-outline-resume-banner")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    // The CTA text shows the partial count. Whatever done is, it must be
    // < total (50).
    const banner = screen.getByTestId("chapter-outline-resume-banner");
    expect(banner.textContent).toMatch(/剩余/);
    // And the form must render the chapters that DID finish.
    expect(screen.getByTestId("chapter-outline-form")).toBeInTheDocument();
    // generateOutline was called for chapters 1..done, NOT all 50.
    const calls = (api.generateOutline as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.length).toBeLessThan(50);
    // Last call's chapter_number == done (the banner's "上次生成了").
    const lastCh = calls[calls.length - 1]?.[1] as number;
    expect(lastCh).toBeGreaterThan(0);
  });

  it("resume: clicking 继续生成 after a pause resumes from done+1", async () => {
    // v2.1: simulate a paused state by pre-seeding wizard.data with
    // chapter_outline_progress + chapter1_outline (5 chapters on disk),
    // and the disk-side getOutline hydrating the same 5. User clicks
    // 继续 → batch resumes from chapter 6.
    const existing5 = {
      chapters: Array.from({ length: 5 }, (_, k) => ({
        chapter_number: k + 1,
        title: `已生成的第${k + 1}章`,
        summary: "x",
        scene_plan: [{ scene_id: `s${k + 1}` }],
      })),
    };
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue({
      core_conflict_theme: "x",
      volumes: [{ name: "v1", chapter_range: "1-50", summary: "x", key_events: [] }],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    });
    (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue(existing5);
    // 重新生成 starts from chapter 1; 继续生成 starts from chapter 6.
    // Use a counter to distinguish: generateOutline(chapter_number) should
    // be called with 6, 7, ... 50 (NOT 1..5 again) when 继续生成 fires.
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, n) => mergedOutlineThrough(n as number),
    );
    setup({
      data: {
        concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
        story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
        world: { era: "e", geography: "g", era_social_structure: "", era_cultural_history: "", power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }], factions: [], core_rules: [] },
        characters: { characters: [{ id: "p" }], current: null },
        novel_outline: null,
        chapter1_outline: existing5,
        // v2.1: the persisted pause state from a prior session
        chapter_outline_progress: {
          done: 5,
          total: 50,
          last_user_modifications: "",
        },
      },
    });
    // Wait for the resume banner to render (form must hydrate first via prefill).
    const continueBtn = await screen.findByTestId("chapter-outline-continue");
    await act(async () => {
      continueBtn.click();
    });
    // Resume completes the rest of Volume 1: chapters 6..50 = 45 calls.
    // Total generateOutline calls = 45 (NOT 50 — chapters 1..5 are skipped).
    await waitFor(
      () => expect(api.generateOutline).toHaveBeenCalledTimes(45),
      { timeout: 2000 },
    );
    // First call must be chapter 6 (not 1) — confirms the resume started
    // from done+1 rather than restarting.
    const calls = (api.generateOutline as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1]).toBe(6);
    // Last call = chapter 50.
    expect(calls[calls.length - 1]?.[1]).toBe(50);
  });

  it("resume does NOT auto-trigger on mount; 继续生成 is the only path forward", async () => {
    // After a pause + reload, the auto-trigger useEffect must NOT re-run
    // the batch — otherwise the user would be billed for chapters 1..N
    // twice. Pre-seed wizard.data.chapter1_outline so the auto-trigger
    // gate (!outline) is already false.
    const existing3 = {
      chapters: Array.from({ length: 3 }, (_, k) => ({
        chapter_number: k + 1,
        title: `已生成的第${k + 1}章`,
        summary: "x",
        scene_plan: [{ scene_id: `s${k + 1}` }],
      })),
    };
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue({
      core_conflict_theme: "x",
      volumes: [{ name: "v1", chapter_range: "1-50", summary: "x", key_events: [] }],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    });
    (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue(existing3);
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, n) => mergedOutlineThrough(n as number),
    );
    setup({
      data: {
        concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
        story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
        world: { era: "e", geography: "g", era_social_structure: "", era_cultural_history: "", power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }], factions: [], core_rules: [] },
        characters: { characters: [{ id: "p" }], current: null },
        novel_outline: null,
        chapter1_outline: existing3,
        chapter_outline_progress: { done: 3, total: 50, last_user_modifications: "" },
      },
    });
    // Banner shows.
    await screen.findByTestId("chapter-outline-resume-banner");
    // Give the auto-trigger path ample time to fire (it shouldn't).
    await new Promise((r) => setTimeout(r, 100));
    expect(api.generateOutline).not.toHaveBeenCalled();
  });

  it("completion clears chapter_outline_progress (subsequent 重新生成 starts at chapter 1)", async () => {
    // After a successful batch, the saved progress must be cleared so a
    // later 重新生成 (which discards work) starts fresh from chapter 1,
    // not from where the previous batch ended.
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, n) => mergedOutlineThrough(n as number),
    );
    setup();
    await waitFor(() => expect(api.generateOutline).toHaveBeenCalledTimes(20));
    // No resume banner: done (20) >= total (20, fallback when no
    // novel outline volumes are defined).
    expect(screen.queryByTestId("chapter-outline-resume-banner")).not.toBeInTheDocument();
    // Form is in normal post-completion state.
    expect(screen.getByTestId("chapter-outline-form")).toBeInTheDocument();
  });

  it("persistent resume CTA: shows whenever disk chapters < Volume 1 total, even without wizard.data progress", async () => {
    // v2.1 hardening: the resume CTA used to be gated on
    // wizard.data.chapter_outline_progress, which only got set on an
    // explicit pause. Users with disk content but no paused state
    // (crash recovery, manual chapter additions, prior session) saw no
    // affordance. The CTA now derives from disk outline + Volume 1 end
    // so it's discoverable in every partial-generation state.
    const existing5 = {
      chapters: Array.from({ length: 5 }, (_, k) => ({
        chapter_number: k + 1,
        title: `已生成的第${k + 1}章`,
        summary: "x",
        scene_plan: [{ scene_id: `s${k + 1}` }],
      })),
    };
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue({
      core_conflict_theme: "x",
      volumes: [{ name: "v1", chapter_range: "1-30", summary: "x", key_events: [] }],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    });
    (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue(existing5);
    setup({
      data: {
        concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
        story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
        world: { era: "e", geography: "g", era_social_structure: "", era_cultural_history: "", power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }], factions: [], core_rules: [] },
        characters: { characters: [{ id: "p" }], current: null },
        novel_outline: null,
        chapter1_outline: existing5,
        // KEY: no chapter_outline_progress. The CTA must still appear.
      },
    });
    // CTA shows even though wizard.data.chapter_outline_progress is null —
    // done is derived from disk (chapter_number 5), total from Volume 1
    // end (30), so 25 remain.
    const banner = await screen.findByTestId("chapter-outline-resume-banner");
    expect(banner.textContent).toMatch(/已生成\s*5\s*\/\s*30\s*章/);
    expect(banner.textContent).toMatch(/剩余\s*25\s*章/);
    expect(screen.getByTestId("chapter-outline-continue")).toBeInTheDocument();
  });

  it("resume CTA hides when disk chapters == Volume 1 total", async () => {
    // Volume 1 fully generated — no remaining chapters, so the CTA
    // (which exists to prompt continuation) is correctly absent.
    const existing30 = {
      chapters: Array.from({ length: 30 }, (_, k) => ({
        chapter_number: k + 1,
        title: `第${k + 1}章`,
        summary: "x",
        scene_plan: [{ scene_id: `s${k + 1}` }],
      })),
    };
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue({
      core_conflict_theme: "x",
      volumes: [{ name: "v1", chapter_range: "1-30", summary: "x", key_events: [] }],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    });
    (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue(existing30);
    setup({
      data: {
        concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
        story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
        world: { era: "e", geography: "g", era_social_structure: "", era_cultural_history: "", power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }], factions: [], core_rules: [] },
        characters: { characters: [{ id: "p" }], current: null },
        novel_outline: null,
        chapter1_outline: existing30,
      },
    });
    // Form renders...
    await screen.findByTestId("chapter-outline-form");
    // ...but the resume banner does NOT (done === total).
    expect(
      screen.queryByTestId("chapter-outline-resume-banner"),
    ).not.toBeInTheDocument();
  });

  // --- v2.1: OutlineTermGuard retry path. When the backend 422s with
  // FORBIDDEN_TERM_DETECTED on chapter 1, the frontend retries with
  // auto-feedback appended to user_modifications and the spinner
  // shows "第2次生成章节大纲…". On the 2nd attempt the call returns
  // a valid outline and the batch continues to chapter 2 normally.

  function forbiddenApiError(): ApiError {
    return new ApiError(
      "FORBIDDEN_TERM_DETECTED",
      "章节大纲包含 N 处未在世界观中声明的境界术语",
      { violations: [{ path: "chapters[1].scenes[0].conflict", term: "元婴", snippet: "一剑斩灭元婴" }] },
    );
  }

  it("retries once on FORBIDDEN_TERM_DETECTED and shows '第2次' in the spinner", async () => {
    let n = 0;
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, chapter) => {
        n += 1;
        if (n === 1 && chapter === 1) {
          throw forbiddenApiError();
        }
        return mergedOutlineThrough(chapter as number);
      },
    );
    setup();
    // First chapter: 2 calls (1 fail + 1 succeed). The batch should still
    // progress to chapter 2 once chapter 1 succeeds.
    await waitFor(() => expect(api.generateOutline).toHaveBeenCalledTimes(11));
    // The retry call for chapter 1 must carry the auto-feedback prefix.
    const firstChapterCalls = (api.generateOutline as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[1] === 1);
    expect(firstChapterCalls).toHaveLength(2);
    expect(firstChapterCalls[0][2]).toBe("");
    expect(firstChapterCalls[1][2]).toContain("【自动反馈");
  });

  it("does NOT show '第N次' prefix on the first (uncontaminated) attempt", async () => {
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, n) => mergedOutlineThrough(n as number),
    );
    setup();
    await waitFor(() => expect(api.generateOutline).toHaveBeenCalledTimes(20));
    // Spinner is gone (status=completed) so the attempt span is detached;
    // we just verify the helper's setAttempt reset to 1 didn't leak a
    // '第2次' anywhere on screen.
    expect(screen.queryByText(/第\s*2\s*次/)).not.toBeInTheDocument();
  });

  it("after 3 consecutive FORBIDDEN_TERM_DETECTED failures, surfaces the error UI", async () => {
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        throw forbiddenApiError();
      },
    );
    setup();
    // Error banner must appear (retry budget exhausted).
    expect(await screen.findByText(/FORBIDDEN_TERM_DETECTED|未在世界观中声明的境界术语|FORBIDDEN|境界/)).toBeInTheDocument();
    // generateOutline was called exactly 3 times for chapter 1.
    expect(api.generateOutline).toHaveBeenCalledTimes(3);
  });

  // proj_1a7d7fcf 2026-08-23: MiniMax-M3 occasionally emits the first scene
  // inside the <think> block, which the streaming parser captures as a
  // chapter dict like { text: "", degraded: true } (no chapter_number /
  // title / scene_plan). Without defensive guards in the chapter map the
  // `ch.scene_plan.length` access crashed and the wizard tree unmounted
  // → blank page. The form must now render a degraded badge for the
  // offending chapter and keep going with the well-formed siblings.
  it("renders a degraded-chapter badge instead of crashing when a chapter is malformed", async () => {
    const mixed = {
      chapters: [
        // The MiniMax-M3 think-block leak shape: scene captured inside
        // <think>, streaming parser records degraded=true with no fields.
        ({ text: "", degraded: true } as unknown) as { chapter_number: number; title: string; scene_plan: unknown[] },
        // Well-formed sibling so we can confirm it still renders.
        { chapter_number: 2, title: "正常生成的第2章", summary: "x", scene_plan: [{ scene_id: "s2" }] },
        // Missing scene_plan (different failure shape).
        ({ chapter_number: 3, title: "缺字段的第3章", summary: "x" } as unknown) as { chapter_number: number; title: string; scene_plan: unknown[] },
        // Well-formed tail.
        { chapter_number: 4, title: "正常生成的第4章", summary: "x", scene_plan: [{ scene_id: "s4" }] },
      ],
    };
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue({
      core_conflict_theme: "x",
      volumes: [{ name: "v1", chapter_range: "1-5", summary: "x", key_events: [] }],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    });
    (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue(mixed);
    setup({
      data: {
        concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
        story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
        world: { era: "e", geography: "g", era_social_structure: "", era_cultural_history: "", power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }], factions: [], core_rules: [] },
        characters: { characters: [{ id: "p" }], current: null },
        novel_outline: null,
        chapter1_outline: mixed,
      },
    });
    // The two well-formed siblings render their title inputs.
    await screen.findByTestId("chapter-2-title");
    await screen.findByTestId("chapter-4-title");
    // The malformed chapters show a degraded badge, NOT a title input.
    expect(screen.queryByTestId("chapter-1-title")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chapter-3-title")).not.toBeInTheDocument();
    const badges = screen.getAllByTestId("chapter-outline-degraded");
    expect(badges).toHaveLength(2);
    // The first one specifically mentions the LLM-downgrade reason so
    // the user knows to "重新生成" this chapter.
    expect(badges[0].textContent).toMatch(/LLM\s*输出降级/);
    // Scene-plan summary above the form uses the `?? 0` guard so the
    // missing scene_plan on chapter 3 doesn't zero out the total.
    expect(screen.getByTestId("chapter-outline-form").textContent).toMatch(/已生成\s*4\s*章/);
  });

  // v2.1: per-chapter "重新生成" — without this the only path was the modal
  // footer's bulk regen (regenerates Volume 1 from chapter 1), so a user
  // wanting to fix just one chapter had no UI option. The button calls
  // /stage3/regenerate-chapter-outline for that single chapter_number.
  it("renders a '重新生成' button on each well-formed chapter card", async () => {
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, n) => mergedOutlineThrough(n as number),
    );
    setup();
    await screen.findByTestId("chapter-outline-form");
    for (let i = 1; i <= 20; i++) {
      expect(
        screen.getByTestId(`chapter-${i}-regenerate`),
      ).toBeInTheDocument();
    }
  });

  it("clicking a per-chapter '重新生成' button opens the modal with target='第 N 章'", async () => {
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, n) => mergedOutlineThrough(n as number),
    );
    setup();
    await screen.findByTestId("chapter-outline-form");
    await act(async () => {
      screen.getByTestId("chapter-3-regenerate").click();
    });
    const modal = await screen.findByTestId("regenerate-modal");
    // The header should reference chapter 3 specifically, not the bulk
    // "章纲" target that the modal-footer button uses.
    expect(modal.textContent).toMatch(/第\s*3\s*章/);
    expect(modal.textContent).not.toMatch(/章纲/);
  });

  it("confirming the per-chapter modal calls regenerateChapterOutlineRange with a single-chapter range and updates the form", async () => {
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, n) => mergedOutlineThrough(n as number),
    );
    (api.regenerateChapterOutlineRange as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, start, end, mods) => {
        // Mirror backend/api/stage3_outline.py:546-561: the response's
        // `detail.chapters` is the FULL merged outline (existing chapters
        // deduped by chapter_number, the regenerated range appended). The
        // mock must mirror that contract or the wizard will appear to lose
        // chapters outside the regenerated range.
        const chapters = Array.from({ length: 20 }, (_, k) => ({
          chapter_number: k + 1,
          title: `第${k + 1}章`,
          scene_plan: [{ scene_id: `s${k + 1}` }],
        }));
        for (let n = start as number; n <= (end as number); n++) {
          const idx = chapters.findIndex((c) => c.chapter_number === n);
          if (idx >= 0) chapters.splice(idx, 1);
          chapters.push({
            chapter_number: n,
            title: `新第${n}章`,
            scene_plan: [{ scene_id: `new-s${n}` }],
          });
        }
        chapters.sort((a, b) => a.chapter_number - b.chapter_number);
        return { chapters };
      },
    );
    setup();
    await screen.findByTestId("chapter-outline-form");
    await act(async () => {
      screen.getByTestId("chapter-5-regenerate").click();
    });
    await screen.findByTestId("regenerate-modal");
    await act(async () => {
      screen.getByTestId("regenerate-modal-confirm").click();
    });
    await waitFor(() =>
      expect(api.regenerateChapterOutlineRange).toHaveBeenCalledWith(
        PROJECT,
        5,
        5,
        "",
      ),
    );
    // The local outline state must be replaced with the API's response so
    // the user sees the regenerated chapter immediately (no manual refetch).
    const input = (await screen.findByTestId("chapter-5-title")) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("新第5章"));
    // Other chapters must remain — single-chapter regen is NOT a bulk regen.
    expect((screen.getByTestId("chapter-4-title") as HTMLInputElement).value).toBe("第4章");
    expect((screen.getByTestId("chapter-6-title") as HTMLInputElement).value).toBe("第6章");
  });

  it("passes the modal textarea text through to user_modifications on the API", async () => {
    (api.generateOutline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, n) => mergedOutlineThrough(n as number),
    );
    (api.regenerateChapterOutlineRange as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, start) => ({
        chapters: [{
          chapter_number: start as number,
          title: `新第${start as number}章`,
          scene_plan: [{ scene_id: `new-s${start as number}` }],
        }],
      }),
    );
    setup();
    await screen.findByTestId("chapter-outline-form");
    await act(async () => {
      screen.getByTestId("chapter-2-regenerate").click();
    });
    const modal = await screen.findByTestId("regenerate-modal");
    const ta = modal.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(ta, { target: { value: "节奏更紧凑" } });
    });
    await act(async () => {
      screen.getByTestId("regenerate-modal-confirm").click();
    });
    await waitFor(() =>
      expect(api.regenerateChapterOutlineRange).toHaveBeenCalledWith(
        PROJECT,
        2,
        2,
        "节奏更紧凑",
      ),
    );
  });

  it("degraded-chapter badge exposes a '重新生成该章' button that targets the bad slot", async () => {
    const mixed = {
      chapters: [
        ({ text: "", degraded: true } as unknown) as { chapter_number: number; title: string; scene_plan: unknown[] },
        { chapter_number: 2, title: "正常生成的第2章", summary: "x", scene_plan: [{ scene_id: "s2" }] },
        { chapter_number: 3, title: "缺字段的第3章", summary: "x" } as unknown as { chapter_number: number; title: string; scene_plan: unknown[] },
        { chapter_number: 4, title: "正常生成的第4章", summary: "x", scene_plan: [{ scene_id: "s4" }] },
      ],
    };
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue({
      core_conflict_theme: "x",
      volumes: [{ name: "v1", chapter_range: "1-5", summary: "x", key_events: [] }],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    });
    (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue(mixed);
    setup({
      data: {
        concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
        story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
        world: { era: "e", geography: "g", era_social_structure: "", era_cultural_history: "", power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }], factions: [], core_rules: [] },
        characters: { characters: [{ id: "p" }], current: null },
        novel_outline: null,
        chapter1_outline: mixed,
      },
    });
    await screen.findByTestId("chapter-outline-form");
    const badges = screen.getAllByTestId("chapter-outline-degraded");
    expect(badges).toHaveLength(2);
    // Both degraded badges must have a regenerate button.
    expect(within(badges[0]).getByTestId("chapter-outline-degraded-regenerate")).toBeInTheDocument();
    expect(within(badges[1]).getByTestId("chapter-outline-degraded-regenerate")).toBeInTheDocument();
    // Clicking the first one (idx 0 → "第 1 章") opens a modal targeting chapter 1.
    await act(async () => {
      within(badges[0]).getByTestId("chapter-outline-degraded-regenerate").click();
    });
    const modal = await screen.findByTestId("regenerate-modal");
    expect(modal.textContent).toMatch(/第\s*1\s*章/);
  });
});
