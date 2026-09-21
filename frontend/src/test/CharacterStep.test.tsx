import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../hooks/useToast";

vi.mock("../api/client", () => ({
  default: {
    generateCharacter: vi.fn(),
    updateCharacter: vi.fn(),
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

beforeEach(() => {
  (api.generateCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.updateCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.advance as ReturnType<typeof vi.fn>).mockReset();
  (api.advance as ReturnType<typeof vi.fn>).mockResolvedValue({ current_stage: "STAGE3" });
  (api.getConcept as ReturnType<typeof vi.fn>).mockReset();
  (api.getWorld as ReturnType<typeof vi.fn>).mockReset();
  (api.getCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.getNovelOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.getOutline as ReturnType<typeof vi.fn>).mockReset();
  sessionStorage.clear();
});

function setup() {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({
      currentStep: 3,
      completedSteps: [1, 2],
      status: "idle",
      data: {
        concept: null, story_dna: null, world: null,
        characters: null, novel_outline: null, chapter1_outline: null,
      },
      errorMessage: null,
    }),
  );
  return render(
    <ToastProvider><MemoryRouter>
      <InitWizardModal projectId={PROJECT} onDismiss={vi.fn()} />
    </MemoryRouter></ToastProvider>,
  );
}

function makeChar(id: string, type: string, name = "C" + id, overrides: Partial<ReturnType<typeof makeChar>> = {}) {
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
    ...overrides,
  };
}

describe("CharacterStep", () => {
  it("batch start calls generateCharacter 6 times (1+2+3) and renders 6 cards", async () => {
    let callIdx = 0;
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, t: string) => {
      callIdx += 1;
      return { characters: [makeChar(`c${callIdx}`, t)], current: null };
    });
    setup();
    await waitFor(() => expect(screen.getByTestId("character-form")).toBeInTheDocument());
    expect(api.generateCharacter).toHaveBeenCalledTimes(6);
    const types = (api.generateCharacter as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(types.filter((t) => t === "protagonist")).toHaveLength(1);
    expect(types.filter((t) => t === "antagonist")).toHaveLength(2);
    expect(types.filter((t) => t === "supporting")).toHaveLength(3);
    expect(screen.getByTestId("character-tabs").children).toHaveLength(6);
    expect(screen.getByText("已生成 6 个角色")).toBeInTheDocument();
  });

  it("manual add appends to the existing list (does not replace)", async () => {
    let callIdx = 0;
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, t: string) => {
      callIdx += 1;
      return { characters: [makeChar(`c${callIdx}`, t)], current: null };
    });
    setup();
    // The 6-character batch auto-triggers on mount.
    await waitFor(() => expect(screen.getByTestId("character-form")).toBeInTheDocument());
    expect(screen.getByTestId("character-tabs").children).toHaveLength(6);
    expect(api.generateCharacter).toHaveBeenCalledTimes(6);
    // Add an extra supporting character: open the + menu, then click the
    // supporting option (the menu's button, NOT CharacterStep's removed button).
    await act(async () => {
      screen.getByTestId("character-tab-add").click();
    });
    await act(async () => {
      screen.getByTestId("character-add-supporting").click();
    });
    await waitFor(() => expect(screen.getByTestId("character-tabs").children).toHaveLength(7));
    expect(api.generateCharacter).toHaveBeenCalledTimes(7);
    expect(api.generateCharacter).toHaveBeenLastCalledWith("proj_x", "supporting");
  });

  it("'重新生成' in modal footer discards existing characters and starts a fresh batch", async () => {
    let callIdx = 0;
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, t: string) => {
      callIdx += 1;
      return { characters: [makeChar(`c${callIdx}`, t)], current: null };
    });
    setup();
    await waitFor(() => expect(screen.getByTestId("character-tabs").children).toHaveLength(6));
    expect(api.generateCharacter).toHaveBeenCalledTimes(6);
    // v1.9: click regenerate — opens the full-character RegenerateModal
    // (replaces the v1.8 destructive-confirm dialog). Confirm it to start
    // the fresh batch.
    await act(async () => {
      screen.getByTestId("wizard-regenerate").click();
    });
    await waitFor(() => expect(screen.getByTestId("regenerate-modal")).toBeInTheDocument());
    await act(async () => {
      screen.getByTestId("regenerate-modal-confirm").click();
    });
    await waitFor(() => expect(api.generateCharacter).toHaveBeenCalledTimes(12));
    expect(screen.getByTestId("character-tabs").children).toHaveLength(6);
  });

  it("'确认修改并继续' in modal footer calls updateCharacter with the merged list", async () => {
    let callIdx = 0;
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, t: string) => {
      callIdx += 1;
      return { characters: [makeChar(`c${callIdx}`, t)], current: null };
    });
    (api.updateCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    setup();
    await waitFor(() => expect(screen.getByTestId("character-form")).toBeInTheDocument());
    await act(async () => {
      screen.getByTestId("wizard-next").click();
    });
    await waitFor(() => expect(api.updateCharacter).toHaveBeenCalledTimes(1));
    const call = (api.updateCharacter as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].characters).toHaveLength(6);
    await waitFor(() => expect(api.advance).toHaveBeenCalledWith("proj_x", "STAGE3"));
  });

  it("does not continue when advancing to STAGE3 fails", async () => {
    let callIdx = 0;
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, t: string) => {
      callIdx += 1;
      return { characters: [makeChar(`c${callIdx}`, t)], current: null };
    });
    (api.updateCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (api.advance as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("阶段推进失败"));
    setup();
    await waitFor(() => expect(screen.getByTestId("character-form")).toBeInTheDocument());

    await act(async () => {
      screen.getByTestId("wizard-next").click();
    });

    expect(await screen.findByText("阶段推进失败")).toBeInTheDocument();
    expect(screen.getByTestId("character-step")).toBeInTheDocument();
  });

  it("error state shows the error banner with no '重试' button; footer '重新生成' retries", async () => {
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("LLM down"));
    setup();
    expect(await screen.findByText(/LLM down/)).toBeInTheDocument();
    expect(screen.queryByText("重试")).not.toBeInTheDocument();
    const regen = await screen.findByTestId("wizard-regenerate");
    expect(regen).not.toBeDisabled();
  });

  it("each character card exposes 人格层, 声音签名, 角色关系 sections", async () => {
    let callIdx = 0;
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, _t: string) => {
      callIdx += 1;
      const charNum = callIdx;
      const char = makeChar(`c${charNum}`, "protagonist", charNum === 1 ? "林峰" : `C${charNum}`, {
        ...(charNum === 1 ? {
          personality: {
            core_traits: ["坚毅", "聪明"],
            beliefs: ["正道必胜"],
            desires: ["守护苍生"],
            fears: ["失去同伴"],
            values: ["义"],
          },
          voice_signature: {
            speech_style: "沉稳、简洁",
            thought_patterns: "三思后行",
            taboos: ["撒谎"],
          },
          relations: {
            c2: { status: "ally", history: [], last_update_chapter: 3 },
          },
        } : {}),
      });
      return { characters: [char], current: null };
    });
    setup();
    await waitFor(() => expect(screen.getByTestId("character-form")).toBeInTheDocument());
    expect(screen.getByTestId("character-c1-personality")).toBeInTheDocument();
    expect(screen.getByTestId("character-c1-voice")).toBeInTheDocument();
    expect(screen.getByTestId("character-c1-relations")).toBeInTheDocument();
    expect(screen.getByTestId("character-c1-personality").textContent).toContain("坚毅");
    expect(screen.getByTestId("character-c1-personality").textContent).toContain("正道必胜");
    expect(screen.getByTestId("character-c1-voice").textContent).toContain("沉稳、简洁");
    expect(screen.getByTestId("character-c1-voice").textContent).toContain("三思后行");
    expect(screen.getByTestId("character-c1-relations").textContent).toContain("ally");
  });

  it("relation card resolves target id to character name when present in the cast", async () => {
    let callNum = 0;
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id: string, type: string) => {
        callNum += 1;
        if (callNum === 1) {
          // First batch call: protagonist c1=林峰 with relation referring to c2.
          return {
            characters: [makeChar("c1", "protagonist", "林峰", {
              relations: { c2: { status: "ally", history: [], last_update_chapter: 5 } },
            })],
            current: null,
          };
        }
        if (callNum === 7) {
          // 7th call (manual add): cumulative response. Wizard picks c2=苏晓晓
          // as the new character and appends it; c1's relation {c2} now resolves.
          const c1 = makeChar("c1", "protagonist", "林峰", {
            relations: { c2: { status: "ally", history: [], last_update_chapter: 5 } },
          });
          const c2 = makeChar("c2", "supporting", "苏晓晓", {
            relations: { c1: { status: "ally", history: [], last_update_chapter: 5 } },
          });
          return { characters: [c1, c2], current: null };
        }
        // Antagonist + supporting batch calls (2-6) — return plain unique
        // characters so we don't collide with the c1/c2 we care about.
        return { characters: [makeChar(`other${callNum}`, type)], current: null };
      },
    );
    setup();
    await waitFor(() => expect(screen.getByTestId("character-form")).toBeInTheDocument());
    // Open the + menu, then click the supporting option.
    await act(async () => {
      screen.getByTestId("character-tab-add").click();
    });
    await act(async () => {
      screen.getByTestId("character-add-supporting").click();
    });
    await waitFor(() => expect(screen.getByTestId("character-tabs").children).toHaveLength(7));
    // c1's relations now resolve c2 → 苏晓晓, and the status select shows "ally".
    const c1Relations = screen.getByTestId("character-c1-relations");
    expect(c1Relations.textContent).toContain("苏晓晓");
    expect(c1Relations.textContent).toContain("ally");
    // c2's relations resolve c1 → 林峰.
    const c2Relations = screen.getByTestId("character-c2-relations");
    expect(c2Relations.textContent).toContain("林峰");
  });

  it("'角色关系' editor is always rendered (no display-mode toggle required)", async () => {
    let callIdx = 0;
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, _t: string) => {
      callIdx += 1;
      return { characters: [makeChar(`c${callIdx}`, "protagonist", callIdx === 1 ? "林峰" : `C${callIdx}`)], current: null };
    });
    setup();
    await waitFor(() => expect(screen.getByTestId("character-form")).toBeInTheDocument());
    // The relations editor is rendered directly inside the card — no edit
    // toggle required to add a relation. The add button is present even when
    // the character currently has no relations.
    const relations = screen.getByTestId("character-c1-relations");
    expect(relations.querySelector("[data-testid='relations-add-button']")).toBeInTheDocument();
  });

  it("empty voice_signature fields render as empty inputs (inline-edit mode, no em-dash placeholder)", async () => {
    let callIdx = 0;
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, _t: string) => {
      callIdx += 1;
      return { characters: [makeChar(`c${callIdx}`, "supporting", callIdx === 1 ? "路人甲" : `C${callIdx}`)], current: null };
    });
    setup();
    await waitFor(() => expect(screen.getByTestId("character-form")).toBeInTheDocument());
    // Inline-edit mode: empty speech_style is an empty <textarea>, not a "—".
    const voice = screen.getByTestId("character-c1-voice");
    const speechInput = voice.querySelector("textarea");
    expect(speechInput).toBeInTheDocument();
    expect(speechInput?.value).toBe("");
    expect(voice.textContent).not.toContain("—");
  });

  it("ignores prior characters in cumulative response (regression: 6×李玄阳)", async () => {
    const cumulative: ReturnType<typeof makeChar>[] = [];
    let i = 0;
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, t: string) => {
      i += 1;
      const newChar = makeChar(`c${i}`, t);
      cumulative.push(newChar);
      return { characters: [...cumulative], current: null };
    });
    setup();
    await waitFor(() => expect(screen.getByTestId("character-form")).toBeInTheDocument());
    expect(api.generateCharacter).toHaveBeenCalledTimes(6);
    expect(screen.getByTestId("character-tabs").children).toHaveLength(6);
    for (let n = 1; n <= 6; n++) {
      expect(screen.getByTestId(`character-panel-c${n}`)).toBeInTheDocument();
    }
  });

  it("manual add takes only the new character from a cumulative response", async () => {
    const cumulative: ReturnType<typeof makeChar>[] = [];
    let i = 0;
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, _t: string) => {
      i += 1;
      const newChar = makeChar(`c${i}`, "supporting", i === 1 ? "林峰" : `C${i}`);
      cumulative.push(newChar);
      return { characters: [...cumulative], current: null };
    });
    setup();
    await waitFor(() => expect(screen.getByTestId("character-tabs").children).toHaveLength(6));
    // Manual add: backend returns cumulative list with a fresh id for the
    // newly-created character. The wizard must pick the last entry (the new
    // one) and append it; the existing c1=林峰 must be preserved (not replaced
    // by the cumulative response — regression: "6×李玄阳").
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      const c1 = makeChar("c1", "protagonist", "林峰");
      const c7 = makeChar("c7", "supporting", "苏晓晓");
      return { characters: [c1, c7], current: null };
    });
    // Open the + menu, then click the supporting option.
    await act(async () => {
      screen.getByTestId("character-tab-add").click();
    });
    await act(async () => {
      screen.getByTestId("character-add-supporting").click();
    });
    await waitFor(() => expect(screen.getByTestId("character-tabs").children).toHaveLength(7));
    // c1 (the existing 林峰) is preserved; c7 is the new 苏晓晓 appended via manual add.
    // Names live inside <input> values in inline-edit mode, so check the input
    // directly rather than the card's textContent.
    expect(screen.getByTestId("character-c1-name")).toHaveValue("林峰");
    expect(screen.getByTestId("character-c7-name")).toHaveValue("苏晓晓");
  });
});

