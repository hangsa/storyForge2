import type { Genre } from "../hooks/useGenres";

export type { Genre };

const API_BASE = "/api";
const TIMEOUT_MS = 600_000;

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

export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // If the caller passed their own AbortSignal (e.g. a per-effect timeout),
  // forward the abort so they can cancel in flight. Also forward our
  // internal TIMEOUT_MS abort to the caller's signal so the caller is
  // notified if we time out at the global layer.
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  let res: Response;
  try {
    const mergedHeaders: Record<string, string> = body
      ? { "Content-Type": "application/json", ...(headers ?? {}) }
      : { ...(headers ?? {}) };
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new ApiError("TIMEOUT", "请求超时", { path });
    }
    throw new ApiError("NETWORK_ERROR", "网络请求失败", { path, message: e instanceof Error ? e.message : String(e) });
  } finally {
    clearTimeout(timer);
  }

  // Read the body as text first so a 5xx with non-JSON body (e.g. upstream
  // proxy truncating a 500 page) surfaces the actual payload in the error
  // instead of the bare "服务器返回无效响应 (500)".
  const rawText = await res.text();
  let json: Record<string, unknown> | null = null;
  if (rawText) {
    try {
      json = JSON.parse(rawText);
    } catch {
      // Non-JSON body. If the status is in 2xx, the server lied about the
      // content-type; if 5xx, an upstream/proxy returned a non-JSON error
      // page. Surface the actual text so the user can see what came back.
      if (res.status >= 500) {
        const preview = rawText.slice(0, 200);
        throw new ApiError(
          "PARSE_ERROR",
          `服务器返回无效响应 (${res.status}) ${method} ${path}: ${preview}`,
          { path, status: res.status, bodyPreview: preview },
        );
      }
      throw new ApiError(
        "PARSE_ERROR",
        `服务器返回无效响应 (${res.status}) ${method} ${path}`,
        { path, status: res.status, bodyPreview: rawText.slice(0, 200) },
      );
    }
  }

  // FastAPI wraps HTTPException detail: {"detail": {"error": true, "code": "X", ...}}
  // If rawText was empty, json is null — but then topError/nestedError are
  // also undefined, so we fall through to the return below.
  const detailObj = (json?.detail as Record<string, unknown> | undefined) ?? undefined;
  const topError = json?.error;
  // Only treat nested detail as an error envelope when `error === true` and
  // a `code` string is present — otherwise payloads like the probe result
  // (`detail: {success, error: "<message>", error_code: "..."}`) would be
  // mis-parsed as error responses because `error` is a string there.
  const nestedError =
    detailObj && typeof detailObj === "object" && detailObj.error === true && typeof detailObj.code === "string"
      ? detailObj
      : undefined;
  if (topError || nestedError) {
    const payload = (nestedError ? nestedError : json) as Record<string, unknown>;
    throw new ApiError(
      (payload.code as string) || "UNKNOWN",
      (payload.message as string) || "未知错误",
      (payload.detail as Record<string, unknown>) || {}
    );
  }

  if (json === null) return null as T;
  return (json.detail as T) ?? (json as T);
}

// --- Type definitions (mirror Pydantic models) ---

export interface ProjectSummary {
  id: string;
  title: string;
  genre: string;
  current_stage: string;
  created_at: string;
  updated_at: number;       // Unix seconds — from GET /api/project/list
  min_words: number;
  target_total_words: number;
  target_length_category: string;
  chapter_count: number;    // added for Nebula Forge bookshelf
  word_count: number;       // added for Nebula Forge bookshelf (visible chars in drafts)
}

export interface BulkDeleteResult {
  deleted: string[];
  failed: { id: string; error: string }[];
  deleted_count: number;
  failed_count: number;
}

export interface ProjectStats {
  total_books: number;
  total_chapters: number;
  total_words: number;
  stage_distribution: Record<string, number>;
  /** Cumulative word count at each chapter completion, oldest → newest.
   *  Empty when no chapters have been written. Used by the sidebar
   *  sparkline on 总字数. */
  word_count_series: number[];
}

export interface Project {
  id: string;
  title: string;
  genre: string;
  min_words: number;
  target_total_words: number;
  target_length_category: string;
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
  /**
   * Provenance of the concept content. "creative_divergence" means the
   * title/genre/premise/tone/theme were prefilled from the Creative
   * Divergence step's selected variant (Task 8); "manual" means a human
   * typed them. Absent on older projects. Used by ConceptStep to render
   * the "由创意发散自动生成，可手动修改" banner + flip back to "manual" on
   * the first user edit (Task 14).
   */
  source?: string;
  /** ID of the creative-divergence variant this concept was seeded from. */
  source_variant_id?: string;
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

export interface PowerSystem {
  name: string;
  description: string;
  stages: string[];
  core_rules: string[];
  ceilings: string[];
  cost_system?: string;
}

export interface World {
  era: string;
  geography: string;
  era_social_structure?: string | null;   // v1.8 [新增] 社会结构
  era_cultural_history?: string | null;   // v1.8 [新增] 历史文化
  /**
   * A world can define several coexisting power systems. Was a single
   * `power_system` object; the backend folds that legacy shape into this
   * array on read, but world.json written by an older build can still reach
   * the UI unconverted — normalize before rendering.
   */
  power_systems: PowerSystem[];
  factions: Array<{ name: string; type: string; goal: string; relations: string }>;
  core_rules: string[];
}

export type GrowthEventType =
  | "betrayal_experienced"
  | "death_of_loved_one"
  | "world_truth_revealed"
  | "personal_identity_crisis"
  | "irreversible_loss"
  | "moral_awakening"
  | "accumulated_evidence"
  | "relationship_transformation";

export interface GrowthStage {
  stage_number: number;
  stage_name: string;
  trigger_event_type: GrowthEventType;
  trigger_event_description: string;
  character_change: string;
  target_chapter_range: string;
  bound_chapter: number | null;
}

export interface GrowthCurve {
  curve_description: string;
  stages: GrowthStage[];
}

export type ConsistencyRuleId =
  | "out_of_range"
  | "invalid_event_type"
  | "missing_event"
  | "low_misaligned"
  | "tight_spacing";

export interface ConsistencyWarning {
  rule_id: ConsistencyRuleId;
  severity: "error" | "warning";
  stage_index: number | null;
  chapter_number: number | null;
  message: string;
  suggestion: string | null;
}

export interface WorkshopCheckResult {
  character_id: string;
  warnings: ConsistencyWarning[];
  checked_at: string;
}

export interface WorkshopAdjustRequest {
  stages: GrowthStage[];
}

export interface WorkshopDiscussRequest {
  question: string;
}

export interface WorkshopDiscussResponse {
  answer: string;
  suggestions: string[];
  skipped_reason?: string;
}

export interface BehaviorExample {
  situation: string;
  action: string;
  speech_sample: string;
}

export interface Character {
  id: string;
  name: string;
  is_core_character: boolean;
  character_type: "protagonist" | "antagonist" | "supporting" | "mentor";
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
    behavior_examples?: BehaviorExample[];
  };
  unknown_to_character: string[];
  relations: Record<string, RelationStatus>;
  growth_curve: GrowthCurve | null;
}

