import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// The hook imports from ../api/client. We mock the whole module so the test
// only exercises the hook's own state machine and arg-forwarding behaviour.
vi.mock("../../../src/api/client", () => {
  return {
    default: {
      writeScene: vi.fn(),
      forcePass: vi.fn(),
      skipScene: vi.fn(),
      getSceneDraft: vi.fn(),
    },
    ApiError: class extends Error {
      code: string;
      detail: Record<string, unknown>;
      constructor(code: string, message: string, detail?: Record<string, unknown>) {
        super(message);
        this.code = code;
        this.detail = detail || {};
      }
    },
  };
});

import api from "../../../src/api/client";
import { useStage4Writing } from "../../../src/hooks/useStage4Writing";
import type { SandboxParams } from "../../../src/api/client";

const writeSceneMock = api.writeScene as unknown as ReturnType<typeof vi.fn>;
const getSceneDraftMock = api.getSceneDraft as unknown as ReturnType<typeof vi.fn>;

describe("useStage4Writing — writeScene", () => {
  beforeEach(() => {
    sessionStorage.clear();
    writeSceneMock.mockReset();
    getSceneDraftMock.mockReset();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("forwards custom_style_config=null when no config is supplied", async () => {
    writeSceneMock.mockResolvedValue({
      status: "passed",
      scene_number: 1,
      draft_text: "draft",
      fact_guard_results: { all_passed: true, checks: [], coherence_score: 95 },
      parsed_logs: [],
      retry_count: 0,
      retry_hints: [],
    });

    const { result } = renderHook(() => useStage4Writing());

    await act(async () => {
      await result.current.writeScene("proj-1", 1, 1);
    });

    expect(writeSceneMock).toHaveBeenCalledTimes(1);
    const callArg = writeSceneMock.mock.calls[0][0];
    expect(callArg.project_id).toBe("proj-1");
    expect(callArg.chapter_number).toBe(1);
    expect(callArg.scene_number).toBe(1);
    expect(callArg.custom_style_config).toBeNull();
  });

  it("forwards custom_style_config when one is supplied", async () => {
    writeSceneMock.mockResolvedValue({
      status: "passed",
      scene_number: 1,
      draft_text: "draft",
      fact_guard_results: { all_passed: true, checks: [], coherence_score: 95 },
      parsed_logs: [],
      retry_count: 0,
      retry_hints: [],
    });

    const params: SandboxParams = {
      sentence: { avg_length_range: [10, 30], short_sentence_ratio: 0.5, paragraph_length_range: [80, 200] },
      dialogue: { ratio: 0.3, max_consecutive_lines: 4 },
      rhythm: { pacing_bpm: 250, scene_change_frequency: 0.5 },
      density: { description_ratio: 0.4, action_ratio: 0.3 },
      satisfaction: { satisfaction_beat_count: 5, suspense_hook_required: true },
    };

    const { result } = renderHook(() => useStage4Writing());

    await act(async () => {
      await result.current.writeScene("proj-1", 1, 1, params);
    });

    expect(writeSceneMock).toHaveBeenCalledTimes(1);
    const callArg = writeSceneMock.mock.calls[0][0];
    expect(callArg.custom_style_config).toEqual(params);
  });

  it("explicitly passes null when user disables custom style", async () => {
    writeSceneMock.mockResolvedValue({
      status: "passed",
      scene_number: 1,
      draft_text: "draft",
      fact_guard_results: { all_passed: true, checks: [], coherence_score: 95 },
      parsed_logs: [],
      retry_count: 0,
      retry_hints: [],
    });

    const { result } = renderHook(() => useStage4Writing());

    await act(async () => {
      await result.current.writeScene("proj-1", 1, 1, null);
    });

    expect(writeSceneMock.mock.calls[0][0].custom_style_config).toBeNull();
  });

  it("treats explicit undefined as null (off-by-default)", async () => {
    writeSceneMock.mockResolvedValue({
      status: "passed",
      scene_number: 1,
      draft_text: "draft",
      fact_guard_results: { all_passed: true, checks: [], coherence_score: 95 },
      parsed_logs: [],
      retry_count: 0,
      retry_hints: [],
    });

    const { result } = renderHook(() => useStage4Writing());

    await act(async () => {
      await result.current.writeScene("proj-1", 1, 1, undefined);
    });

    expect(writeSceneMock.mock.calls[0][0].custom_style_config).toBeNull();
  });

  it("exposes a successful write result on the state machine", async () => {
    writeSceneMock.mockResolvedValue({
      status: "passed",
      scene_number: 3,
      draft_text: "hello",
      fact_guard_results: { all_passed: true, checks: [], coherence_score: 90 },
      parsed_logs: [{ type: "knowledge_gain", params: { char: "x", content: "y" }, raw_text: "" }],
      retry_count: 0,
      retry_hints: [],
    });

    const { result } = renderHook(() => useStage4Writing());

    await act(async () => {
      await result.current.writeScene("proj-1", 1, 3);
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe("complete");
    });
    expect(result.current.state.draftText).toBe("hello");
    expect(result.current.state.allPassed).toBe(true);
    expect(result.current.state.parsedLogs).toHaveLength(1);
  });
});