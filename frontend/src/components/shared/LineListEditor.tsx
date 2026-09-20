import { useRef } from "react";
import { AutoTextarea } from "./AutoTextarea";

interface LineListEditorProps {
  items: string[];
  onItemsChange: (items: string[]) => void;
  saving: boolean;
}

/**
 * 2026-09-20: 与 TagEditor (chip 风) 并存的另一种数组编辑形态。
 *
 * 每条数据 = 独立一行, 全宽 textarea, 高度随内容自适应
 * (复用 AutoTextarea 的 useLayoutEffect 自动 resize); 行尾 × 删除;
 * 列表底部一个 + 添加一条 按钮, 点击在末尾追加空字符串。
 *
 * 与 TagEditor 选哪种:
 * - 短文本多条并列 (chip 风好看) → TagEditor (CharacterStep 人格层、Stage2Page)
 * - 长文本需要多行可扩展 (列表语义更清晰) → LineListEditor (WorldStep 4 处)
 *
 * 两者共享同一组 props (items / onItemsChange / saving), 调用方按需切换。
 */
export default function LineListEditor({ items, onItemsChange, saving }: LineListEditorProps) {
  const lastAddedRef = useRef<number>(-1);

  const handleEdit = (index: number, value: string) => {
    onItemsChange(items.map((it, i) => (i === index ? value : it)));
  };

  const handleRemove = (index: number) => {
    onItemsChange(items.filter((_, i) => i !== index));
  };

  const handleAdd = () => {
    const next = [...items, ""];
    lastAddedRef.current = next.length - 1;
    onItemsChange(next);
  };

  return (
    <div className="space-y-2" data-testid="linelist-root">
      {items.length === 0 && (
        <span className="text-xs text-system-log/40 font-body-ui">暂无</span>
      )}

      {items.map((item, index) => (
        <div
          key={`linelist-row-${index}`}
          className="flex items-start gap-2"
        >
          <AutoTextarea
            data-testid={`linelist-${index}-input`}
            minRows={1}
            value={item}
            disabled={saving}
            onChange={(e) => handleEdit(index, e.target.value)}
            className="flex-1 bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container resize-none"
            ref={lastAddedRef.current === index ? (el) => { if (el) el.focus(); } : undefined}
          />
          <button
            type="button"
            data-testid={`linelist-${index}-remove`}
            onClick={() => handleRemove(index)}
            disabled={saving}
            aria-label={`删除第 ${index + 1} 条`}
            className="shrink-0 inline-flex items-center justify-center h-6 w-6 mt-1 rounded text-system-log/40 hover:text-error transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-xs">close</span>
          </button>
        </div>
      ))}

      <button
        type="button"
        data-testid="linelist-add"
        onClick={handleAdd}
        disabled={saving}
        className="inline-flex items-center gap-0.5 px-2 py-1 border border-dashed border-system-log/30 rounded text-xs text-system-log/50 hover:text-primary-container hover:border-primary-container/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-xs">add</span>
        添加一条
      </button>
    </div>
  );
}