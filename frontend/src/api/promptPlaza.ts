import { request, ApiError } from "./client";

// ----------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------

export interface PromptSummary {
  name: string;
  category: string;
  label: string;
  has_override: boolean;
  modified_at: string | null;
  builtin: boolean;
}

export interface PromptDetail {
  name: string;
  builtin_yaml: Record<string, unknown>;
  override: Record<string, unknown> | null;
  effective: Record<string, unknown>;
}

export interface PromptOverridePayload {
  system_prompt?: string;
  user_prompt_template?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  output_format?: Record<string, unknown>;
}

// ----------------------------------------------------------------------
// Endpoints
// ----------------------------------------------------------------------

/** GET /api/projects/{project_id}/prompts/list
 *
 * Backend returns top-level `{ error, prompts: [...] }` (no `detail` wrapper).
 * `request<T>` returns the JSON as-is (only unwraps when `detail` exists).
 */
export async function listPlazaPrompts(projectId: string): Promise<PromptSummary[]> {
  const data = await request<{ prompts: PromptSummary[] }>(
    "GET",
    `/projects/${encodeURIComponent(projectId)}/prompts/list`,
  );
  return data.prompts;
}

/** GET /api/projects/{project_id}/prompts/{name}
 *
 * Backend returns top-level `{ error, name, builtin_yaml, override, effective }`.
 */
export async function getPlazaPrompt(projectId: string, name: string): Promise<PromptDetail> {
  return request<PromptDetail>(
    "GET",
    `/projects/${encodeURIComponent(projectId)}/prompts/${encodeURIComponent(name)}`,
  );
}

/** PUT /api/projects/{project_id}/prompts/{name}
 *
 * Backend returns `{ error, detail: { name, override, modified_at }, message }`.
 * `request<T>` unwraps `.detail` -> returns `{ name, override, modified_at }`.
 */
export async function putPlazaPrompt(
  projectId: string,
  name: string,
  payload: PromptOverridePayload,
): Promise<{ name: string; override: Record<string, unknown> | null; modified_at: string | null }> {
  return request<{ name: string; override: Record<string, unknown> | null; modified_at: string | null }>(
    "PUT",
    `/projects/${encodeURIComponent(projectId)}/prompts/${encodeURIComponent(name)}`,
    payload,
  );
}

/** DELETE /api/projects/{project_id}/prompts/{name}
 *
 * Backend returns `{ error, detail: { name, status: "reset" } }`.
 * `request<T>` unwraps `.detail` -> returns `{ name, status }`.
 */
export async function deletePlazaPrompt(
  projectId: string,
  name: string,
): Promise<{ name: string; status: string }> {
  return request<{ name: string; status: string }>(
    "DELETE",
    `/projects/${encodeURIComponent(projectId)}/prompts/${encodeURIComponent(name)}`,
  );
}

// Re-export ApiError for convenience
export { ApiError };