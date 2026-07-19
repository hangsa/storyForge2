import { useState } from "react";

interface Props {
  model: string;
  temperature: number;
  maxTokens: number;
  outputFormatJson: string;
  onModelChange: (v: string) => void;
  onTemperatureChange: (v: number) => void;
  onMaxTokensChange: (v: number) => void;
  onOutputFormatChange: (v: string) => void;
}

export default function AdvancedSection({
  model, temperature, maxTokens, outputFormatJson,
  onModelChange, onTemperatureChange, onMaxTokensChange, onOutputFormatChange,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-outline-variant">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="advanced-toggle"
        className="w-full px-3 py-2 flex items-center justify-between text-sm text-system-log hover:text-primary"
      >
        <span>高级</span>
        <span className="material-symbols-outlined text-base">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3" data-testid="advanced-body">
          <div>
            <label className="block text-xs font-label-mono text-system-log mb-1">model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              data-testid="adv-model"
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-label-mono text-system-log mb-1">
              temperature: {temperature.toFixed(2)}
            </label>
            <input
              type="range"
              min="0" max="2" step="0.05"
              value={temperature}
              onChange={(e) => onTemperatureChange(parseFloat(e.target.value))}
              data-testid="adv-temperature"
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-xs font-label-mono text-system-log mb-1">max_tokens</label>
            <input
              type="number"
              min="1" max="32768"
              value={maxTokens}
              onChange={(e) => onMaxTokensChange(parseInt(e.target.value, 10) || 0)}
              data-testid="adv-max-tokens"
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-label-mono text-system-log mb-1">output_format (JSON)</label>
            <textarea
              value={outputFormatJson}
              onChange={(e) => onOutputFormatChange(e.target.value)}
              data-testid="adv-output-format"
              rows={3}
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs font-mono resize-y"
            />
          </div>
        </div>
      )}
    </div>
  );
}