export interface RelationStatus {
  status: string;
  history: Array<Record<string, unknown>>;
  last_update_chapter: number;
}

export interface CharacterSet {
  characters: Character[];
  current: Character;
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
    /** 本章核心主题（per backend/prompts/outline_generation.yaml）。
     *  Optional in older outline.json files written before the field was
     *  introduced; readers must tolerate absence. */
    theme?: string;
    scene_plan: ScenePlan[];
  }>;
}

export interface VolumeDivision {
  name: string;
  chapter_range: string;
  summary: string;
  key_events: string[];
}

export interface GrowthMilestone {
  label: string;
  target_chapter_range: string;
  description: string;
}

export interface KeyPlotPoint {
  title: string;
  must_appear_in_volume: string;
  description: string;
  trigger_chapter_hint: string;
}

export interface NovelOutline {
  core_conflict_theme: string;
  volumes: VolumeDivision[];
  mc_growth_arc: GrowthMilestone[];
  key_plot_points: KeyPlotPoint[];
  generated_at: string;
  updated_at: string;
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
  precheck_result?: PrecheckResult;
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
    total_scenes?: number;
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

export interface DiagnosisIssue {
  id: string;
  priority: "P0" | "P1" | "P2";
  category: string;
  chapter: number;
  description: string;
  suggestion: string;
  asset_id: string;
  status: "open" | "resolved" | "accepted";
}

export interface DiagnosisReport {
  project_id: string;
  total_chapters: number;
  issues: DiagnosisIssue[];
  summary: { p0_count: number; p1_count: number; p2_count: number };
}

// --- v1.6 Settings types ---

export interface GenreThresholds {
  genre: string;
  defaults: Record<string, number | { threshold: number; decay: number }>;
  overrides: Record<string, any>;
  fallback_genre?: string;
}

export interface ModelTierConfig {
  description: string;
  default: string | null;
  retry_on_failure: boolean;
  max_retries: number;
  fallback: string | null;
}

export interface ModelConfig {
  tiers: Record<string, ModelTierConfig>;
  agent_mapping: Record<string, Record<string, { tier: string; model?: string; fallback?: string }>>;
}

// --- v1.6 Chapter Review types ---

export interface ChapterReviewData {
  chapter_number: number;
  timestamp: string;
  coherence_score: number;
  coherence_comment: string;
  reader_os: {
    addiction: number;
    fatigue: number;
    curiosity: number;
    tension: number;
    satisfaction: number;
    frustration: number;
    discussion: number;
  };
  narrative_assets: Record<string, number>;
  narrative_guard_warnings: Array<{ drift_type: string; character: string; severity?: string; description?: string }>;
  fact_guard_summary: { passed: number; failed: number; total: number; pass_rate: number };
  writing_formula_compliance: Array<{ metric: string; expected: any; actual: any; passed: boolean }>;
  style_guard_violations: Array<Record<string, any>>;
  discussion_topics: string[];
  decision: "approved" | "revise" | null;
  decision_feedback: string | null;
}

export interface ChapterReviewList {
  chapters: number[];
}

export interface RegistryAsset {
  id: string;
  status: string;
  description?: string;
  owner?: string;
  target?: string;
  intensity?: string;
  type?: string;
  created_chapter?: number;
  [key: string]: unknown;
}

export interface RegistryResponse {
  type: string;
  count: number;
  items: RegistryAsset[];
}

// --- v1.6 Impact Analysis / Rollback types ---

export interface ImpactEntry {
  chapter_number: number;
  scene_numbers: number[];
  priority: "P0" | "P1" | "P2";
  reason: string;
  affected_assets: string[];
}

export interface ImpactReport {
  project_id: string;
  modified_files: string[];
  entries: ImpactEntry[];
  summary: { P0: number; P1: number; P2: number };
}

export interface RollbackResult {
  status: "confirmed" | "cancelled";
  baseline_updated: boolean;
}

export type BranchStatus = "active" | "dimmed";

// --- v1.2 Creative Divergence types ---

export interface RawIntent {
  prompt: string;
  genre_primary: string;
  genre_secondary?: string;
  target_reader?: string;
  reference_works?: string[];
  forbidden_directions?: string[];
  quick_mode?: boolean;
  /** Trope tags filled in asynchronously by the /init endpoint's
   *  fire-and-forget Tier 3 LLM call (PRD §3.5). May be absent until
   *  background extraction completes. */
  trope_tags?: string[];
}

export interface IdeaVariant {
  id: string;
  title: string;
  premise_one_line: string;
  mutation_type: string;
  mutation_logic: string;
  estimated_novelty: number;
  trope_tags: string[];
  regenerated_count: number;
  /** Set on fusion variants (from /fuse) per PRD §3.4. Absent on
   *  /apply-mutation outputs. Used by S0BMutationStep to render the risk
   *  badge and by /commit's fusion_meta write. */
  risk_level?: "low" | "medium" | "high";
  /** BFS genre-graph distance 0-3+ (0 = same genre). Set on fusion variants
   *  only. */
  fusion_distance?: number;
}

export interface ContradictionCandidate {
  template_type: string;
  preview_statement: string;
  side_a: string;
  side_b: string;
  tension_score: number;
}

export interface CoreContradiction {
  template_type: string;
  statement: string;
  side_a: string;
  side_b: string;
  tension_score: number;
  is_custom: boolean;
  confirmed_at: string;
}

export interface ConfirmContradictRequest {
  template_type: string;
  statement: string;
  side_a: string;
  side_b: string;
  tension_score?: number;
  is_custom: boolean;
}

export interface WhatIfNode {
  id: string;
  parent_id: string | null;
  content: string;
  novelty_score: number | null;
  children_ids: string[];
  /**
   * "active" — on the selected path; "dimmed" — previously-generated
   * sibling that the user did not choose. Backend serializes this for
   * every node; older clients ignore the field. Used by S0D to render
   * 弃选 badges + 切换到此分支 buttons under each parent.
   */
  branch_status?: BranchStatus;
}

export interface NoveltyScores {
  market_saturation: number;
  trope_similarity: number;
  contradiction_depth: number;
  discussion_potential: number;
  composite: number;
  /** Letter grade derived from the composite score (e.g. "中等"). Optional
   *  on older payloads — readers must tolerate absence. */
  grade?: string;
  computed_at: string;
  trope_extraction_status: "pending" | "completed" | "failed";
}

export interface ValueStackLayer {
  value_a: string;
  value_b: string;
  level: "personal" | "social" | "philosophical" | "existential";
}

export interface CommitRequest {
  confirmed_path_ids?: string[];
  user_notes?: string;
  value_stack_override?: ValueStackLayer[];
}

export interface CommitResponse {
  concept_preview?: Record<string, unknown>;
  story_dna_preview?: Record<string, unknown>;
  novelty_summary?: NoveltyScores;
  next_step_url?: string;
  warnings?: string[];
  concept?: Record<string, unknown>;
  story_dna?: Record<string, unknown>;
  source: string;
  committed_at: string;
}

export interface FuseRequest {
  genre_primary: string;
  genre_secondary: string;
  prompt: string;
}

export interface FuseResponse {
  variants: IdeaVariant[];
  fusion_distance: { distance: number; compatibility: string };
  risk_level: "low" | "medium" | "high";
}

export interface CanvasStateV3 {
  schema_version: 3 | 2;
  root_node_id: string | null;
  raw_intent?: RawIntent | null;
  nodes: Record<string, unknown>;
  edges: unknown[];
  selected_path: string[];
  branch_choices: Record<string, string>;
  core_contradiction: CoreContradiction | null;
  novelty_scores: NoveltyScores | null;
  idea_variants?: IdeaVariant[];
  session_metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  committed_at?: string | null;
  committed_concept_ref?: string | null;
}

// --- v1.7 Creative Canvas types ---

export interface CanvasNode {
  id: string;
  depth: number;
  parent_id: string | null;
  content: string;
  novelty_score: number;
  trope_tags: string[];
  saturation_warning: string | null;
  children_ids: string[];
  is_expanded: boolean;
  branch_status: BranchStatus;
  mutation_context?: {
    operation: string;
    source_trope_id: string;
    core_premise: string;
    core_conflict: string;
    novelty_hook: string;
    self_consistency_check: string;
  } | null;
}

export interface CanvasEdge {
  from: string;
  to: string;
}

export interface CanvasStateData {
  schema_version?: number;
  root_node_id: string | null;
  nodes: Record<string, CanvasNode>;
  edges: CanvasEdge[];
  selected_path: string[];
  branch_choices?: Record<string, string>;
  created_at?: string;
  updated_at?: string;
  committed_at?: string;
  committed_concept_ref?: string;
}

export interface CanvasNodeDict {
  [nodeId: string]: CanvasNode;
}

export interface NoveltyScoreDetail {
  total: number;
  market_saturation_score: number;
  trope_similarity_score: number;
  contradiction_depth_score: number;
  discussion_potential_score: number;
  grade: string;
}

export interface CanvasExpandResponse {
  nodes: CanvasNodeDict;
  scores: Record<string, NoveltyScoreDetail>;
  suggestion: string;
}

export interface CanvasInitRequest {
  premise: string;
}

export interface CanvasSelectResponse {
  selected_path: string[];
  evaluation: string;
}

// --- v2.0 Creative Canvas types ---

/** TODO: tighten once backend serializes a stable contract — keep loose
 *  shape for now to avoid coupling client to in-flight Pydantic changes. */
export type CurrentConcept = Record<string, unknown>;

export type StepState = "locked" | "available" | "active" | "completed" | "stale";

export interface CreativeOption {
  id: string;
  title: string;
  premise: string;
  logic: string;
  scores: Record<string, number>;
}

export interface CreativeStep {
  step: number;
  operation: string | null;
  operation_reason: string | null;
  options: CreativeOption[];
  selected_option_id: string | null;
  created_at: string;
  selected_at: string | null;
  regenerated_count: number;
  state: StepState;
}

export interface NextStepResponse {
  step: number;
  operation: { type: string; name: string; reason: string };
  options: CreativeOption[];
  quality_warning: string | null;
}

/** v4 canvas state — full payload returned by GET /session/state.
 *  Schema_version is locked to 4 by backend._migrate_v3_to_v4. */
export interface CanvasV4State {
  schema_version: 4;
  session_id: string;
  _etag: string;
  root_idea: {
    prompt: string;
    genre: string;
    premise: string;
    extracted: Record<string, unknown>;
  };
  raw_intent: RawIntent;
  creative_session: {
    current_step: number;
    max_steps: 5;
    status: string;
  };
  creative_path: CreativeStep[];
  current_concept: CurrentConcept;
  final_concept: unknown;
  committed: boolean;
  committed_at: string | null;
  scores: Record<string, number>;
  session_metadata: Record<string, unknown>;
}

export interface CanvasV2CommitResponse {
  error: boolean;
  code: string;
  message: string;
  detail: {
    concept: Record<string, unknown>;
    story_dna: Record<string, unknown>;
    source: string;
    committed_at: string;
    concept_preview: Record<string, unknown>;
    story_dna_preview: Record<string, unknown>;
    novelty_summary: Record<string, unknown>;
    next_step_url: string;
    warnings: string[];
  };
}

// --- v1.7 Branch Simulation types ---

export interface LLMInferenceItem {
  content: string;
  confidence: "high" | "medium" | "low";
}

export interface BranchSimulationReport {
  branch_point_description: string;
  affected_chapter_range: [number, number];
  affected_characters: string[];
  affected_foreshadowings: string[];
  growth_curve_shifts: Record<string, number>;
  reader_metrics_projection: Record<string, string>;
  tension_curve_projection: LLMInferenceItem | null;
  foreshadowing_risk_assessment: LLMInferenceItem | null;
  alternative_suggestions: LLMInferenceItem | null;
  created_at: string;
  tokens_used_total: number;
}

export interface SimulationRequest {
  description: string;
}

export interface SimulationHistoryItem {
  id: string;
  description: string;
  created_at: string;
}

// --- Stage4 v1.7 additions ---

export interface ExemptionRequest {
  id: string;
  scene_id: string;
  rule_to_break: { layer: string; rule_id: string; rule_description: string; constraint_type: string };
  creative_intent: string;
  expected_effect: string;
  status: "pending" | "approved" | "rejected";
  requested_by: string;
  requested_at: string;
  approved_by: string | null;
  rejected_reason: string | null;
  outcome: string | null;
}

export interface ExemptionAntipattern {
  rule_id: string;
  creative_intent_pattern: string;
  count: number;
  representative_case: string;
}

export interface PrecheckSuggestion {
  event_type: string;
  location_hint: string;
  suggested_tag: string;
  reason: string;
}

export interface PrecheckResult {
  precheck_passed: boolean;
  suggestions: PrecheckSuggestion[];
  tokens_used: number;
  skipped_reason?: string;
}

export interface SFLogSuggestion {
  type: "missing" | "modified";
  severity: "warning" | "suggestion";
  event_type: string;
  suggested_tag: string;
  location_hint: string;
  reason: string;
}

export interface SFLogDiffReport {
  original_text: string;
  modified_text: string;
  deleted_logs: Array<{ raw_text: string; type: string; id: string }>;
  suggestions: SFLogSuggestion[];
  tokens_used: number;
}

// --- Style Sandbox types ---

export interface SandboxSentenceParams {
  avg_length_range: [number, number];
  short_sentence_ratio: number;
  paragraph_length_range: [number, number];
}
export interface SandboxDialogueParams {
  ratio: number;
  max_consecutive_lines: number;
}
export interface SandboxRhythmParams {
  pacing_bpm: number;
  scene_change_frequency: number;
}
export interface SandboxDensityParams {
  description_ratio: number;
  action_ratio: number;
}
export interface SandboxSatisfactionParams {
  satisfaction_beat_count: number;
  suspense_hook_required: boolean;
}
export interface SandboxParams {
  sentence: SandboxSentenceParams;
  dialogue: SandboxDialogueParams;
  rhythm: SandboxRhythmParams;
  density: SandboxDensityParams;
  satisfaction: SandboxSatisfactionParams;
}
export interface PreviewResponse {
  rendered_text: string;
  source_avg_length: number;
  rendered_avg_length: number;
  tokens_used: number;
  skipped_reason?: string;
}
export interface SavedStyleConfig {
  name: string;
  path: string;
  params: SandboxParams;
  created_at: string;
}

export const DEFAULT_SANDBOX_PARAMS: SandboxParams = {
  sentence: { avg_length_range: [15, 45], short_sentence_ratio: 0.3, paragraph_length_range: [80, 200] },
  dialogue: { ratio: 0.35, max_consecutive_lines: 6 },
  rhythm: { pacing_bpm: 300, scene_change_frequency: 0.5 },
  density: { description_ratio: 0.4, action_ratio: 0.3 },
  satisfaction: { satisfaction_beat_count: 5, suspense_hook_required: true },
};

// --- API functions ---

export const api = {
  listProjects: () =>
    request<ProjectSummary[]>("GET", "/project/list"),

  listGenres: (uiVisibleOnly = true): Promise<Genre[]> => {
    const qs = uiVisibleOnly ? "?ui_visible_only=true" : "";
    return request<Genre[]>("GET", `/v1/genres${qs}`);
  },

  deleteProject: (projectId: string) =>
    request<{ project_id: string }>("DELETE", `/project/${encodeURIComponent(projectId)}`),

  bulkDeleteProjects: (projectIds: string[]) =>
    request<BulkDeleteResult>(
      "POST",
      "/project/bulk-delete",
      { project_ids: projectIds },
    ),

  getProjectStats: () =>
    request<ProjectStats>("GET", "/project/stats"),

  createProject: (data: {
    title: string;
    genre: string;
    min_words: number;
    target_total_words: number;
    target_length_category: string;
  }) => request<Project>("POST", "/project/create", data),

  getProjectStatus: (id: string) =>
    request<ProjectStatus>("GET", `/project/${id}/status`),

  advance: (projectId: string, targetStage: string) =>
    request<AdvanceResponse>("POST", "/conductor/advance", { project_id: projectId, target_stage: targetStage }),

  resetPreview: (projectId: string) =>
    request<{
      draft_count: number;
      has_progress: boolean;
      has_checkpoint: boolean;
      has_chunks: boolean;
    }>("GET", `/project/${encodeURIComponent(projectId)}/reset-preview`),

  resetToInit: (projectId: string) =>
    request<{
      error: boolean;
      code: string;
      message: string;
      detail: { project_id: string };
    }>("POST", `/project/${encodeURIComponent(projectId)}/reset`),

  generateConcept: (projectId: string, userModifications: string = "") =>
    request<ConceptResponse>("POST", "/stage1/generate", { project_id: projectId, user_modifications: userModifications }),

  getConcept: (projectId: string) =>
    request<ConceptResponse>("GET", `/stage1/concept?project_id=${encodeURIComponent(projectId)}`),

  updateConcept: (projectId: string, concept: Concept, storyDna: StoryDNA) =>
    request<void>("PUT", "/stage1/concept", { project_id: projectId, concept, story_dna: storyDna }),

  listCreativeDivergenceVariants: (projectId: string) =>
    request<{
      variants: Array<{ id: string; label: string; title: string; description: string; tags: string[]; created_at: string }>;
      selected_id: string | null;
    }>("GET", `/projects/${encodeURIComponent(projectId)}/creative-divergence`),

  getCreativeDivergence: (projectId: string) =>
    request<{
      variants: Array<{ id: string; label: string; title: string; description: string; tags: string[]; created_at: string }>;
      selected_id: string | null;
      has_selection: boolean;
      selected_at: string | null;
    }>("GET", `/projects/${encodeURIComponent(projectId)}/creative-divergence`),

  generateCreativeDivergenceVariants: (
    projectId: string,
    req: { prompt: string; count?: number; params?: { tone?: string; genre_tags?: string[] } },
  ) =>
    request<{
      variants: Array<{ id: string; label: string; title: string; description: string; tags: string[]; created_at: string }>;
    }>("POST", `/projects/${encodeURIComponent(projectId)}/creative-divergence/generate`, req),

  selectCreativeDivergenceVariant: (projectId: string, variantId: string) =>
    request<{
      concept_payload: {
        title: string;
        genre: string;
        premise: string;
        tone: string;
        theme: string;
        source: string;
        source_variant_id: string;
      };
    }>("POST", `/projects/${encodeURIComponent(projectId)}/creative-divergence/select`, { variant_id: variantId }),

  getCreativeDivergencePrefill: (projectId: string) =>
    request<{ exists: boolean; has_selection: boolean }>(
      "GET",
      `/projects/${encodeURIComponent(projectId)}/creative-divergence/prefill-check`,
    ),

  generateWorld: (projectId: string, userModifications: string = "") =>
    request<World>("POST", "/stage2/generate-world", { project_id: projectId, user_modifications: userModifications }),

  getWorld: (projectId: string) =>
    request<World>("GET", `/stage2/world?project_id=${encodeURIComponent(projectId)}`),

  generateCharacter: (projectId: string, characterType?: string, userModifications: string = "") =>
    request<CharacterSet>("POST", "/stage2/generate-character", { project_id: projectId, character_type: characterType || "protagonist", user_modifications: userModifications }),

  getCharacter: (projectId: string, characterIndex?: number) =>
    request<CharacterSet>(
      "GET",
      `/stage2/character?project_id=${encodeURIComponent(projectId)}${characterIndex !== undefined ? `&character_index=${characterIndex}` : ""}`
    ),

  updateWorld: (projectId: string, world: World) =>
    request<void>("PUT", "/stage2/world", { project_id: projectId, world }),

  updateCharacter: (projectId: string, characterData: CharacterSet) =>
    request<void>("PUT", "/stage2/character", { project_id: projectId, characters: characterData.characters }),

  patchCharacter: (
    projectId: string,
    characterId: string,
    patch: Partial<Character>,
  ): Promise<Character> =>
    request<Character>(
      "PATCH",
      `/stage2/character/${encodeURIComponent(characterId)}?project_id=${encodeURIComponent(projectId)}`,
      patch,
    ),

  deleteCharacter: (
    projectId: string,
    characterId: string,
  ): Promise<{ deleted_id: string; cascaded_relation_removals: number }> =>
    request<{ deleted_id: string; cascaded_relation_removals: number }>(
      "DELETE",
      `/stage2/character/${encodeURIComponent(characterId)}?project_id=${encodeURIComponent(projectId)}`,
    ),

  regenerateCharacterExamples: (
    projectId: string,
    characterId: string,
    keepExisting: boolean = false,
    userModifications: string = "",
  ): Promise<Character> =>
    request<Character>(
      "POST",
      `/stage2/character/${encodeURIComponent(characterId)}/regenerate-examples?project_id=${encodeURIComponent(projectId)}`,
      { keep_existing: keepExisting, user_modifications: userModifications },
    ),

  regenerateConceptSection: (
    projectId: string,
    section: "concept" | "dna",
    userModifications: string = "",
  ): Promise<ConceptResponse> =>
    request<ConceptResponse>(
      "POST",
      `/stage1/regenerate-section?project_id=${encodeURIComponent(projectId)}`,
      { section, user_modifications: userModifications },
    ),

  regenerateWorldSection: (
    projectId: string,
    section: "era" | "power_system" | "core_rules" | "factions",
    userModifications: string = "",
  ): Promise<World> =>
    request<World>(
      "POST",
      `/stage2/regenerate-world-section?project_id=${encodeURIComponent(projectId)}`,
      { section, user_modifications: userModifications },
    ),

  regeneratePowerSystemItem: (
    projectId: string,
    systemIndex: number,
    userModifications: string = "",
  ): Promise<{ system_index: number; power_system: PowerSystem; world: World }> =>
    request<{ system_index: number; power_system: PowerSystem; world: World }>(
      "POST",
      `/stage2/regenerate-power-system-item?project_id=${encodeURIComponent(projectId)}`,
      { system_index: systemIndex, user_modifications: userModifications },
    ),

  regenerateCharacterSection: (
    projectId: string,
    characterId: string,
    section: "personality" | "voice_signature" | "current_state" | "unknown" | "relations",
    opts: { keepExisting?: boolean; userModifications?: string } = {},
  ): Promise<Character> =>
    request<Character>(
      "POST",
      `/stage2/regenerate-character-section?project_id=${encodeURIComponent(projectId)}&character_id=${encodeURIComponent(characterId)}`,
      {
        section,
        keep_existing: opts.keepExisting ?? false,
        user_modifications: opts.userModifications ?? "",
      },
    ),

  regenerateNovelOutlineSection: (
    projectId: string,
    section: "core_conflict" | "volumes" | "mc_growth" | "key_plot",
    userModifications: string = "",
  ): Promise<NovelOutline> =>
    request<NovelOutline>(
      "POST",
      `/stage3/regenerate-novel-outline-section?project_id=${encodeURIComponent(projectId)}`,
      { section, user_modifications: userModifications },
    ),

  regenerateChapterOutlineRange: (
    projectId: string,
    chapterStart: number,
    chapterEnd: number,
    userModifications: string = "",
  ): Promise<{ chapters: unknown[] }> =>
    request<{ chapters: unknown[] }>(
      "POST",
      `/stage3/regenerate-chapter-outline?project_id=${encodeURIComponent(projectId)}`,
      {
        chapter_start: chapterStart,
        chapter_end: chapterEnd,
        user_modifications: userModifications,
      },
    ),

  growthWorkshopCheck: (projectId: string, characterId: string) =>
    request<WorkshopCheckResult>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/characters/${encodeURIComponent(characterId)}/growth/workshop/check`,
    ),

  growthWorkshopAdjust: (projectId: string, characterId: string, req: WorkshopAdjustRequest) =>
    request<{ stages: GrowthStage[]; warnings: ConsistencyWarning[] }>(
      "PUT",
      `/v1/projects/${encodeURIComponent(projectId)}/characters/${encodeURIComponent(characterId)}/growth/workshop/adjust`,
      req,
    ),

  growthWorkshopDiscuss: (projectId: string, characterId: string, req: WorkshopDiscussRequest) =>
    request<WorkshopDiscussResponse>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/characters/${encodeURIComponent(characterId)}/growth/workshop/discuss`,
      req,
    ),

