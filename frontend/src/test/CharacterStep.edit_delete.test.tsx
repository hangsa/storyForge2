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
  personality: { beliefs: ["x"], desires: [], fears: [], values: [], core_traits: [] },
  voice_signature: { speech_style: "", thought_patterns: "", taboos: [] },
  current_state: { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] },
  unknown_to_character: [],
  is_core_character: true,
  character_type: "protagonist",
  relations: { char_bob: { status: "ally", history: [], last_update_chapter: 0 } },
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

describe("CharacterStep edit + delete", () => {
  it("renders a delete button on each card (no edit-button — fields are inline-editable)", () => {
    setup();
    render(<ToastProvider><MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter></ToastProvider>);
    expect(screen.getByTestId("character-delete-char_alice")).toBeInTheDocument();
    expect(screen.queryByTestId("character-edit-char_alice")).not.toBeInTheDocument();
  });

  it("clicking delete opens a confirmation modal showing cascade count", () => {
    setup();
    render(<ToastProvider><MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter></ToastProvider>);
    fireEvent.click(screen.getByTestId("character-delete-char_bob"));
    // Alice has a relation TO Bob, so deleting Bob cascades 1 inbound removal.
    const modal = screen.getByTestId("delete-confirm-modal");
    expect(modal.textContent).toMatch(/1.*反向关系/);
    expect(screen.getByTestId("delete-confirm-button")).toBeInTheDocument();
  });

  it("confirming delete calls deleteCharacter and removes the card", async () => {
    (api.deleteCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({ deleted_id: "char_bob", cascaded_relation_removals: 0 });
    setup();
    render(<ToastProvider><MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter></ToastProvider>);
    fireEvent.click(screen.getByTestId("character-delete-char_bob"));
    fireEvent.click(screen.getByTestId("delete-confirm-button"));
    await waitFor(() => {
      expect(api.deleteCharacter).toHaveBeenCalledWith(PROJECT, "char_bob");
    });
    await waitFor(() => {
      expect(screen.queryByTestId("character-char_bob")).not.toBeInTheDocument();
    });
  });

  it("cancelling delete does not call deleteCharacter", async () => {
    setup();
    render(<ToastProvider><MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter></ToastProvider>);
    fireEvent.click(screen.getByTestId("character-delete-char_bob"));
    fireEvent.click(screen.getByTestId("delete-cancel-button"));
    expect(api.deleteCharacter).not.toHaveBeenCalled();
    expect(screen.getByTestId("character-char_bob")).toBeInTheDocument();
  });

  it("deleting alice (with inbound relation from nobody) reports 0 cascade count", () => {
    setup();
    render(<ToastProvider><MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter></ToastProvider>);
    fireEvent.click(screen.getByTestId("character-delete-char_alice"));
    // Alice has a relation TO bob, but no character has a relation TO alice → 0 cascade
    const modal = screen.getByTestId("delete-confirm-modal");
    expect(modal.textContent).toMatch(/0.*反向关系/);
  });

  it("regenerate button opens the full-character RegenerateModal", () => {
    setup();
    render(<ToastProvider><MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter></ToastProvider>);
    fireEvent.click(screen.getByTestId("wizard-regenerate"));
    // v1.9: RegenerateModal replaces the v1.8 destructive-confirm dialog.
    expect(screen.getByTestId("regenerate-modal")).toBeInTheDocument();
    // Modal title contains the step target string.
    expect(screen.getByText(/重新生成.*角色/)).toBeInTheDocument();
  });

  it("regenerate confirmation calls generateCharacter on confirm (fresh batch)", async () => {
    setup();
    let callIdx = 0;
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, t: string) => {
      callIdx += 1;
      return { characters: [ALICE], current: null };
    });
    render(<ToastProvider><MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter></ToastProvider>);
    fireEvent.click(screen.getByTestId("wizard-regenerate"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    await waitFor(() => {
      expect(api.generateCharacter).toHaveBeenCalled();
    });
  });

  it("regenerate cancellation does not call generateCharacter", () => {
    setup();
    render(<ToastProvider><MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter></ToastProvider>);
    fireEvent.click(screen.getByTestId("wizard-regenerate"));
    fireEvent.click(screen.getByTestId("regenerate-modal-cancel"));
    expect(api.generateCharacter).not.toHaveBeenCalled();
  });
});
