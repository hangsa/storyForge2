import { useState } from "react";

interface Props {
  temperature: number;
  maxTokens: number;
  outputFormatJson: string;
  onTemperatureChange: (v: number) => void;
  onMaxTokensChange: (v: number) => void;
  onOutputFormatChange: (v: string) => void;
}

export default function AdvancedSection({
  temperature, maxTokens, outputFormatJson,
  onTemperatureChange, onMaxTokensChange, onOutputFormatChange,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-outline-variant">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="advanced-toggle"
        className="w-full px-3 py-2 flex items-center justify-between text-sm text-on-surface-variant hover:text-primary"
      >
        <span>高级</span>
        <span className="material-symbols-outlined text-base">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3" data-testid="advanced-body">
          <div>
            <label className="block text-xs font-mono text-on-surface-variant mb-1">
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
            <label className="block text-xs font-mono text-on-surface-variant mb-1">max_tokens</label>
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
            <label className="block text-xs font-mono text-on-surface-variant mb-1">output_format (JSON)</label>
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