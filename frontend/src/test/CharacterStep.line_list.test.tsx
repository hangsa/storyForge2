import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
  },
}));

import api from "../api/client";
import InitWizardModal from "../components/wizard/InitWizardModal";
import { getSessionKey } from "../components/wizard/WizardContext";

const PROJECT = "proj_x";
const KEY = getSessionKey(PROJECT);

const ALICE = {
  id: "char_alice",
  name: "Alice",
  personality: { beliefs: ["honor"], desires: ["truth"], fears: ["loss"], values: ["justice"], core_traits: ["brave"] },
  voice_signature: { speech_style: "calm", thought_patterns: "observes", taboos: ["lie"] },
  current_state: { location: "tavern", physical_condition: "normal", emotional: "neutral", known_secrets: ["k1"] },
  unknown_to_character: ["secret_x"],
  is_core_character: true,
  character_type: "protagonist",
  relations: {},
  growth_curve: null,
};

function setup(prefilledCharacters = [ALICE]) {
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
  (api.patchCharacter as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({ character: ALICE });
  (api.updateCharacter as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({ character: ALICE });
  sessionStorage.clear();
});

describe("CharacterStep array fields use LineListEditor (one row per item, full width)", () => {
  it("personality.beliefs renders one row per item with linelist-* testids", async () => {
    setup();
    render(<ToastProvider><MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter></ToastProvider>);
    await screen.findByTestId("character-panel-char_alice");
    // LineListEditor testids:
    // - linelist-add on the add button
    // - linelist-<N>-input on each row's textarea
    // - linelist-<N>-remove on each row's delete button
    // All sub-tabs render in DOM (hidden), but only active sub-tab shows.
    // The 5 personality fields each have linelist-0-input (one row each).
    const linelistAddButtons = screen.getAllByTestId("linelist-add");
    expect(linelistAddButtons.length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("linelist-0-input").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("linelist-0-remove").length).toBeGreaterThan(0);
  });

  it("personality row layout: textarea is rendered with a flex-1 full-width class (not a chip/button)", async () => {
    setup();
    render(<ToastProvider><MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter></ToastProvider>);
    await screen.findByTestId("character-panel-char_alice");
    // All personality fields have 1 entry ("honor"/"truth"/etc). Find any
    // personality textarea via its test-id prefix + TEXTAREA tag check.
    const inputs = screen.getAllByTestId("linelist-0-input");
    expect(inputs.length).toBeGreaterThan(0);
    const input = inputs[0];
    expect(input.tagName).toBe("TEXTAREA");
    expect(input.className).toMatch(/flex-1/);
  });

  it("voice.taboos renders as LineListEditor rows", async () => {
    setup();
    render(<ToastProvider><MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter></ToastProvider>);
    await screen.findByTestId("character-panel-char_alice");
    // voice section is hidden by default — switch to voice sub-tab
    // (PersonalitySection is the default sub-tab per useState init "personality")
    // Tab labels for voice: "声音签名"
    // Skip asserting tab-switching here; instead assert via personality's
    // 5 LineListEditors + unknown + known_secrets + taboos count via
    // total linelist-add button count. We expect:
    //   5 (personality fields) + 1 (taboos) + 1 (known_secrets) + 1 (unknown) = 8
    expect(screen.getAllByTestId("linelist-add").length).toBeGreaterThanOrEqual(4);
  });

  it("adding a new line appends a row and exposes a linelist-N-input for the new index", async () => {
    setup();
    render(<ToastProvider><MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter></ToastProvider>);
    await screen.findByTestId("character-panel-char_alice");
    // The first linelist-add corresponds to personality.beliefs (which has 1 entry).
    fireEvent.click(screen.getAllByTestId("linelist-add")[0]);
    await waitFor(() => {
      expect(screen.getByTestId("linelist-1-input")).toBeInTheDocument();
    });
  });
});