  styleSandboxPreview: (
    projectId: string,
    req: { source_text: string; params: SandboxParams; genre?: string }
  ) =>
    request<PreviewResponse>(
      "POST",
      `/v1/projects/${projectId}/style/sandbox/preview`,
      req,
    ),
  styleSandboxSave: (projectId: string, req: { name: string; params: SandboxParams }) =>
    request<{ name: string; path: string }>(
      "POST",
      `/v1/projects/${projectId}/style/sandbox/save`,
      req,
    ),
  styleSandboxListConfigs: (projectId: string) =>
    request<{ configs: SavedStyleConfig[] }>(
      "GET",
      `/v1/projects/${projectId}/style/sandbox/configs`,
    ),
  styleSandboxLoadConfig: (projectId: string, name: string) =>
    request<SavedStyleConfig>(
      "GET",
      `/v1/projects/${projectId}/style/sandbox/configs/${encodeURIComponent(name)}`,
    ),

  generateOutline: (projectId: string, chapterNumber?: number, userModifications: string = "") =>
    request<Outline>("POST", "/stage3/generate", { project_id: projectId, chapter_number: chapterNumber ?? 1, user_modifications: userModifications }),

  getOutline: (projectId: string) =>
    request<Outline>("GET", `/stage3/outline?project_id=${encodeURIComponent(projectId)}`),

