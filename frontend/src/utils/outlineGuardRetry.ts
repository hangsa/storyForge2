import { ApiError } from "../api/client";

export interface ForbiddenTermViolation {
  path: string;
  term: string;
  snippet: string;
}

/** Build the auto-feedback string prepended to user_modifications on retry. */
export function buildViolationFeedback(violations: ForbiddenTermViolation[]): string {
  const summary = violations
    .slice(0, 5)
    .map((v) => `'${v.term}' @ ${v.path}`)
    .join("；");
  const more = violations.length > 5 ? `（共 ${violations.length} 处）` : "";
  return (
    `【自动反馈——上次输出违反境界词汇白名单】\n` +
    `检测到以下未在世界观 power_systems[*].stages 中声明的境界术语：${summary}${more}。\n` +
    `请严格使用 world.json power_systems[*].stages 中已声明的阶段名替换；` +
    `若需表达非白名单概念，使用本项目自定义描述（如"古修第五境"），` +
    `**禁止**套用网文通用术语（"元婴"/"金丹"/"筑基"/"化神"/"结丹"/"渡劫"/"大乘"/"练气"等）。`
  );
}

/** Pull the violation list out of a 422 ApiError, or null if it's not one. */
export function extractViolations(err: unknown): ForbiddenTermViolation[] | null {
  if (
    err instanceof ApiError &&
    err.code === "FORBIDDEN_TERM_DETECTED" &&
    Array.isArray(err.detail?.violations)
  ) {
    return err.detail.violations as ForbiddenTermViolation[];
  }
  return null;
}

export interface GuardRetryOptions {
  /** Maximum total attempts (including the first). Default 3. */
  maxAttempts?: number;
  /** Notifies the caller of the attempt number (1-based) right before each call. */
  onAttempt?: (attempt: number) => void;
}

/** Run `call(userModifications)` and auto-retry on FORBIDDEN_TERM_DETECTED 422.
 *
 *  On each violation, builds a feedback string from `violations` and appends it
 *  to the running user_modifications (preserving the user's original wording
 *  at the top), then re-runs `call`. The backend's guard sees the appended
 *  feedback in the prompt and is more likely to comply on the next attempt.
 *
 *  After `maxAttempts` the LAST ApiError is re-thrown — the wizard's error UI
 *  will surface the 422 message verbatim. We do NOT swallow the failure:
 *  unbreakable contamination must remain visible to the user.
 *
 *  Non-FORBIDDEN errors (network/timeout/500) propagate immediately — this
 *  helper only handles the term-guard case.
 */
export async function runWithGuardRetry<T>(
  call: (userModifications: string) => Promise<T>,
  initialModifications: string,
  options: GuardRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  let attempt = 1;
  let userModifications = initialModifications;
  let lastError: unknown;
  while (attempt <= maxAttempts) {
    options.onAttempt?.(attempt);
    try {
      return await call(userModifications);
    } catch (e) {
      lastError = e;
      const violations = extractViolations(e);
      if (!violations || attempt >= maxAttempts) {
        throw e;
      }
      const feedback = buildViolationFeedback(violations);
      userModifications = userModifications
        ? `${userModifications}\n\n${feedback}`
        : feedback;
      attempt += 1;
    }
  }
  throw lastError;
}
