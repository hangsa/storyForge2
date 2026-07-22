import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({
  default: {
    patchCharacter: vi.fn(),
  },
}));

import api from "../api/client";
import { Character } from "../api/client";
import CharacterEditForm from "../components/wizard/CharacterEditForm";

const ALICE = {
  id: "char_alice",
  name: "Alice",
  personality: {
    beliefs: ["honor"],
    desires: ["truth"],
    fears: ["loss"],
    values: ["justice"],
    core_traits: ["brave"],
  },
  voice_signature: { speech_style: "calm", thought_patterns: "observes", taboos: ["lie"] },
  current_state: { location: "tavern", physical_condition: "normal", emotional: "neutral", known_secrets: [] },
  unknown_to_character: ["secret_x"],
  is_core_character: true,
  character_type: "protagonist",
  relations: {},
  growth_curve: null,
} as unknown as Character;

beforeEach(() => {
  (api.patchCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.patchCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(ALICE);
});

describe("CharacterEditForm", () => {
  it("renders all sections with current values", () => {
    render(
      <MemoryRouter>
        <CharacterEditForm
          projectId="p1"
          character={ALICE}
          allCharacters={[ALICE]}
          onComplete={vi.fn()}
          onCancel={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByDisplayValue("Alice")).toBeInTheDocument();
    expect(screen.getByDisplayValue("honor")).toBeInTheDocument();
    expect(screen.getByDisplayValue("calm")).toBeInTheDocument();
  });

  it("fires patchCharacter on name blur with new value", async () => {
    render(
      <MemoryRouter>
        <CharacterEditForm projectId="p1" character={ALICE} allCharacters={[ALICE]} onComplete={vi.fn()} onCancel={vi.fn()} />
      </MemoryRouter>,
    );
    const input = screen.getByDisplayValue("Alice");
    fireEvent.change(input, { target: { value: "Alicia" } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(api.patchCharacter).toHaveBeenCalledWith("p1", "char_alice", expect.objectContaining({ name: "Alicia" }));
    });
  });

  it("adds a chip on Enter in a chip-array input", async () => {
    render(
      <MemoryRouter>
        <CharacterEditForm projectId="p1" character={ALICE} allCharacters={[ALICE]} onComplete={vi.fn()} onCancel={vi.fn()} />
      </MemoryRouter>,
    );
    const beliefsInput = screen.getByPlaceholderText(/信念/);
    fireEvent.change(beliefsInput, { target: { value: "new_belief" } });
    fireEvent.keyDown(beliefsInput, { key: "Enter", code: "Enter" });
    await waitFor(() => {
      expect(api.patchCharacter).toHaveBeenCalledWith(
        "p1",
        "char_alice",
        expect.objectContaining({ personality: expect.objectContaining({ beliefs: expect.arrayContaining(["new_belief"]) }) }),
      );
    });
  });

  it("shows error badge when patchCharacter rejects", async () => {
    (api.patchCharacter as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("网络错误"));
    render(
      <MemoryRouter>
        <CharacterEditForm projectId="p1" character={ALICE} allCharacters={[ALICE]} onComplete={vi.fn()} onCancel={vi.fn()} />
      </MemoryRouter>,
    );
    const input = screen.getByDisplayValue("Alice");
    fireEvent.change(input, { target: { value: "X" } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(screen.getByText(/保存失败/)).toBeInTheDocument();
    });
  });
});