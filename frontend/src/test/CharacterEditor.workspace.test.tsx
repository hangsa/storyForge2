import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({
  default: {
    generateCharacter: vi.fn(),
    deleteCharacter: vi.fn(),
    updateCharacter: vi.fn(),
  },
}));

import api from "../api/client";
import CharacterEditor from "../components/workspace/editors/CharacterEditor";

const ALICE = {
  id: "char_alice",
  name: "Alice",
  personality: { beliefs: [], desires: [], fears: [], values: [], core_traits: [] },
  voice_signature: { speech_style: "", thought_patterns: "", taboos: [] },
  current_state: { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] },
  unknown_to_character: [],
  is_core_character: true,
  character_type: "protagonist",
  relations: {},
};

beforeEach(() => {
  (api.generateCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.deleteCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.updateCharacter as ReturnType<typeof vi.fn>).mockReset();
});

describe("CharacterEditor workspace add/delete", () => {
  it("renders + 新建角色 button", () => {
    render(
      <MemoryRouter>
        <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("character-new-button")).toBeInTheDocument();
  });

  it("clicking + 新建角色 calls generateCharacter and appends the result", async () => {
    const NEW = { ...ALICE, id: "char_new", name: "Newcomer" };
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({
      characters: [ALICE, NEW],
      current: NEW,
    });
    render(
      <MemoryRouter>
        <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("character-new-button"));
    await waitFor(() => {
      expect(api.generateCharacter).toHaveBeenCalledWith("p1", undefined);
    });
    await waitFor(() => {
      expect(screen.getByText("Newcomer")).toBeInTheDocument();
    });
  });

  it("renders per-card 🗑️ delete button", () => {
    render(
      <MemoryRouter>
        <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("character-delete-0")).toBeInTheDocument();
  });

  it("clicking delete opens confirmation modal", () => {
    render(
      <MemoryRouter>
        <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("character-delete-0"));
    expect(screen.getByTestId("delete-confirm-modal")).toBeInTheDocument();
  });

  it("confirming delete calls deleteCharacter and removes the card", async () => {
    (api.deleteCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({ deleted_id: "char_alice", cascaded_relation_removals: 0 });
    render(
      <MemoryRouter>
        <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("character-delete-0"));
    fireEvent.click(screen.getByTestId("delete-confirm-button"));
    await waitFor(() => {
      expect(api.deleteCharacter).toHaveBeenCalledWith("p1", "char_alice");
    });
    await waitFor(() => {
      expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    });
  });
});