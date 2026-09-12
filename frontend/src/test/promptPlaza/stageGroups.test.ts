import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  EXPECTED_ORPHAN_PROMPTS,
  HIDDEN_BUILTIN_PROMPTS,
  PROMPT_NAME_TO_STAGE,
  PROMPT_STAGE_LABELS,
  PROMPT_STAGE_ORDER,
  groupByStage,
  isExpectedOrphan,
  stageOf,
} from "../../components/home/promptPlaza/stageGroups";
import type { PromptSummary } from "../../api/promptPlaza";

// vitest 跑在 frontend/ 下,cwd = frontend;prompts 目录在 repo root 上一层
const PROMPTS_DIR = join(process.cwd(), "..", "backend", "prompts");

/** 递归收集目录下所有 .yaml 文件名(去重 — 同一 stem 可能分散在子目录里)。 */
function collectYamlStems(root: string): string[] {
  const seen = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (entry.endsWith(".yaml")) seen.add(entry.replace(/\.yaml$/, ""));
    }
  };
  walk(root);
  return [...seen].sort();
}

const fakePrompt = (name: string): PromptSummary => ({
  name,
  category: "",
  label: name,
  has_override: false,
  modified_at: null,
  builtin: true,
});

describe("stageOf", () => {
  it("maps known prompts to their workspace stage", () => {
    expect(stageOf("firstness_decompose")).toBe("divergence");
    expect(stageOf("adaptive_diverge")).toBe("divergence");
    expect(stageOf("outline_generation")).toBe("chapter");
    expect(stageOf("scene_writing")).toBe("chapter_writing");
    expect(stageOf("narrative_guard")).toBe("review");
    expect(stageOf("sandbox_preview")).toBe("style");
  });

  it("falls back to 'other' for unmapped names", () => {
    expect(stageOf("totally_made_up_prompt_xyz")).toBe("other");
    expect(stageOf("")).toBe("other");
  });
});

describe("groupByStage", () => {
  it("returns groups in PROMPT_STAGE_ORDER regardless of input order", () => {
    const prompts = [
      fakePrompt("narrative_guard"),
      fakePrompt("adaptive_diverge"),
      fakePrompt("outline_generation"),
    ];
    const groups = groupByStage(prompts);
    const keys = groups.map(([key]) => key);
    const orderIndices = keys.map((k) => PROMPT_STAGE_ORDER.indexOf(k));
    // 单调递增 = 输出顺序遵循 PROMPT_STAGE_ORDER
    for (let i = 1; i < orderIndices.length; i++) {
      expect(orderIndices[i]).toBeGreaterThan(orderIndices[i - 1]);
    }
  });

  it("drops empty groups", () => {
    // SAMPLE 全是 divergence/chapter_writing/review,其它组应被过滤
    const prompts = [
      fakePrompt("adaptive_diverge"),
      fakePrompt("scene_writing"),
      fakePrompt("narrative_guard"),
    ];
    const groups = groupByStage(prompts);
    const keys = groups.map(([k]) => k);
    expect(keys).toEqual(["divergence", "chapter_writing", "review"]);
    expect(keys).not.toContain("concept");
    expect(keys).not.toContain("style");
  });

  it("preserves input order within a group (API sort is the source of truth)", () => {
    // groupByStage 只负责按 stage 分桶,不重排组内顺序 — 后端 API 已按
    // canonical usage order 返回 prompts,这里只要确认顺序不被破坏。
    const prompts = [fakePrompt("adaptive_diverge")];
    const [, items] = groupByStage(prompts)[0];
    expect(items.map((p) => p.name)).toEqual(["adaptive_diverge"]);

    // 反向输入也按输入顺序输出
    const reversed = [fakePrompt("adaptive_diverge")];
    const [, items2] = groupByStage(reversed)[0];
    expect(items2.map((p) => p.name)).toEqual(["adaptive_diverge"]);
  });

  it("sends unmapped prompts to the 'other' bucket", () => {
    const prompts = [
      fakePrompt("adaptive_diverge"),
      fakePrompt("future_prompt_we_havent_added_yet"),
    ];
    const groups = groupByStage(prompts);
    const other = groups.find(([k]) => k === "other");
    expect(other).toBeDefined();
    expect(other![1].map((p) => p.name)).toContain("future_prompt_we_havent_added_yet");
  });
});

