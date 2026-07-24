import React from "react";
import type { BehaviorExample } from "../../api/client";

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
        <h3 className="text-sm font-medium text-gray-700">行为示例</h3>
        <div className="flex items-center gap-2">
          {onRegenerate && (
            <button
              type="button"
              data-testid="behavior-example-regenerate"
              onClick={onRegenerate}
              disabled={regenerating}
              className="inline-flex items-center gap-2 rounded border border-indigo-300 bg-white px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {regenerating && (
                <span
                  data-testid="behavior-example-regenerate-spinner"
                  className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600"
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
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            添加示例
          </button>
        </div>
      </div>

      {examples.length === 0 && (
        <p className="text-sm text-gray-500">暂无行为示例，点击"添加示例"开始。</p>
      )}

      <div className="space-y-4">
        {examples.map((ex, idx) => (
          <div
            key={idx}
            data-testid={`behavior-example-${idx}`}
            className="rounded border border-gray-200 bg-gray-50 p-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">
                示例 #{idx + 1}
              </span>
              <button
                type="button"
                data-testid="behavior-example-delete"
                onClick={() => remove(idx)}
                className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
              >
                删除
              </button>
            </div>
            <div className="space-y-2">
              <label className="block text-xs text-gray-600">
                <span className="mb-1 block">情境</span>
                <textarea
                  value={ex.situation}
                  onChange={(e) => update(idx, "situation", e.target.value)}
                  rows={2}
                  data-testid={`behavior-example-${idx}-situation`}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm"
                />
              </label>
              <label className="block text-xs text-gray-600">
                <span className="mb-1 block">动作</span>
                <textarea
                  value={ex.action}
                  onChange={(e) => update(idx, "action", e.target.value)}
                  rows={2}
                  data-testid={`behavior-example-${idx}-action`}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm"
                />
              </label>
              <label className="block text-xs text-gray-600">
                <span className="mb-1 block">台词示例</span>
                <textarea
                  value={ex.speech_sample}
                  onChange={(e) => update(idx, "speech_sample", e.target.value)}
                  rows={2}
                  data-testid={`behavior-example-${idx}-speech_sample`}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm"
                />
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BehaviorExamplesSection;