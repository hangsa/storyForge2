import { useEffect } from "react";
import { useWizard, type WizardRegenerateState } from "./WizardContext";

export default function RegenerateStatusBadge({ state }: { state: WizardRegenerateState }) {
  const clear = useWizard().clearRegenerateState;
  useEffect(() => {
    if (state.kind === "idle") return;
    const ttl = state.kind === "busy" ? 30_000 : 3500;
    const t = setTimeout(clear, ttl);
    return () => clearTimeout(t);
  }, [state, clear]);

  if (state.kind === "idle") return null;

  if (state.kind === "busy") {
    return (
      <div data-testid="wizard-regenerate-status" data-status="busy" role="status" aria-live="polite"
           className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary-container/10 text-primary-container font-body text-body-md text-xs">
        <span data-testid="wizard-regenerate-status-spinner" aria-hidden="true"
              className="material-symbols-outlined text-[14px] animate-spin inline-block">
          progress_activity
        </span>
        正在重新生成 {state.target}…
      </div>
    );
  }

  if (state.kind === "success") {
    return (
      <div data-testid="wizard-regenerate-status" data-status="success" role="status" aria-live="polite"
           className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary-container/15 text-primary-container font-body text-body-md text-xs">
        <span aria-hidden="true" className="material-symbols-outlined text-[14px]">check</span>
        {state.target} 已重新生成
      </div>
    );
  }

  return (
    <div data-testid="wizard-regenerate-status" data-status="failure" role="status" aria-live="assertive"
         className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-error-container/30 text-error font-body text-body-md text-xs max-w-[40ch] truncate"
         title={`重新生成失败: ${state.message}`}>
      <span aria-hidden="true" className="material-symbols-outlined text-[14px]">error</span>
      重新生成失败: {state.message}
    </div>
  );
}