  updateOutline: (projectId: string, outline: Outline) =>
    request<void>("PUT", "/stage3/outline", { project_id: projectId, outline }),

  getNovelOutline: (projectId: string) =>
    request<NovelOutline>("GET", `/stage3/novel-outline?project_id=${encodeURIComponent(projectId)}`),

  generateNovelOutline: (projectId: string, userModifications: string = "") =>
    request<NovelOutline>("POST", "/stage3/generate-novel-outline", { project_id: projectId, user_modifications: userModifications }),

  updateNovelOutline: (projectId: string, novelOutline: NovelOutline) =>
    request<NovelOutline>("PUT", "/stage3/novel-outline", { project_id: projectId, novel_outline: novelOutline }),

  getScenePlan: (projectId: string, sceneNum: number) =>
    request<ScenePlan>("GET", `/stage4/scene-plan/${sceneNum}?project_id=${projectId}`),

  writeScene: (data: {
    project_id: string;
    chapter_number: number;
    scene_number: number;
    custom_style_config?: SandboxParams | null;
    user_modifications?: string;
  }) =>
    request<WriteSceneResponse>("POST", "/stage4/write-scene", {
      ...data,
      custom_style_config: data.custom_style_config ?? null,
      user_modifications: data.user_modifications ?? "",
    }),

