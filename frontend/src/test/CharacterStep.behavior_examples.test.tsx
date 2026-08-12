import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../hooks/useToast";

vi.mock("../api/client", () => ({
  default: {
    generateCharacter: vi.fn(),
    updateCharacter: vi.fn(),
    patchCharacter: vi.fn(),
    deleteCharacter: vi.fn(),
    advance: vi.fn(),
    getConcept: vi.fn(),
    getWorld: vi.fn(),
    getCharacter: vi.fn(),
    getNovelOutline: vi.fn(),
    getOutline: vi.fn(),
    regenerateCharacterExamples: vi.fn(),
  },
}));

import api, { BehaviorExample } from "../api/client";
import InitWizardModal from "../components/wizard/InitWizardModal";
import { getSessionKey } from "../components/wizard/WizardContext";

const PROJECT = "proj_x";
const KEY = getSessionKey(PROJECT);

const ALICE_EXAMPLES: BehaviorExample[] = [
  { situation: "挚友被陷害", action: "压制怒火", speech_sample: "我会让你付出代价。" },
  { situation: "师父失踪", action: "暗中调查", speech_sample: "真相终会大白。" },
];
const BOB_EXAMPLES: BehaviorExample[] = [
  { situation: "发现敌人", action: "突袭", speech_sample: "受死吧。" },
];

const ALICE = {
  id: "char_alice",
  name: "Alice",
  personality: { beliefs: ["honor"], desires: ["truth"], fears: ["loss"], values: ["justice"], core_traits: ["brave"] },
  voice_signature: { speech_style: "calm", thought_patterns: "observes", taboos: ["lie"], behavior_examples: ALICE_EXAMPLES },
  current_state: { location: "tavern", physical_condition: "normal", emotional: "neutral", known_secrets: ["k1"] },
  unknown_to_character: ["secret_x"],
  is_core_character: true,
  character_type: "protagonist",
  relations: {},
  growth_curve: null,
};
const BOB = {
  ...ALICE,
  id: "char_bob",
  name: "Bob",
  voice_signature: { speech_style: "loud", thought_patterns: "rushes", taboos: [], behavior_examples: BOB_EXAMPLES },
  character_type: "supporting",
  is_core_character: false,
};

function setup(prefilledCharacters = [ALICE, BOB]) {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({
      currentStep: 3,
      completedSteps: [1, 2, 3],
      status: "completed",
      data: {
        concept: null, story_dna: null, world: null,
        characters: { characters: prefilledCharacters, current: prefilledCharacters[0] },
        novel_outline: null, chapter1_outline: null,
      },
      errorMessage: null,
    }),
  );
}

beforeEach(() => {
  (api.generateCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.updateCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.patchCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.deleteCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.advance as ReturnType<typeof vi.fn>).mockReset();
  (api.advance as ReturnType<typeof vi.fn>).mockResolvedValue({ current_stage: "STAGE3" });
  (api.regenerateCharacterExamples as ReturnType<typeof vi.fn>).mockReset();
  sessionStorage.clear();
});

