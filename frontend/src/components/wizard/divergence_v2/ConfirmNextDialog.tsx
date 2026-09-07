import React from "react";
import type { SubStage } from "./types";

interface Props {
  open: boolean;
  targetStage: SubStage | null;
  affectedStages: SubStage[];
  onConfirm: () => void;
  onCancel: () => void;
}

const STAGE_LABELS: Record<SubStage, string> = {
  "1": "输入灵感",
  "2": "第一性拆解",
  "3": "自适应发散",
  "4": "提交",
};

export function ConfirmNextDialog({ open, targetStage, affectedStages, onConfirm, onCancel }: Props) {
  if (!open || targetStage === null) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" data-testid="confirm-next-dialog">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h2 className="text-lg font-semibold mb-3">重新进入 {STAGE_LABELS[targetStage]}</h2>
        <p className="text-sm text-gray-600 mb-4">
          当前 {STAGE_LABELS[targetStage]} 之后已有已生成的内容:
        </p>
        <ul className="text-sm text-gray-700 mb-4 list-disc list-inside">
          {affectedStages.map((s) => (
            <li key={s}>第 {s} 阶段:{STAGE_LABELS[s]}</li>
          ))}
        </ul>
        <p className="text-sm text-gray-600 mb-4">
          点击「确认」将清空这些阶段的已有内容,并重新执行当前阶段操作。
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="px-4 py-2 rounded bg-gray-100 hover:bg-gray-200"
            onClick={onCancel}
            data-testid="confirm-next-cancel"
          >
            取消
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
            onClick={onConfirm}
            data-testid="confirm-next-confirm"
          >
            确认清空并继续
          </button>
        </div>
      </div>
    </div>
  );
}