  factGuard: (data: {
    project_id: string;
    chapter_number: number;
    scene_number: number;
    draft_text: string;
  }) =>
    request<{
      all_passed: boolean;
      checks: Array<{ name: string; passed: boolean; detail: string }>;
      coherence_score: number;
    }>("POST", "/stage4/fact-guard", data),

  forcePass: (data: { project_id: string; scene_number: number }) =>
    request<void>("POST", "/stage4/force-pass", data),

  skipScene: (data: { project_id: string; scene_number: number }) =>
    request<void>("POST", "/stage4/skip-scene", data),

  getStage4Progress: (projectId: string) =>
    request<ProgressFile>("GET", `/stage4/progress?project_id=${projectId}`),

  getSceneDraft: (projectId: string, chapterNumber: number, sceneNumber: number) =>
    request<{
      draft_text: string; chapter_number: number; scene_number: number;
      parsed_logs: ParsedLog[]; fact_guard_results: { all_passed: boolean; checks: CheckResult[] } | null;
      coherence_score: number;
    }>(
      "GET", `/stage4/scene-draft?project_id=${projectId}&chapter_number=${chapterNumber}&scene_number=${sceneNumber}`
    ),

  getSceneDrafts: (projectId: string, chapterNumber: number) =>
    request<{
      chapter_number: number;
      scenes: Array<{ scene_number: number; has_draft: boolean }>;
    }>(
      "GET",
      `/stage4/scene-drafts?project_id=${projectId}&chapter_number=${chapterNumber}`,
    ),