describe("CharacterStep behavior examples integration", () => {
  it("renders a BehaviorExamplesSection on every character card", () => {
    setup();
    render(<ToastProvider><MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter></ToastProvider>);
    const aliceCard = screen.getByTestId("character-char_alice");
    const bobCard = screen.getByTestId("character-char_bob");
    expect(within(aliceCard).getByTestId("behavior-examples-section")).toBeInTheDocument();
    expect(within(bobCard).getByTestId("behavior-examples-section")).toBeInTheDocument();
  });

  it("renders existing examples inside Alice's section", () => {
    setup();
    render(<ToastProvider><MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter></ToastProvider>);
    const aliceCard = screen.getByTestId("character-char_alice");
    // 2 examples × 3 fields each = 6 textareas inside Alice's section.
    expect(within(aliceCard).getByDisplayValue("挚友被陷害")).toBeInTheDocument();
    expect(within(aliceCard).getByDisplayValue("我会让你付出代价。")).toBeInTheDocument();
  });

  it("renders an empty section (with 添加示例 button) when behavior_examples is absent", () => {
    const aliceNoExamples = { ...ALICE, voice_signature: { ...ALICE.voice_signature } };
    delete (aliceNoExamples.voice_signature as { behavior_examples?: BehaviorExample[] }).behavior_examples;
    const bobNoExamples = { ...BOB, voice_signature: { ...BOB.voice_signature } };
    delete (bobNoExamples.voice_signature as { behavior_examples?: BehaviorExample[] }).behavior_examples;
    setup([aliceNoExamples, bobNoExamples]);
    render(<ToastProvider><MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter></ToastProvider>);
    const aliceCard = screen.getByTestId("character-char_alice");
    // Both cards still render the section so the user can populate it.
    expect(within(aliceCard).getByTestId("behavior-examples-section")).toBeInTheDocument();
    expect(within(aliceCard).getByTestId("behavior-example-add")).toBeInTheDocument();
  });

  it("inline editing a behavior_example updates local state without an API call", async () => {
    setup();
    render(<ToastProvider><MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter></ToastProvider>);
    const aliceCard = screen.getByTestId("character-char_alice");
    const situationInput = within(aliceCard).getByDisplayValue("挚友被陷害");
    await act(async () => {
      fireEvent.change(situationInput, { target: { value: "新触发" } });
    });
    expect(within(aliceCard).getByDisplayValue("新触发")).toBeInTheDocument();
    // Inline edit must not hit the network — the save action flushes everything.
    expect(api.patchCharacter).not.toHaveBeenCalled();
    expect(api.updateCharacter).not.toHaveBeenCalled();
  });

  it("'确认修改并继续' persists edited behavior_examples through updateCharacter", async () => {
    (api.updateCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    setup();
    render(<ToastProvider><MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter></ToastProvider>);
    const aliceCard = screen.getByTestId("character-char_alice");
    const situationInput = within(aliceCard).getByDisplayValue("挚友被陷害");
    await act(async () => {
      fireEvent.change(situationInput, { target: { value: "情境A" } });
    });
    const actionInput = within(aliceCard).getByDisplayValue("压制怒火");
    await act(async () => {
      fireEvent.change(actionInput, { target: { value: "动作A" } });
    });
    await act(async () => {
      screen.getByTestId("wizard-next").click();
    });
    await waitFor(() => expect(api.updateCharacter).toHaveBeenCalledTimes(1));
    const call = (api.updateCharacter as ReturnType<typeof vi.fn>).mock.calls[0];
    const alicePatched = call[1].characters.find((c: { id: string }) => c.id === "char_alice");
    expect(alicePatched.voice_signature.behavior_examples[0]).toEqual({
      situation: "情境A",
      action: "动作A",
      speech_sample: "我会让你付出代价。",
    });
  });

  it("Alice's regenerate button calls regenerateCharacterExamples(..., false) and replaces Alice's card on success", async () => {
    const NEW_EXAMPLES: BehaviorExample[] = [
      { situation: "新情境", action: "新动作", speech_sample: "新台词。" },
    ];
    const updatedAlice = {
      ...ALICE,
      name: "Alice 新名",
      voice_signature: { ...ALICE.voice_signature, behavior_examples: NEW_EXAMPLES },
    };
    (api.regenerateCharacterExamples as ReturnType<typeof vi.fn>).mockResolvedValue(updatedAlice);

    setup();
    render(<ToastProvider><MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter></ToastProvider>);
    const aliceCard = screen.getByTestId("character-char_alice");
    // Alice has the regenerate button inside her section.
    const aliceRegenerate = within(aliceCard).getByTestId("behavior-example-regenerate");

    // v1.9: clicking the per-card regenerate now opens a RegenerateModal
    // first; the API call only fires after the user clicks the modal's
    // "重新生成" button. Confirm it here so the rest of the test runs.
    await act(async () => {
      aliceRegenerate.click();
    });
    // Modal title should reflect Alice + the per-card target suffix.
    expect(screen.getByText(/重新生成.*Alice.*行为例示/)).toBeInTheDocument();
    await act(async () => {
      screen.getByTestId("regenerate-modal-confirm").click();
    });

    // Click Alice's regenerate; Bob's regenerate must NOT be called.
    await waitFor(() => {
      expect(api.regenerateCharacterExamples).toHaveBeenCalledTimes(1);
    });
    // v1.9: user_modifications is now threaded as the 4th positional arg.
    expect(api.regenerateCharacterExamples).toHaveBeenCalledWith(PROJECT, "char_alice", false, "");

    // After success, Alice's card shows the new behavior_examples.
    await waitFor(() => {
      expect(within(aliceCard).getByDisplayValue("新情境")).toBeInTheDocument();
    });
    expect(within(aliceCard).getByDisplayValue("新台词。")).toBeInTheDocument();
    // Old Alice data is gone.
    expect(within(aliceCard).queryByDisplayValue("挚友被陷害")).not.toBeInTheDocument();
    // Bob's card is untouched.
    const bobCard = screen.getByTestId("character-char_bob");
    expect(within(bobCard).getByDisplayValue("发现敌人")).toBeInTheDocument();
    // Alice's name was also replaced (the API returned the full updated character).
    expect(within(aliceCard).getByTestId("character-char_alice-name")).toHaveValue("Alice 新名");
  });

  it("regenerate failure surfaces through the existing wizard error banner", async () => {
    (api.regenerateCharacterExamples as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("LLM 拒绝"),
    );

    setup();
    render(<ToastProvider><MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter></ToastProvider>);
    const aliceCard = screen.getByTestId("character-char_alice");
    await act(async () => {
      within(aliceCard).getByTestId("behavior-example-regenerate").click();
    });
    // v1.9: the per-card modal must be confirmed before the API call fires.
    await act(async () => {
      screen.getByTestId("regenerate-modal-confirm").click();
    });
    // Existing pattern: wizard.setStatus("error", message) renders the error
    // banner. No new toast infrastructure.
    await waitFor(() => {
      expect(screen.getByText("LLM 拒绝")).toBeInTheDocument();
    });
    // Alice's data is untouched on failure.
    expect(within(aliceCard).getByDisplayValue("挚友被陷害")).toBeInTheDocument();
  });
});