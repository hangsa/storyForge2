import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

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
const BOB = { ...ALICE, id: "char_bob", name: "Bob", character_type: "supporting", is_core_character: false, relations: {} };

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
  sessionStorage.clear();
});

describe("CharacterStep inline-edit (no edit-mode toggle)", () => {
  it("card has no edit-button — fields are editable directly", () => {
    setup();
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter>);
    // No more "character-edit-{id}" button. Inline edit only.
    expect(screen.queryByTestId("character-edit-char_alice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("character-edit-form")).not.toBeInTheDocument();
    // Name is a directly-editable input (not a static label).
    expect(screen.getByDisplayValue("Alice")).toBeInTheDocument();
  });

  it("changing the name input updates local state without an API call", async () => {
    setup();
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter>);
    const nameInput = screen.getByDisplayValue("Alice");
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "Alicia" } });
    });
    expect(screen.getByDisplayValue("Alicia")).toBeInTheDocument();
    // No patchCharacter call: the change is held in local state until
    // the user clicks "确认修改并继续" in the modal footer.
    expect(api.patchCharacter).not.toHaveBeenCalled();
  });

  it("changing a personality tag via TagEditor updates local state", async () => {
    setup();
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter>);
    // Scope to Alice's card since Alice and Bob share the same "honor" belief.
    const aliceCard = screen.getByTestId("character-char_alice");
    // The personality section uses TagEditor. To edit an existing tag, click
    // the tag's text button (TagEditor.tsx wraps the value in a <button>).
    const tag = within(aliceCard).getByRole("button", { name: "honor" });
    await act(async () => {
      tag.click();
    });
    // TagEditor swaps the button for an input pre-filled with "honor".
    const editInput = within(aliceCard).getByDisplayValue("honor");
    await act(async () => {
      fireEvent.change(editInput, { target: { value: "honesty" } });
    });
    // Save by pressing Enter (TagEditor saves on Enter).
    await act(async () => {
      fireEvent.keyDown(editInput, { key: "Enter", code: "Enter" });
    });
    expect(within(aliceCard).getByRole("button", { name: "honesty" })).toBeInTheDocument();
    expect(api.patchCharacter).not.toHaveBeenCalled();
  });

  it("changing voice_signature.speech_style updates local state", async () => {
    setup();
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter>);
    // Scope to Alice's speech-style input — both characters share "calm".
    const speechInput = screen.getByTestId("character-char_alice-speech-style");
    await act(async () => {
      fireEvent.change(speechInput, { target: { value: "gruff" } });
    });
    expect(speechInput).toHaveValue("gruff");
    expect(api.patchCharacter).not.toHaveBeenCalled();
  });

  it("'确认修改并继续' in footer persists all inline edits via updateCharacter", async () => {
    (api.updateCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    setup();
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter>);
    // Edit name + speech_style inline. Scope to Alice's card.
    const aliceCard = screen.getByTestId("character-char_alice");
    const nameInput = within(aliceCard).getByDisplayValue("Alice");
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "Alicia" } });
    });
    const speechInput = screen.getByTestId("character-char_alice-speech-style");
    await act(async () => {
      fireEvent.change(speechInput, { target: { value: "gruff" } });
    });
    await act(async () => {
      screen.getByTestId("wizard-next").click();
    });
    await waitFor(() => expect(api.updateCharacter).toHaveBeenCalledTimes(1));
    const call = (api.updateCharacter as ReturnType<typeof vi.fn>).mock.calls[0];
    const alicePatched = call[1].characters.find((c: { id: string }) => c.id === "char_alice");
    expect(alicePatched.name).toBe("Alicia");
    expect(alicePatched.voice_signature.speech_style).toBe("gruff");
  });

  it("relations editor is always visible (no edit-mode toggle required)", () => {
    setup();
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter>);
    // Each card has its own relations editor; check Alice's card specifically.
    const aliceCard = screen.getByTestId("character-char_alice");
    expect(within(aliceCard).getByTestId("character-relations-editor")).toBeInTheDocument();
    expect(within(aliceCard).getByTestId("relations-add-button")).toBeInTheDocument();
  });

  it("relations editor: adding a relation updates local state without an API call", async () => {
    setup();
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter>);
    const aliceCard = screen.getByTestId("character-char_alice");
    await act(async () => {
      within(aliceCard).getByTestId("relations-add-button").click();
    });
    const select = within(aliceCard).getByTestId("relations-target-select");
    await act(async () => {
      fireEvent.change(select, { target: { value: "char_bob" } });
    });
    await act(async () => {
      within(aliceCard).getByTestId("relations-confirm-add").click();
    });
    // Edit committed locally; no patchCharacter call (per WorldStep-style flow).
    expect(api.patchCharacter).not.toHaveBeenCalled();
    // Bob now appears in Alice's relations list.
    expect(within(aliceCard).getByTestId("character-relations-editor").textContent).toContain("Bob");
  });

  it("delete button still works (unchanged behavior)", async () => {
    (api.deleteCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({ deleted_id: "char_bob", cascaded_relation_removals: 0 });
    setup();
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter>);
    await act(async () => {
      screen.getByTestId("character-delete-char_bob").click();
    });
    expect(screen.getByTestId("delete-confirm-modal")).toBeInTheDocument();
    await act(async () => {
      screen.getByTestId("delete-confirm-button").click();
    });
    await waitFor(() => {
      expect(api.deleteCharacter).toHaveBeenCalledWith(PROJECT, "char_bob");
    });
  });
});
