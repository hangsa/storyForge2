import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({
  default: {
    generateCharacter: vi.fn(),
    deleteCharacter: vi.fn(),
    updateCharacter: vi.fn(),
    regenerateCharacterSection: vi.fn(),
    regenerateCharacterExamples: vi.fn(),
  },
}));

import api from "../api/client";
import CharacterEditor from "../components/workspace/editors/CharacterEditor";
import { ToastProvider, useToast } from "../hooks/useToast";

// ToastRecorder lives next to the editor so we can read the same context the
// production code uses. Calls are captured via useToast().
function ToastRecorder({ onShow }: { onShow: (messages: string[]) => void }) {
  const { toasts } = useToast();
  onShow(toasts.map((t) => t.message));
  return <div data-testid="toast-snapshot">{toasts.length}</div>;
}

function renderWithToast(
  node: React.ReactElement,
  onShow: (messages: string[]) => void,
) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ToastRecorder onShow={onShow} />
        {node}
      </ToastProvider>
    </MemoryRouter>,
  );
}

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
  (api.regenerateCharacterSection as ReturnType<typeof vi.fn>).mockReset();
  (api.regenerateCharacterExamples as ReturnType<typeof vi.fn>).mockReset();
});

describe("CharacterEditor workspace add/delete", () => {
  it("renders + 新建角色 button", () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />
        </ToastProvider>
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
        <ToastProvider>
          <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />
        </ToastProvider>
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
        <ToastProvider>
          <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("character-delete-0")).toBeInTheDocument();
  });

  it("clicking delete opens confirmation modal", () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />
        </ToastProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("character-delete-0"));
    expect(screen.getByTestId("delete-confirm-modal")).toBeInTheDocument();
  });

  it("confirming delete calls deleteCharacter and removes the card", async () => {
    (api.deleteCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({ deleted_id: "char_alice", cascaded_relation_removals: 0 });
    render(
      <MemoryRouter>
        <ToastProvider>
          <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />
        </ToastProvider>
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

describe("CharacterEditor auto-grow chip textareas", () => {
  const ALICE_CHIPS = {
    id: "char_alice",
    name: "Alice",
    personality: {
      beliefs: ["义"],
      desires: ["回家"],
      fears: ["孤独"],
      values: ["侠"],
      core_traits: ["机敏", "执着"],
    },
    voice_signature: { speech_style: "", thought_patterns: "", taboos: [] },
    current_state: { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] },
    unknown_to_character: [],
    is_core_character: true,
    character_type: "protagonist",
    relations: {},
  };

  it("personality chip fields are auto-grow textareas (no fixed rows, overflow-hidden)", () => {
    // Bug: core_traits / beliefs / desires / fears / values (and taboos)
    // used to render as <input> (single-line), which clipped multi-line
    // chip content. They are now textareas with useAutoHeight.
    render(
      <MemoryRouter>
        <ToastProvider>
          <CharacterEditor projectId="p1" data={{ characters: [ALICE_CHIPS] }} onSaved={() => {}} />
        </ToastProvider>
      </MemoryRouter>,
    );
    const autoGrowIds = [
      "character-0-core-traits",
      "character-0-beliefs",
      "character-0-desires",
      "character-0-fears",
      "character-0-values",
      "character-0-taboos",
    ];
    for (const id of autoGrowIds) {
      const ta = screen.queryByTestId(id) as HTMLTextAreaElement | null;
      expect(ta, `${id} should be a textarea, not an input`).not.toBeNull();
      expect(ta.tagName, `${id} tag should be TEXTAREA`).toBe("TEXTAREA");
      expect(ta.getAttribute("rows"), `${id} should not have a fixed rows attribute`).toBeNull();
      expect(ta.className, `${id} should have overflow-hidden`).toContain("overflow-hidden");
    }
    // Sanity — short identifier fields stay as inputs.
    expect((screen.getByTestId("character-0-name") as HTMLInputElement).tagName).toBe("INPUT");
  });

  it("chip-style textareas render array values joined by 、", () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <CharacterEditor projectId="p1" data={{ characters: [ALICE_CHIPS] }} onSaved={() => {}} />
        </ToastProvider>
      </MemoryRouter>,
    );
    const core = (screen.getByTestId("character-0-core-traits")) as HTMLTextAreaElement;
    expect(core.value).toBe("机敏、执着");
    const beliefs = (screen.getByTestId("character-0-beliefs")) as HTMLTextAreaElement;
    expect(beliefs.value).toBe("义");
  });
});

describe("CharacterEditor regenerate", () => {
  it("renders 6 regenerate buttons per character card", () => {
    const ref = { list: [] as string[] };
    renderWithToast(
      <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />,
      (m) => { ref.list = m; },
    );
    expect(screen.getByTestId("section-regenerate-性格-0")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-声音特征-0")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-当前状态-0")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-角色未知-0")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-人物关系-0")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-行为示例-0")).toBeInTheDocument();
  });

  it("renders per-character button suffix to avoid duplicates across cards", () => {
    const BOB = { ...ALICE, id: "char_bob", name: "Bob" };
    const ref = { list: [] as string[] };
    renderWithToast(
      <CharacterEditor projectId="p1" data={{ characters: [ALICE, BOB] }} onSaved={() => {}} />,
      (m) => { ref.list = m; },
    );
    // Both Alice and Bob have a 性格 regenerate button — suffixed by character index.
    expect(screen.getByTestId("section-regenerate-性格-0")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-性格-1")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-行为示例-1")).toBeInTheDocument();
  });

  it("personality regenerate calls API with section=personality and default opts", async () => {
    (api.regenerateCharacterSection as ReturnType<typeof vi.fn>).mockResolvedValue(ALICE);
    const ref = { list: [] as string[] };
    renderWithToast(
      <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />,
      (m) => { ref.list = m; },
    );

    fireEvent.click(screen.getByTestId("section-regenerate-性格-0"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() =>
      expect(api.regenerateCharacterSection).toHaveBeenCalledWith(
        "p1", "char_alice", "personality", { keepExisting: false, userModifications: "" },
      ),
    );
    await waitFor(() => expect(ref.list.some((m) => m.includes("性格"))).toBe(true));
  });

  it("behavior_examples regenerate calls regenerateCharacterExamples", async () => {
    (api.regenerateCharacterExamples as ReturnType<typeof vi.fn>).mockResolvedValue(ALICE);
    const ref = { list: [] as string[] };
    renderWithToast(
      <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />,
      (m) => { ref.list = m; },
    );

    fireEvent.click(screen.getByTestId("section-regenerate-行为示例-0"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() =>
      expect(api.regenerateCharacterExamples).toHaveBeenCalledWith("p1", "char_alice", false, ""),
    );
    await waitFor(() => expect(ref.list.some((m) => m.includes("行为示例"))).toBe(true));
  });

  it("readOnly=true hides all regenerate buttons", () => {
    renderWithToast(
      <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} readOnly />,
      () => {},
    );
    expect(screen.queryByTestId("section-regenerate-性格-0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-regenerate-声音特征-0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-regenerate-当前状态-0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-regenerate-角色未知-0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-regenerate-人物关系-0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-regenerate-行为示例-0")).not.toBeInTheDocument();
  });
});