// Pre-populate sessionStorage with existing characters so the auto-batch
// useEffect (which fires when wizard.data.characters is empty/null) doesn't
// run. Mirrors the pattern in CharacterStep.edit_delete.test.tsx.
function setupWithCharacters(chars: ReturnType<typeof makeChar>[]) {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({
      currentStep: 3,
      completedSteps: [1, 2, 3],
      status: "idle",
      data: {
        concept: null, story_dna: null, world: null,
        characters: { characters: chars, current: null },
        novel_outline: null, chapter1_outline: null,
      },
      errorMessage: null,
    }),
  );
  return render(
    <ToastProvider><MemoryRouter>
      <InitWizardModal projectId={PROJECT} onDismiss={vi.fn()} />
    </MemoryRouter></ToastProvider>,
  );
}

// Helper for auto-batch tests: the setup() defaults to characters:null so
// the auto-batch effect fires on mount. Each call to generateCharacter
// returns a single new character (callIdx starts at 1 → id c1, c2, ...).
function setupWithAutoBatch() {
  let callIdx = 0;
  (api.generateCharacter as ReturnType<typeof vi.fn>).mockImplementation(
    async (_id: string, t: string) => {
      callIdx += 1;
      return { characters: [makeChar(`c${callIdx}`, t)], current: null };
    },
  );
  return setup();
}

