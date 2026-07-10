import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";

vi.mock("../api/client", () => ({
  default: {
    generateCharacter: vi.fn(),
    updateCharacter: vi.fn(),
    advance: vi.fn(),
  },
}));

import api from "../api/client";
import { WizardProvider } from "../components/wizard/WizardContext";
import CharacterStep from "../components/wizard/CharacterStep";

beforeEach(() => {
  (api.generateCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.updateCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.advance as ReturnType<typeof vi.fn>).mockReset();
  (api.advance as ReturnType<typeof vi.fn>).mockResolvedValue({ current_stage: "STAGE3" });
  sessionStorage.clear();
});

function setup() {
  return render(
    <WizardProvider projectId="proj_x">
      <CharacterStep projectId="proj_x" />
    </WizardProvider>,
  );
}

function makeChar(id: string, type: string, name = "C" + id) {
  return {
    id,
    name,
    is_core_character: type === "protagonist",
    character_type: type,
    personality: { beliefs: [], desires: [], fears: [], values: [], core_traits: [] },
    current_state: { location: "", physical_condition: "", emotional: "", known_secrets: [] },
    voice_signature: { speech_style: "", thought_patterns: "", taboos: [] },
    unknown_to_character: [],
    relations: {},
    growth_curve: null,
  };
}

describe("CharacterStep", () => {
  it("shows generate buttons on first entry even when wizard status is 'completed' (carry-over from step 2)", () => {
    // Pre-seed sessionStorage so the provider boots with status='completed'
    // and currentStep=3 — i.e., user just finished WorldStep and stepped in.
    sessionStorage.setItem(
      "storyforge.wizard.state.proj_x",
      JSON.stringify({
        currentStep: 3,
        completedSteps: [1, 2],
        status: "completed",
        data: {
          concept: null, story_dna: null, world: null,
          characters: null, novel_outline: null, chapter1_outline: null,
        },
        errorMessage: null,
      }),
    );
    setup();
    expect(screen.getByTestId("character-step")).toBeInTheDocument();
    expect(screen.getByTestId("character-idle")).toBeInTheDocument();
    expect(screen.getByTestId("character-start")).toBeInTheDocument();
    expect(screen.getByTestId("character-type-protagonist")).toBeInTheDocument();
  });

  it("batch start calls generateCharacter 6 times (1+2+3) and renders 6 cards", async () => {
    let callIdx = 0;
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, t: string) => {
      callIdx += 1;
      return { characters: [makeChar(`c${callIdx}`, t)], current: null };
    });
    setup();
    await act(async () => {
      screen.getByTestId("character-start").click();
    });
    await waitFor(() => expect(screen.getByTestId("character-form")).toBeInTheDocument());
    expect(api.generateCharacter).toHaveBeenCalledTimes(6);
    const types = (api.generateCharacter as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(types.filter((t) => t === "protagonist")).toHaveLength(1);
    expect(types.filter((t) => t === "antagonist")).toHaveLength(2);
    expect(types.filter((t) => t === "supporting")).toHaveLength(3);
    expect(screen.getByTestId("character-list").children).toHaveLength(6);
    expect(screen.getByText("已生成 6 个角色")).toBeInTheDocument();
  });

  it("'仅生成主角' generates exactly 1 protagonist", async () => {
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({
      characters: [makeChar("p1", "protagonist")],
      current: null,
    });
    setup();
    await act(async () => {
      screen.getByTestId("character-type-protagonist").click();
    });
    await waitFor(() => expect(screen.getByTestId("character-form")).toBeInTheDocument());
    expect(api.generateCharacter).toHaveBeenCalledTimes(1);
    expect(api.generateCharacter).toHaveBeenCalledWith("proj_x", "protagonist");
    expect(screen.getByTestId("character-list").children).toHaveLength(1);
  });

  it("manual add appends to the existing list (does not replace)", async () => {
    let callIdx = 0;
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, t: string) => {
      callIdx += 1;
      return { characters: [makeChar(`c${callIdx}`, t)], current: null };
    });
    setup();
    // Start with 1 protagonist via batch (just click "仅生成主角" for speed).
    await act(async () => {
      screen.getByTestId("character-type-protagonist").click();
    });
    await waitFor(() => expect(screen.getByTestId("character-form")).toBeInTheDocument());
    expect(screen.getByTestId("character-list").children).toHaveLength(1);
    // Add a supporting character manually.
    await act(async () => {
      screen.getByTestId("character-add-supporting").click();
    });
    await waitFor(() => expect(screen.getByTestId("character-list").children).toHaveLength(2));
    expect(api.generateCharacter).toHaveBeenCalledTimes(2);
    expect(api.generateCharacter).toHaveBeenLastCalledWith("proj_x", "supporting");
  });

  it("'重新生成' discards existing characters and starts a fresh batch", async () => {
    let callIdx = 0;
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, t: string) => {
      callIdx += 1;
      return { characters: [makeChar(`c${callIdx}`, t)], current: null };
    });
    setup();
    await act(async () => {
      screen.getByTestId("character-start").click();
    });
    await waitFor(() => expect(screen.getByTestId("character-list").children).toHaveLength(6));
    expect(api.generateCharacter).toHaveBeenCalledTimes(6);
    // Click regenerate — should call generateCharacter 6 more times, replace list.
    await act(async () => {
      screen.getByTestId("character-regenerate").click();
    });
    await waitFor(() => expect(api.generateCharacter).toHaveBeenCalledTimes(12));
    expect(screen.getByTestId("character-list").children).toHaveLength(6);
  });

  it("'下一步' calls updateCharacter with the merged list", async () => {
    let callIdx = 0;
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, t: string) => {
      callIdx += 1;
      return { characters: [makeChar(`c${callIdx}`, t)], current: null };
    });
    (api.updateCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    setup();
    await act(async () => {
      screen.getByTestId("character-start").click();
    });
    await waitFor(() => expect(screen.getByTestId("character-form")).toBeInTheDocument());
    await act(async () => {
      screen.getByTestId("character-next").click();
    });
    await waitFor(() => expect(api.updateCharacter).toHaveBeenCalledTimes(1));
    const call = (api.updateCharacter as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].characters).toHaveLength(6);
    await waitFor(() => expect(api.advance).toHaveBeenCalledWith("proj_x", "STAGE3"));
  });

  it("handles generateCharacter rejection by showing the error panel with a retry button", async () => {
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("LLM down"));
    setup();
    await act(async () => {
      screen.getByTestId("character-start").click();
    });
    await waitFor(() => expect(screen.getByText(/LLM down/)).toBeInTheDocument());
    expect(screen.getByText("重试")).toBeInTheDocument();
  });
});