  updateSceneDraft: (data: { project_id: string; chapter_number: number; scene_number: number; draft_text: string }) =>
    request<{ chapter_number: number; scene_number: number }>(
      "PUT", "/stage4/scene-draft", data
    ),

  advanceChapter: (projectId: string) =>
    request<{ status: string; from_chapter: number; to_chapter: number; reader_os_snapshot: Record<string, unknown>; l2_summary: Record<string, unknown> }>(
      "POST", "/stage4/advance-chapter", { project_id: projectId }
    ),

  repairProgress: (projectId: string) =>
    request<{ repaired_chapters: number[]; current_chapter: number }>(
      "POST", "/stage4/repair-progress", { project_id: projectId }
    ),

  getRegistry: (projectId: string, registryType: string) =>
    request<RegistryResponse>("GET", `/storyos/${registryType}?project_id=${projectId}`),

  // STAGE 5 — Diagnosis
  runDiagnosis: (projectId: string) =>
    request<DiagnosisReport>("POST", "/stage5/diagnose", { project_id: projectId }),

  getDiagnosis: (projectId: string) =>
    request<DiagnosisReport>("GET", `/stage5/diagnosis?project_id=${projectId}`),

  resolveIssue: (projectId: string, issueId: string, action: "resolve" | "skip") =>
    request<{ issue_id: string; status: string }>("POST", `/stage5/resolve/${issueId}`, { project_id: projectId, action }),

  // STAGE 6 — Export
  exportNovel: (projectId: string, options: { strip_sf_logs?: boolean; add_toc?: boolean; include_title_page?: boolean }) =>
    request<{ preview: string; total_chars: number; file_path: string }>("POST", "/stage6/export", { project_id: projectId, options }),

  // Style Extractor
  extractStyle: (projectId: string, referenceText: string) =>
    request<Record<string, unknown>>("POST", "/style/extract", { project_id: projectId, reference_text: referenceText }),

  // v1.6 Settings
  getThresholds: (projectId: string) =>
    request<GenreThresholds>("GET", `/settings/thresholds?project_id=${encodeURIComponent(projectId)}`),

  updateThresholds: (projectId: string, overrides: Record<string, any>) =>
    request<{ status: string }>("PUT", "/settings/thresholds", { project_id: projectId, overrides }),

  getModelConfig: () =>
    request<ModelConfig>("GET", "/settings/model-config"),

  reloadConfig: () =>
    request<{ status: string }>("POST", "/settings/reload-config"),

  // v1.6 Chapter Review
  listChapterReviews: (projectId: string) =>
    request<ChapterReviewList>("GET", `/stage4/chapter-reviews?project_id=${encodeURIComponent(projectId)}`),

  getChapterReview: (projectId: string, chapter: number) =>
    request<ChapterReviewData>("GET", `/stage4/chapter-review?project_id=${encodeURIComponent(projectId)}&chapter=${chapter}`),

  setChapterDecision: (projectId: string, chapterNumber: number, decision: "approved" | "revise", feedback?: string) =>
    request<{ status: string }>("POST", "/stage4/chapter-review/decide", {
      project_id: projectId, chapter_number: chapterNumber, decision, feedback: feedback || "",
    }),

  // v1.6 Impact Analysis / Rollback
  analyzeImpact: (projectId: string, modifiedFiles?: string[]) =>
    request<ImpactReport>("POST", "/conductor/analyze-impact", {
      project_id: projectId, modified_files: modifiedFiles,
    }),

  executeRollback: (projectId: string, action: "confirm" | "cancel") =>
    request<RollbackResult>("POST", "/conductor/execute-rollback", {
      project_id: projectId, action,
    }),

  // --- v1.7 Creative Canvas ---
  getCanvasState: (projectId: string) =>
    request<CanvasStateData>("GET", `/v1/projects/${encodeURIComponent(projectId)}/creative/canvas/state`),

  initCanvas: (projectId: string, premise: string) =>
    request<CanvasStateData>("POST", `/v1/projects/${encodeURIComponent(projectId)}/creative/canvas/init`, { premise }),

  expandNode: (projectId: string, nodeId: string) =>
    request<CanvasExpandResponse>("POST", `/v1/projects/${encodeURIComponent(projectId)}/creative/canvas/expand`, { node_id: nodeId }),

  evaluateNode: (projectId: string, nodeId: string) =>
    request<NoveltyScoreDetail>("POST", `/v1/projects/${encodeURIComponent(projectId)}/creative/canvas/evaluate`, { node_id: nodeId }),

  selectPath: (projectId: string, pathNodeIds: string[]) =>
    request<CanvasSelectResponse>("POST", `/v1/projects/${encodeURIComponent(projectId)}/creative/canvas/select`, { path_node_ids: pathNodeIds }),

  resetCanvas: (projectId: string) =>
    request<{
      root_node_id: string | null;
      nodes: Record<string, never>;
      edges: never[];
      selected_path: never[];
    }>("DELETE", `/v1/projects/${encodeURIComponent(projectId)}/creative/canvas/state`),

