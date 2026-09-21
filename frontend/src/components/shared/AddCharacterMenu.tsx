import { useEffect } from "react";
import type { Character } from "../../api/client";

/**
 * 2026-09-21: 角色类型选择 popover (4 个选项)。
 *
 * 由 CharacterStep tab strip 右侧的 + 按钮触发 (controlled — 父组件维护
 * open 状态)。点选 / 点空白 / ESC 都触发 onClose。
 *
 * 接 onPick 而不是直接接生成 handler, 是为了让父组件控制 API 调用 + state
 * 更新节奏, 也方便未来其他 wizard 步骤复用 (例如 ConceptStep 想加「批量
 * 生成配角」入口)。
 */
export interface AddCharacterMenuProps {
  /** 用户选了某类型。父组件负责关闭菜单 + 调 API。 */
  onPick: (type: Character["character_type"]) => void;
  /**
   * 任何关闭路径 (backdrop / ESC) 都走这里。
   * 多次触发是预期的 — 调用方须自行保证幂等 (e.g. setOpen(false) 即可)。
   */
  onClose: () => void;
  /** 父组件 busy 时禁用所有选项。 */
  disabled?: boolean;
}

const CHARACTER_TYPES: { value: Character["character_type"]; label: string }[] = [
  { value: "protagonist", label: "主角" },
  { value: "antagonist", label: "反派" },
  { value: "supporting", label: "配角" },
  { value: "mentor", label: "导师" },
];

export function AddCharacterMenu({ onPick, onClose, disabled }: AddCharacterMenuProps) {
  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
        data-testid="character-add-backdrop"
      />
      <div
        data-testid="character-add-menu"
        role="menu"
        className="absolute right-0 top-full mt-1 z-50 bg-surface-container-high border border-outline-variant rounded-lg shadow-lg py-1 min-w-[120px]"
      >
        {CHARACTER_TYPES.map(({ value, label }) => (
          <button
            key={value}
            data-testid={`character-add-${value}`}
            role="menuitem"
            onClick={() => onPick(value)}
            disabled={disabled}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-surface-container disabled:opacity-40"
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}