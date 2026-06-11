const API_BASE = "/api";
const TIMEOUT_MS = 120_000;

class ApiError extends Error {
  code: string;
  detail: Record<string, unknown>;

  constructor(code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.detail = detail;
    this.name = "ApiError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new ApiError("TIMEOUT", "请求超时", {});
    }
    throw new ApiError("NETWORK_ERROR", "网络请求失败", {});
  } finally {
    clearTimeout(timer);
  }

  let json: Record<string, unknown>;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(
      "PARSE_ERROR",
      `服务器返回无效响应 (${res.status})`,
      {}
    );
  }

  // FastAPI wraps HTTPException detail: {"detail": {"error": true, "code": "X", ...}}
  const errorPayload = (json.detail as Record<string, unknown>) || json;
  if (errorPayload.error) {
    throw new ApiError(
      (errorPayload.code as string) || "UNKNOWN",
      (errorPayload.message as string) || "未知错误",
      (errorPayload.detail as Record<string, unknown>) || {}
    );
  }

  return (json.detail as T) ?? (json as T);
}

// --- Type definitions (mirror Pydantic models) ---

export interface ProjectSummary {
  id: string;
  title: string;
  genre: string;
  current_stage: string;
  created_at: string;
  min_words: number;
}

export interface Project {
  id: string;
  title: string;
  genre: string;
  min_words: number;
  initial_intent: { free_text: string; inspiration_source?: string };
  current_stage: string;
  stage_history: Array<{ from: string; to: string; timestamp: string }>;
  created_at: string;
}

export interface Concept {
  title: string;
  genre: string;
  premise: string;
  tone: string;
  theme: string;
  target_audience: string;
  style_template: string;
}

export interface StoryDNA {
  core_contradiction: {
    statement: string;
    side_a: string;
    side_b: string;
  };
  value_stack: Array<{ value_a: string; value_b: string }>;
}

export interface ConceptResponse {
  concept: Concept;
  story_dna: StoryDNA;
}

export interface WorldRulesSummary {
  name: string;
  ceilings: string[];
  core_rules: string[];
}

export interface World {
  era: string;
  geography: string;
  power_system: {
    name: string;
    description: string;
    stages: string[];
    core_rules: string[];
    ceilings: string[];
    cost_system?: string;
  };
  factions: Array<{ name: string; type: string; goal: string; relations: string }>;
  core_rules: string[];
}

export interface Character {
  id: string;
  name: string;
  personality: {
    beliefs: string[];
    desires: string[];
    fears: string[];
    values: string[];
    core_traits: string[];
  };
  current_state: {
    location: string;
    physical_condition: string;
    emotional: string;
    known_secrets: string[];
  };
  voice_signature: {
    speech_style: string;
    thought_patterns: string;
    taboos: string[];
  };
  unknown_to_character: string[];
  is_core_character: boolean;
}

export interface ScenePlan {
  scene_number: number;
  goal: string;
  conflict: string;
  emotional_arc: string;
  narrative_role: "setup" | "mini_payoff" | "cliffhanger" | "major_reveal";
  beat_type: string;
  registry_changes: {
    created: Array<{ type: string; id_pattern: string; description: string }>;
    updated: Array<{ asset_id: string; field: string; new_value: string }>;
  };
  required_logs: string[];
}

export interface Outline {
  chapters: Array<{
    chapter_number: number;
    title: string;
    scene_plan: ScenePlan[];
  }>;
}

export interface ParsedLog {
  type: string;
  params: Record<string, string>;
  raw_text: string;
}

export interface CheckResult {
  check_id: number;
  name: string;
  passed: boolean;
  detail?: string;
}

export interface FactGuardResult {
  all_passed: boolean;
  checks: CheckResult[];
  coherence_score: number;
}

export interface RegistryUpdateReport {
  created: string[];
  updated: string[];
}

export interface WriteSceneResponse {
  status: "passed" | "retry" | "circuit_breaker_triggered";
  scene_number: number;
  draft_text?: string;
  parsed_logs?: ParsedLog[];
  fact_guard_results?: FactGuardResult;
  registry_updates?: RegistryUpdateReport;
  retry_count?: number;
  retry_hints?: string[];
  persistent_failures?: CheckResult[];
  compatibility_note?: string;
  user_options?: string[];
}

export interface ProjectStatus {
  project_id: string;
  current_stage: string;
  title: string;
  created_at: string;
}

export interface ProgressFile {
  project_id: string;
  current_stage: string;
  current_chapter: number;
  total_chapters: number;
  chapters: Array<{
    chapter_number: number;
    status: string;
    scenes: Array<{
      scene_number: number;
      status: string;
      retry_count: number;
      coherence_score: number;
    }>;
  }>;
  circuit_breaker_events: Array<Record<string, unknown>>;
}

export interface AdvanceResponse {
  current_stage: string;
  preconditions: Record<string, boolean>;
}

// --- API functions ---

export const api = {
  listProjects: () =>
    request<ProjectSummary[]>("GET", "/project/list"),

  createProject: (data: { intent: string; genre: string; min_words: number }) =>
    request<Project>("POST", "/project/create", data),

  getProjectStatus: (id: string) =>
    request<ProjectStatus>("GET", `/project/${id}/status`),

  advance: (projectId: string, targetStage: string) =>
    request<AdvanceResponse>("POST", "/conductor/advance", { project_id: projectId, target_stage: targetStage }),

  generateConcept: (projectId: string) =>
    request<ConceptResponse>("POST", "/stage1/generate", { project_id: projectId }),

  updateConcept: (projectId: string, concept: Concept, storyDna: StoryDNA) =>
    request<void>("PUT", "/stage1/concept", { project_id: projectId, concept, story_dna: storyDna }),

  generateWorld: (projectId: string) =>
    request<World>("POST", "/stage2/generate-world", { project_id: projectId }),

  generateCharacter: (projectId: string) =>
    request<Character>("POST", "/stage2/generate-character", { project_id: projectId }),

  updateWorld: (projectId: string, world: World) =>
    request<void>("PUT", "/stage2/world", { project_id: projectId, world }),

  updateCharacter: (projectId: string, character: Character) =>
    request<void>("PUT", "/stage2/character", { project_id: projectId, character }),

  generateOutline: (projectId: string) =>
    request<Outline>("POST", "/stage3/generate", { project_id: projectId }),

  updateOutline: (projectId: string, outline: Outline) =>
    request<void>("PUT", "/stage3/outline", { project_id: projectId, outline }),

  getScenePlan: (projectId: string, sceneNum: number) =>
    request<ScenePlan>("GET", `/stage4/scene-plan/${sceneNum}?project_id=${projectId}`),

  writeScene: (data: { project_id: string; chapter_number: number; scene_number: number }) =>
    request<WriteSceneResponse>("POST", "/stage4/write-scene", data),

  forcePass: (data: { project_id: string; scene_number: number }) =>
    request<void>("POST", "/stage4/force-pass", data),

  skipScene: (data: { project_id: string; scene_number: number }) =>
    request<void>("POST", "/stage4/skip-scene", data),

  getStage4Progress: (projectId: string) =>
    request<ProgressFile>("GET", `/stage4/progress?project_id=${projectId}`),

  getRegistry: (projectId: string, registryType: string) =>
    request<Array<Record<string, unknown>>>("GET", `/storyos/${registryType}?project_id=${projectId}`),
};

export { ApiError };
export default api;