  getMutationSuggestion: (projectId: string, nodeId: string) =>
    request<{ recommendation: string }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/canvas/mutate`,
      { node_id: nodeId }
    ),

  applyMutation: (projectId: string, nodeId: string, operation: string) =>
    request<{
      new_node: CanvasNode;
      mutation_result: {
        operation: string;
        source_trope_id: string;
        core_premise: string;
        core_conflict: string;
        novelty_hook: string;
        self_consistency_check: string;
        tokens_used: number;
      };
      dimmed_count: number;
    }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/canvas/apply-mutation`,
      { node_id: nodeId, operation }
    ),

  chooseBranch: (projectId: string, parentNodeId: string, chosenChildId: string) =>
    request<{
      selected_path: string[];
      branch_choices: Record<string, string>;
      chosen_node: CanvasNode;
      dimmed_count: number;
    }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/canvas/choose-branch`,
      { parent_node_id: parentNodeId, chosen_child_id: chosenChildId }
    ),

  commitCanvas: (projectId: string) =>
    request<ConceptResponse & { committed_at: string }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/canvas/commit`,
      {}
    ),

  // --- v1.2 Creative Divergence ---
  postDivergeInit: (projectId: string, rawIntent: RawIntent) =>
    request<CanvasStateV3>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/init`,
      rawIntent,
    ),

  postDivergeMutate: (
    projectId: string,
    body: { node_id: string; operation: string },
  ) =>
    request<{
      new_node: Record<string, unknown>;
      mutation_result: Record<string, unknown>;
      dimmed_count: number;
    }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/apply-mutation`,
      body,
    ),

  postDivergeMutateRegenerate: (projectId: string, nodeId: string, ifMatch?: string) =>
    request<{ variant: IdeaVariant }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/mutate/${encodeURIComponent(nodeId)}/regenerate`,
      undefined,
      ifMatch ? { "If-Match": ifMatch } : undefined,
    ),

  postDivergeContradict: (
    projectId: string,
    body: { variant_id: string; variant_content: string },
    options?: { signal?: AbortSignal },
  ) =>
    request<{ candidates: ContradictionCandidate[] }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/contradict`,
      body,
      undefined,
      options?.signal,
    ),

  putDivergeContradict: (
    projectId: string,
    body: ConfirmContradictRequest,
    ifMatch?: string,
  ) =>
    request<{ core_contradiction: CoreContradiction }>(
      "PUT",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/contradict`,
      body,
      ifMatch ? { "If-Match": ifMatch } : undefined,
    ),

  postDivergeWhatIfExpand: (projectId: string, nodeId: string) =>
    request<{
      nodes: Record<string, unknown>;
      scores: Record<string, unknown>;
      suggestion: string;
    }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/expand`,
      { node_id: nodeId },
    ),

  putDivergeWhatIfSelect: (
    projectId: string,
    pathNodeIds: string[],
    ifMatch?: string,
  ) =>
    request<{
      selected_path: string[];
      evaluation: string;
      evaluated_at: string;
    }>(
      "PUT",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/select`,
      { path_node_ids: pathNodeIds },
      ifMatch ? { "If-Match": ifMatch } : undefined,
    ),

  // S0D: switch the active branch under a parent to a previously-dimmed
  // sibling. Backend lives at /api/v1/projects/{pid}/creative/diverge/
  // choose-branch. The unrelated api.chooseBranch (creative/canvas/) is a
  // pre-existing method with a stale URL — not touching it here because
  // CreativeCanvasPage depends on it.
  postDivergeChooseBranch: (
    projectId: string,
    parentNodeId: string,
    chosenChildId: string,
  ) =>
    request<{
      selected_path: string[];
      branch_choices: Record<string, string>;
      chosen_node: WhatIfNode;
      dimmed_count: number;
    }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/choose-branch`,
      { parent_node_id: parentNodeId, chosen_child_id: chosenChildId },
    ),

  getDivergeNovelty: (projectId: string) =>
    request<NoveltyScores>(
      "GET",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/novelty`,
    ),

  postDivergeCommit: (projectId: string, body: CommitRequest = {}) =>
    request<CommitResponse>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/commit`,
      body,
    ),

  getDivergeState: (projectId: string) =>
    request<CanvasStateV3>(
      "GET",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/state`,
    ),

  deleteDivergeState: (projectId: string) =>
    request<{ root_node_id: string | null; nodes: Record<string, never>; edges: never[]; selected_path: never[] }>(
      "DELETE",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/state`,
    ),

  postDivergeFuse: (projectId: string, body: FuseRequest) =>
    request<FuseResponse>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/fuse`,
      body,
    ),

  // --- /diverge/regenerate/* — per-stage regen from the frontend modal ---
  postDivergeRegenerateRawIntent: (
    projectId: string,
    body: { user_modifications?: string },
  ) =>
    request<{ variants: IdeaVariant[]; user_modifications_received: boolean }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/regenerate/raw-intent`,
      body,
    ),

  postDivergeRegenerateVariants: (
    projectId: string,
    body: { user_modifications?: string },
  ) =>
    request<{ variants: IdeaVariant[]; user_modifications_received: boolean }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/regenerate/variants`,
      body,
    ),

  postDivergeRegenerateContradiction: (
    projectId: string,
    body: { user_modifications?: string },
  ) =>
    request<{ ok: boolean; user_modifications_received: boolean }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/regenerate/contradiction`,
      body,
    ),

  postDivergeRegenerateWhatif: (
    projectId: string,
    body: { user_modifications?: string },
  ) =>
    request<{
      nodes: Record<string, unknown>;
      user_modifications_received: boolean;
    }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/regenerate/whatif`,
      body,
    ),

  postDivergeRegenerateNovelty: (
    projectId: string,
    body: { user_modifications?: string },
  ) =>
    request<NoveltyScores & { regenerated: boolean; user_modifications_received: boolean }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/regenerate/novelty`,
      body,
    ),

  // --- v2.0 Creative Canvas (session/*) ---
  // Router prefix: /creative/canvas/{project_id}/session/*. v1.x canvas
  // methods (above) live under /v1/projects/{pid}/creative/canvas/* — these
  // are the v2 replacement namespace. See backend/api/v2_canvas.py.

  postCanvasV2Init: (
    projectId: string,
    rawIntent: RawIntent,
  ): Promise<{ ok: boolean; session_id: string; etag: string }> =>
    request(
      "POST",
      `/creative/canvas/${encodeURIComponent(projectId)}/session/init`,
      rawIntent,
    ),

  getCanvasV2State: (projectId: string): Promise<CanvasV4State> =>
    request(
      "GET",
      `/creative/canvas/${encodeURIComponent(projectId)}/session/state`,
    ),

  postCanvasV2NextStep: (
    projectId: string,
    body: { current_step: number },
  ): Promise<NextStepResponse> =>
    request(
      "POST",
      `/creative/canvas/${encodeURIComponent(projectId)}/session/next-step`,
      body,
    ),

  postCanvasV2Select: (
    projectId: string,
    body: { step: number; option_id: string },
  ): Promise<{ ok: boolean; step: number; selected_option_id: string }> =>
    request(
      "POST",
      `/creative/canvas/${encodeURIComponent(projectId)}/session/select`,
      body,
    ),

  postCanvasV2Commit: (projectId: string): Promise<CanvasV2CommitResponse> =>
    request(
      "POST",
      `/creative/canvas/${encodeURIComponent(projectId)}/session/commit`,
    ),

  // --- v1.7 Branch Simulation ---
  runSimulation: (projectId: string, description: string) =>
    request<BranchSimulationReport>("POST", `/v1/projects/${encodeURIComponent(projectId)}/branches/simulate`, { description }),

  getSimulationHistory: (projectId: string) =>
    request<SimulationHistoryItem[]>("GET", `/v1/projects/${encodeURIComponent(projectId)}/branches/history`),

  // --- Stage4 exemptions + sf-log + precheck ---
  listExemptions: (projectId: string, status: "pending" | "approved" | "rejected" = "pending") =>
    request<ExemptionRequest[]>("GET", `/v1/projects/${projectId}/exemptions?status=${status}`),

  approveExemption: (projectId: string, id: string, approvedBy: string = "user_default") =>
    request<{ id: string; status: string }>("PUT", `/v1/projects/${projectId}/exemptions/${id}/approve?approved_by=${encodeURIComponent(approvedBy)}`),

  rejectExemption: (projectId: string, id: string, reason: string) =>
    request<{ id: string; status: string }>("PUT", `/v1/projects/${projectId}/exemptions/${id}/reject?reason=${encodeURIComponent(reason)}`),

  getExemptionAntipatterns: (projectId: string, id: string) =>
    request<ExemptionAntipattern[]>("GET", `/v1/projects/${projectId}/exemptions/${id}/antipatterns`),

  suggestSFLogChanges: (projectId: string, sceneId: string, original: string, modified: string) =>
    request<SFLogDiffReport>("POST", `/v1/projects/${projectId}/scenes/${sceneId}/sf-log-suggestions`,
      { original_text: original, modified_text: modified }),

  applySFLogSuggestions: (projectId: string, sceneId: string, text: string, suggestions: SFLogSuggestion[]) =>
    request<{ updated_text: string }>("PUT", `/v1/projects/${projectId}/scenes/${sceneId}/sf-logs`,
      { text, suggestions }),

  // --- v1.9 AutopilotSession (Stage 1 backend + Stage 2 SSE) ---
  getAutopilotSession: (projectId: string) =>
    request<unknown>("GET", `/v1/projects/${encodeURIComponent(projectId)}/autopilot/session`),

  startAutopilotSession: (projectId: string, config: Record<string, unknown>) =>
    request<unknown>("POST", `/v1/projects/${encodeURIComponent(projectId)}/autopilot/session/start`, config),

  stopAutopilotSession: (projectId: string) =>
    request<unknown>("POST", `/v1/projects/${encodeURIComponent(projectId)}/autopilot/session/stop`),

  pauseAutopilotSession: (projectId: string) =>
    request<unknown>("POST", `/v1/projects/${encodeURIComponent(projectId)}/autopilot/session/pause`),

  resumeAutopilotSession: (projectId: string) =>
    request<unknown>("POST", `/v1/projects/${encodeURIComponent(projectId)}/autopilot/session/resume`),

  interveneAutopilotSession: (projectId: string, action: string) =>
    request<unknown>("POST", `/v1/projects/${encodeURIComponent(projectId)}/autopilot/session/intervene`, { action }),

  getAutopilotHistory: (projectId: string, cursor?: string) =>
    request<unknown>(
      "GET",
      `/v1/projects/${encodeURIComponent(projectId)}/autopilot/session/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`
    ),

  rangePreview: (projectId: string, start: number, end: number, scope?: "all_planned" | "range") =>
    request<unknown>(
      "GET",
      `/v1/projects/${encodeURIComponent(projectId)}/autopilot/managed/range-preview?start=${start}&end=${end}${scope ? `&scope=${scope}` : ""}`
    ),

  getLLMConfig: () =>
    request<ModelTiersConfig>("GET", "/settings/llm-config"),

  putLLMConfig: (cfg: ModelTiersConfig) =>
    request<LLMRouterSummary>("PUT", "/settings/llm-config", cfg),

  reloadLLMConfig: () =>
    request<LLMRouterSummary>("POST", "/settings/llm-config/reload"),

  getProviders: () =>
    request<ProviderStatus[]>("GET", "/settings/llm-providers"),

  upsertProvider: (id: string, provider: ProviderEntry) =>
    request<LLMRouterSummary>("POST", "/settings/llm-config/providers", { id, provider }),
  deleteProvider: (id: string) =>
    request<LLMRouterSummary>("DELETE", `/settings/llm-config/providers/${id}`),
  upsertModel: (providerId: string, modelId: string, model: ModelEntry) =>
    request<LLMRouterSummary>(
      "POST",
      `/settings/llm-config/providers/${providerId}/models`,
      { id: modelId, model },
    ),
  deleteModel: (providerId: string, modelId: string) =>
    request<LLMRouterSummary>(
      "DELETE",
      `/settings/llm-config/providers/${providerId}/models/${modelId}`,
    ),
  setProviderApiKey: (providerId: string, value: string) =>
    request<LLMRouterSummary>(
      "PUT",
      `/settings/llm-config/providers/${providerId}/api-key`,
      { value },
    ),
  probeProvider: (providerId: string) =>
    request<ProbeResult>(
      "POST",
      `/settings/llm-config/providers/${providerId}/probe`,
    ),
  migrateConfig: () =>
    request<{ backup_path?: string | null; added?: string[]; summary: object }>(
      "POST",
      "/settings/llm-config/migrate",
    ),

  getLLMUsage: (limit: number = 100) =>
    request<LLMUsageEntry[]>("GET", `/settings/llm-usage?limit=${limit}`),
};