describe("CharacterStep tab strip", () => {
  it("tab label = {name}-{typeLabel}, with '未命名 N-类型' fallback when name empty", () => {
    setupWithCharacters([
      makeChar("c1", "protagonist", "林峰"),
      makeChar("c2", "supporting", "苏晓晓"),
      makeChar("c3", "mentor", ""),
    ]);
    expect(screen.getByTestId("character-tab-c1").textContent).toContain("林峰");
    expect(screen.getByTestId("character-tab-c1").textContent).toContain("主角");
    expect(screen.getByTestId("character-tab-c2").textContent).toContain("苏晓晓");
    expect(screen.getByTestId("character-tab-c2").textContent).toContain("配角");
    // c3 has empty name → "未命名 3" (index 2 + 1) with typeLabel "导师"
    expect(screen.getByTestId("character-tab-c3").textContent).toContain("未命名 3");
    expect(screen.getByTestId("character-tab-c3").textContent).toContain("导师");
  });

  it("clicking a different character tab switches the active panel", async () => {
    setupWithCharacters([
      makeChar("c1", "protagonist", "林峰"),
      makeChar("c2", "supporting", "苏晓晓"),
    ]);
    // Wait for tabs to render (activeCharacterId is set in a useEffect).
    await screen.findByTestId("character-tab-c1");
    // Active panel is c1 (hidden=false); c2 is mounted but hidden=true.
    // jsdom reflects the `hidden` attribute on the DOM property.
    const c1Panel = screen.getByTestId("character-panel-c1");
    const c2Panel = screen.getByTestId("character-panel-c2");
    expect(c1Panel.hidden).toBe(false);
    expect(c2Panel.hidden).toBe(true);
    // Click c2 tab.
    fireEvent.click(screen.getByTestId("character-tab-c2"));
    await waitFor(() => {
      expect((screen.getByTestId("character-panel-c2") as HTMLElement).hidden).toBe(false);
    });
    expect((screen.getByTestId("character-panel-c1") as HTMLElement).hidden).toBe(true);
  });

  it("per-character sub-tab memory: switching back to a character lands on the sub-tab you left it on", async () => {
    setupWithCharacters([
      makeChar("c1", "protagonist", "林峰"),
      makeChar("c2", "supporting", "苏晓晓"),
    ]);
    await screen.findByTestId("character-tab-c1");
    // Switch to c2, then to its voice_signature sub-tab. Each panel has its
    // own SubTabStrip with identical testids — scope queries to the c2 panel.
    fireEvent.click(screen.getByTestId("character-tab-c2"));
    await waitFor(() => {
      expect((screen.getByTestId("character-panel-c2") as HTMLElement).hidden).toBe(false);
    });
    const c2Panel = () => screen.getByTestId("character-panel-c2");
    fireEvent.click(within(c2Panel()).getByTestId("character-subtab-voice"));
    await waitFor(() => {
      expect(within(c2Panel()).getByTestId("character-c2-voice")).toBeInTheDocument();
    });
    // Switch to c1 → defaults to personality.
    fireEvent.click(screen.getByTestId("character-tab-c1"));
    await waitFor(() => {
      expect((screen.getByTestId("character-panel-c1") as HTMLElement).hidden).toBe(false);
    });
    const c1Panel = () => screen.getByTestId("character-panel-c1");
    expect(within(c1Panel()).getByTestId("character-c1-personality")).toBeInTheDocument();
    // Back to c2 → still on voice (per-character sub-tab memory).
    fireEvent.click(screen.getByTestId("character-tab-c2"));
    await waitFor(() => {
      expect((screen.getByTestId("character-panel-c2") as HTMLElement).hidden).toBe(false);
    });
    expect(within(c2Panel()).getByTestId("character-c2-voice")).toBeInTheDocument();
  });

  it("+ button opens AddCharacterMenu; clicking an option generates + auto-jumps to the new tab", async () => {
    setupWithAutoBatch();
    // Wait for the default 6-char batch.
    await screen.findByTestId("character-tabs");
    await waitFor(() => expect(screen.getByTestId("character-tabs").children).toHaveLength(6));
    // The first batch-generated character has id "c1" and is initially active.
    expect(screen.getByTestId("character-panel-c1")).toBeInTheDocument();
    // Open the + menu.
    fireEvent.click(screen.getByTestId("character-tab-add"));
    expect(screen.getByTestId("character-add-menu")).toBeInTheDocument();
    // The next generateCharacter call returns only the new character.
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      characters: [makeChar("c_new", "antagonist", "新反派")],
      current: null,
    });
    fireEvent.click(screen.getByTestId("character-add-antagonist"));
    // Wait for the new tab + auto-jump.
    await waitFor(() => {
      expect(screen.getByTestId("character-tab-c_new")).toBeInTheDocument();
    });
    await waitFor(() => {
      const panel = screen.getByTestId("character-panel-c_new") as HTMLElement;
      expect(panel.hidden).toBe(false);
    });
    // Total tabs grew by 1 (the + button is not inside character-tabs).
    expect(screen.getByTestId("character-tabs").children).toHaveLength(7);
  });

  it("pressing Escape on AddCharacterMenu closes the menu without generating", async () => {
    setupWithAutoBatch();
    await screen.findByTestId("character-tabs");
    await waitFor(() => expect(screen.getByTestId("character-tabs").children).toHaveLength(6));
    const callsBefore = (api.generateCharacter as ReturnType<typeof vi.fn>).mock.calls.length;
    // Open the + menu.
    fireEvent.click(screen.getByTestId("character-tab-add"));
    expect(screen.getByTestId("character-add-menu")).toBeInTheDocument();
    // Press Escape on window — AddCharacterMenu listens on window keydown.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("character-add-menu")).not.toBeInTheDocument();
    });
    // No new generateCharacter calls — still the original 6 from auto-batch.
    expect((api.generateCharacter as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
  });
});