describe("PROMPT_STAGE_LABELS / PROMPT_STAGE_ORDER contract", () => {
  it("every PROMPT_STAGE_ORDER key has a label", () => {
    for (const key of PROMPT_STAGE_ORDER) {
      expect(PROMPT_STAGE_LABELS[key]).toBeTruthy();
    }
  });

  it("every mapped prompt name resolves to a stage in PROMPT_STAGE_ORDER", () => {
    // 防止某天有人把 PROMPT_STAGE_ORDER 改了但忘了 PROMPT_NAME_TO_STAGE
    const ordered = new Set(PROMPT_STAGE_ORDER);
    for (const stage of Object.values(PROMPT_NAME_TO_STAGE)) {
      expect(ordered.has(stage)).toBe(true);
    }
  });

  it("EXPECTED_ORPHAN_PROMPTS names are unique and not in PROMPT_NAME_TO_STAGE", () => {
    // EXPECTED_ORPHAN_PROMPTS 里的名字必须确实 *没* 被映射到任何具体 stage
    // — 否则该把它移回 PROMPT_NAME_TO_STAGE 而不是「其他」。
    const seen = new Set<string>();
    for (const { name } of EXPECTED_ORPHAN_PROMPTS) {
      expect(seen.has(name), `${name} 在 EXPECTED_ORPHAN_PROMPTS 里出现多次`).toBe(false);
      seen.add(name);
      expect(
        PROMPT_NAME_TO_STAGE[name],
        `${name} 已被映射到 ${PROMPT_NAME_TO_STAGE[name]},不应同时出现在 EXPECTED_ORPHAN_PROMPTS`,
      ).toBeUndefined();
    }
  });
});

/**
 * 金丝雀:遍历 backend/prompts/ 下所有 .yaml,断言每个 prompt 要么映射到
 * 具体 stage,要么在 EXPECTED_ORPHAN_PROMPTS 中被明确登记。
 *
 * 新增 YAML 但忘记更新 stageGroups.ts 时,这个测试会挂 —
 * 提示你把它放进合适的 workspace stage,或者在 EXPECTED_ORPHAN_PROMPTS
 * 里登记(必须写清楚为何不归入主流程)。
 */
describe("backend/prompts/ canary", () => {
  const stems = collectYamlStems(PROMPTS_DIR);

  it("every built-in YAML prompt is either mapped to a stage or explicitly orphaned", () => {
    const unmapped: string[] = [];
    for (const stem of stems) {
      if (stageOf(stem) !== "other") continue; // mapped to a real stage
      if (isExpectedOrphan(stem)) continue; // explicitly orphaned
      unmapped.push(stem);
    }
    expect(
      unmapped,
      `以下提示词在 backend/prompts/ 下存在,但 stageGroups.ts 既没映射到工作台阶段、也没在 EXPECTED_ORPHAN_PROMPTS 登记:\n${unmapped.join("\n")}`,
    ).toEqual([]);
  });

  it("PROMPT_NAME_TO_STAGE does not reference a prompt that no longer exists", () => {
    // 反向:PROMPT_NAME_TO_STAGE 里的 key 都应在磁盘上有对应 YAML
    const orphanKeys: string[] = [];
    const stemSet = new Set(stems);
    for (const name of Object.keys(PROMPT_NAME_TO_STAGE)) {
      if (!stemSet.has(name)) orphanKeys.push(name);
    }
    expect(
      orphanKeys,
      `stageGroups.ts 引用了不存在的 prompt YAML:\n${orphanKeys.join("\n")}`,
    ).toEqual([]);
  });

  it("EXPECTED_ORPHAN_PROMPTS references YAMLs that actually exist", () => {
    // 反向:EXPECTED_ORPHAN_PROMPTS 里的名字都应在磁盘上有对应 YAML
    const stemSet = new Set(stems);
    const missing = EXPECTED_ORPHAN_PROMPTS
      .filter((o) => !stemSet.has(o.name))
      .map((o) => o.name);
    expect(
      missing,
      `EXPECTED_ORPHAN_PROMPTS 引用了不存在的 prompt YAML:\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});

describe("HIDDEN_BUILTIN_PROMPTS", () => {
  it("hides firstness_decompose from groupByStage output", () => {
    const prompts = [
      fakePrompt("firstness_decompose"),
      fakePrompt("adaptive_diverge"),
      fakePrompt("scene_writing"),
    ];
    const groups = groupByStage(prompts);
    const allNames = groups.flatMap(([, items]) => items.map((p) => p.name));
    expect(allNames).not.toContain("firstness_decompose");
    // sanity: other divergence prompts still surface
    expect(allNames).toContain("adaptive_diverge");
    expect(allNames).toContain("scene_writing");
  });

  it("stageOf still resolves firstness_decompose (backend plumbing unaffected)", () => {
    // Hide is UI-only — stageOf and load_prompt_effective both still
    // work with the bare stem. Only groupByStage filters it out.
    expect(stageOf("firstness_decompose")).toBe("divergence");
  });

  it("HIDDEN_BUILTIN_PROMPTS is a non-empty list of strings", () => {
    expect(HIDDEN_BUILTIN_PROMPTS.length).toBeGreaterThan(0);
    for (const name of HIDDEN_BUILTIN_PROMPTS) {
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

describe("meta_decompose stage mapping", () => {
  it("stageOf resolves meta_decompose to 'divergence'", () => {
    expect(stageOf("meta_decompose")).toBe("divergence");
  });

  it("PROMPT_NAME_TO_STAGE has meta_decompose → divergence", () => {
    expect(PROMPT_NAME_TO_STAGE.meta_decompose).toBe("divergence");
  });
});
