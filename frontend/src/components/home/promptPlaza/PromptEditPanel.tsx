import { useEffect, useMemo, useRef, useState } from "react";
import type { PromptDetail } from "../../../api/promptPlaza";
import AdvancedSection from "./AdvancedSection";
import { useAutoHeight } from "../../../hooks/useAutoHeight";

interface Props {
  detail: PromptDetail | null;
  loading: boolean;
  error: string | null;
  onSave: (payload: {
    system_prompt?: string;
    user_prompt_template?: string;
    temperature?: number;
    max_tokens?: number;
    output_format?: Record<string, unknown>;
  }) => void;
  onReset: () => void;
  onClose: () => void;
}

function getEffectiveString(detail: PromptDetail, key: string, fallback = ""): string {
  const v = (detail.effective as Record<string, unknown>)[key];
  return typeof v === "string" ? v : fallback;
}

function getEffectiveNumber(detail: PromptDetail, key: string, fallback = 0): number {
  const v = (detail.effective as Record<string, unknown>)[key];
  return typeof v === "number" ? v : fallback;
}

export default function PromptEditPanel({ detail, loading, error, onSave, onReset, onClose }: Props) {
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userTemplate, setUserTemplate] = useState("");
  const [temperature, setTemperature] = useState(0.9);
  const [maxTokens, setMaxTokens] = useState(1000);
  const [outputFormatJson, setOutputFormatJson] = useState("{}");

  const systemRef = useRef<HTMLTextAreaElement>(null);
  const userRef = useRef<HTMLTextAreaElement>(null);
  useAutoHeight(systemRef, [systemPrompt]);
  useAutoHeight(userRef, [userTemplate]);

  // Reset draft when detail changes
  useEffect(() => {
    if (!detail) return;
    setSystemPrompt(getEffectiveString(detail, "system_prompt"));
    setUserTemplate(getEffectiveString(detail, "user_prompt_template"));
    setTemperature(getEffectiveNumber(detail, "temperature", 0.9));
    setMaxTokens(getEffectiveNumber(detail, "max_tokens", 1000));
    const of = (detail.effective as Record<string, unknown>).output_format;
    setOutputFormatJson(of ? JSON.stringify(of) : "{}");
  }, [detail]);

  const dirty = useMemo(() => {
    if (!detail) return false;
    const baseSystem = getEffectiveString(detail, "system_prompt");
    const baseUser = getEffectiveString(detail, "user_prompt_template");
    const baseTemp = getEffectiveNumber(detail, "temperature", 0.9);
    const baseMax = getEffectiveNumber(detail, "max_tokens", 1000);
    const baseOf = JSON.stringify((detail.effective as Record<string, unknown>).output_format ?? {});
    return (
      systemPrompt !== baseSystem ||
      userTemplate !== baseUser ||
      temperature !== baseTemp ||
      maxTokens !== baseMax ||
      outputFormatJson !== baseOf
    );
  }, [detail, systemPrompt, userTemplate, temperature, maxTokens, outputFormatJson]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-system-log text-sm">
        加载中…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-error text-sm" role="alert">
        {error}
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex-1 flex items-center justify-center text-system-log text-sm">
        请从左侧选择一个提示词
      </div>
    );
  }

  const handleSave = () => {
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = JSON.parse(outputFormatJson) as Record<string, unknown>;
    } catch {
      parsed = undefined;
    }
    onSave({
      system_prompt: systemPrompt,
      user_prompt_template: userTemplate,
      temperature,
      max_tokens: maxTokens,
      output_format: parsed,
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <header className="px-4 py-3 border-b border-outline-variant flex items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-primary text-lg">{detail.name}</h3>
          {detail.override && (
            <span className="text-xs font-label-mono text-primary-container">
              已自定义 {detail.override._modified_at as string}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="text-system-log hover:text-primary"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div>
          <label className="block text-xs font-label-mono text-system-log mb-1">
            System Prompt
          </label>
          <textarea
            ref={systemRef}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            data-testid="edit-system"
            className="w-full bg-surface-container border border-outline-variant rounded px-3 py-2 text-sm font-mono overflow-hidden"
            style={{ resize: "none" }}
          />
        </div>
        <div>
          <label className="block text-xs font-label-mono text-system-log mb-1">
            User Prompt Template
            <span className="ml-2 text-system-log/60">
              {userTemplate.length} 字
            </span>
          </label>
          <textarea
            ref={userRef}
            value={userTemplate}
            onChange={(e) => setUserTemplate(e.target.value)}
            data-testid="edit-user-template"
            className="w-full bg-surface-container border border-outline-variant rounded px-3 py-2 text-sm font-mono overflow-hidden"
            style={{ resize: "none" }}
          />
        </div>
        <AdvancedSection
          temperature={temperature}
          maxTokens={maxTokens}
          outputFormatJson={outputFormatJson}
          onTemperatureChange={setTemperature}
          onMaxTokensChange={setMaxTokens}
          onOutputFormatChange={setOutputFormatJson}
        />
      </div>

      <footer className="px-4 py-3 border-t border-outline-variant flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onReset}
          data-testid="reset-button"
          className="px-3 py-1.5 text-sm text-system-log hover:text-primary disabled:opacity-40"
        >
          重置为默认
        </button>
        <button
          type="button"
          onClick={handleSave}
          data-testid="save-button"
          disabled={!dirty}
          className="px-3 py-1.5 bg-primary-container text-sm rounded text-surface-container-lowest hover:opacity-90 disabled:opacity-40"
        >
          保存
        </button>
      </footer>
    </div>
  );
}
