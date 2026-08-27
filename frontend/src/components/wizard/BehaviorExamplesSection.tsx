import React from "react";
import type { BehaviorExample } from "../../api/client";
import { AutoTextarea } from "../shared/AutoTextarea";

interface BehaviorExamplesSectionProps {
  examples: BehaviorExample[];
  onChange: (next: BehaviorExample[]) => void;
  onRegenerate?: () => void;
  regenerating?: boolean;
}

const EMPTY_EXAMPLE: BehaviorExample = {
  situation: "",
  action: "",
  speech_sample: "",
};

const BehaviorExamplesSection: React.FC<BehaviorExamplesSectionProps> = ({
  examples,
  onChange,
  onRegenerate,
  regenerating = false,
}) => {
  const update = (idx: number, field: keyof BehaviorExample, value: string) => {
    const next = examples.map((ex, i) =>
      i === idx ? { ...ex, [field]: value } : ex,
    );
    onChange(next);
  };

  const add = () => {
    onChange([...examples, { ...EMPTY_EXAMPLE }]);
  };

  const remove = (idx: number) => {
    onChange(examples.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-4" data-testid="behavior-examples-section">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
          行为示例
        </h3>
        <div className="flex items-center gap-2">
          {onRegenerate && (
            <button
              type="button"
              data-testid="behavior-example-regenerate"
              onClick={onRegenerate}
              disabled={regenerating}
              className="inline-flex items-center gap-2 rounded border border-outline-variant bg-surface-container px-3 py-1.5 font-body text-body-md text-xs text-primary-container hover:border-primary-container/50 hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-60"
            >
              {regenerating && (
                <span
                  data-testid="behavior-example-regenerate-spinner"
                  className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary-container/30 border-t-primary-container"
                  aria-hidden="true"
                />
              )}
              {regenerating ? "重新生成中..." : "AI 重新生成"}
            </button>
          )}
          <button
            type="button"
            data-testid="behavior-example-add"
            onClick={add}
            className="rounded-full border border-dashed border-outline-variant px-3 py-1.5 font-body text-body-md text-xs text-primary-container/70 transition-colors hover:border-primary-container/50 hover:text-primary-container"
          >
            + 添加示例
          </button>
        </div>
      </div>

      {examples.length === 0 && (
        <p className="font-body text-body-md text-primary-container/60 text-xs">
          暂无行为示例，点击"添加示例"开始。
        </p>
      )}

      <div className="space-y-3">
        {examples.map((ex, idx) => (
          <div
            key={idx}
            data-testid={`behavior-example-${idx}`}
            className="rounded-lg border border-outline-variant bg-surface-container p-3 space-y-2"
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-primary-container/80 text-[10px]">
                示例 #{idx + 1}
              </span>
              <button
                type="button"
                data-testid="behavior-example-delete"
                onClick={() => remove(idx)}
                className="p-1 font-body text-body-md text-xs text-primary-container/70 hover:text-error"
                aria-label="删除示例"
              >
                删除
              </button>
            </div>
            <label className="block">
              <span className="mb-1 block font-mono text-primary-container/80 text-[10px]">
                情境
              </span>
              <AutoTextarea
                value={ex.situation}
                onChange={(e) => update(idx, "situation", e.target.value)}
                rows={2}
                data-testid={`behavior-example-${idx}-situation`}
                className="w-full rounded border border-outline-variant bg-surface-container-low px-2 py-1 text-xs text-primary focus:border-primary-container focus:outline-none resize-y"
              />
            </label>
            <label className="block">
              <span className="mb-1 block font-mono text-primary-container/80 text-[10px]">
                动作
              </span>
              <AutoTextarea
                value={ex.action}
                onChange={(e) => update(idx, "action", e.target.value)}
                rows={2}
                data-testid={`behavior-example-${idx}-action`}
                className="w-full rounded border border-outline-variant bg-surface-container-low px-2 py-1 text-xs text-primary focus:border-primary-container focus:outline-none resize-y"
              />
            </label>
            <label className="block">
              <span className="mb-1 block font-mono text-primary-container/80 text-[10px]">
                台词示例
              </span>
              <AutoTextarea
                value={ex.speech_sample}
                onChange={(e) => update(idx, "speech_sample", e.target.value)}
                rows={2}
                data-testid={`behavior-example-${idx}-speech_sample`}
                className="w-full rounded border border-outline-variant bg-surface-container-low px-2 py-1 text-xs text-primary focus:border-primary-container focus:outline-none resize-y"
              />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BehaviorExamplesSection;