export interface LLMUsageEntry {
  timestamp: string;
  agent: string;
  task: string;
  tier: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost: number;
}

export interface ModelEntry {
  id: string;
  display_name?: string;
  provider: string;
  cost_per_1k_input: number;
  cost_per_1k_output: number;
  max_tokens: number;
  temperature?: number;
  json_mode?: boolean;
  stream?: boolean;
}

export interface TierConfig {
  description: string;
  default: string;
  retry_on_failure?: boolean;
  max_retries?: number;
  fallback?: string | null;
}

export interface AgentTaskMapping {
  tier: string;
  model?: string;
  fallback?: string | null;
}

export interface ProvidersConfig {
  [providerId: string]: ProviderEntry;
}

export interface ProviderEntry {
  type: "anthropic" | "openai_compatible" | "mock";
  display_name: string;
  base_url: string;
  api_key_env: string;
  enabled: boolean;
  models: Record<string, ModelEntry>;
}

export interface ModelTiersConfig {
  providers?: ProvidersConfig;
  tiers: Record<string, TierConfig>;
  agent_mapping: Record<string, Record<string, AgentTaskMapping>>;
}

export interface LLMRouterSummary {
  tiers: number;
  agents: number;
}

export interface ProviderStatus {
  provider: string;
  type: ProviderEntry["type"];
  display_name: string;
  base_url: string;
  api_key_env: string;
  api_key_configured: boolean;
  enabled: boolean;
  models: ModelEntry[];
}

export type ProbeErrorCode = "auth_error" | "unreachable" | "provider_error";

export interface ProbeModel {
  id: string;
  display_name: string;
}

export interface ProbeResult {
  success: boolean;
  latency_ms: number;
  models: ProbeModel[] | null;
  error?: string;
  error_code?: ProbeErrorCode;
}

export { ApiError };
export default api;
