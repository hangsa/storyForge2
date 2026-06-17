import { useState } from "react";

interface TagEditorProps {
  items: string[];
  onItemsChange: (items: string[]) => void;
  saving: boolean;
}

export default function TagEditor({ items, onItemsChange, saving }: TagEditorProps) {
  const [addingTag, setAddingTag] = useState(false);
  const [newTagValue, setNewTagValue] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editTagValue, setEditTagValue] = useState("");

  const handleAddStart = () => {
    setNewTagValue("");
    setAddingTag(true);
  };

  const handleAddSave = () => {
    if (newTagValue.trim()) {
      onItemsChange([...items, newTagValue.trim()]);
    }
    setNewTagValue("");
    setAddingTag(false);
  };

  const handleAddCancel = () => {
    setNewTagValue("");
    setAddingTag(false);
  };

  const handleEditStart = (index: number, value: string) => {
    setEditingIndex(index);
    setEditTagValue(value);
  };

  const handleEditSave = () => {
    if (editingIndex !== null && editTagValue.trim()) {
      const updated = items.map((item, i) =>
        i === editingIndex ? editTagValue.trim() : item
      );
      onItemsChange(updated);
    }
    setEditingIndex(null);
    setEditTagValue("");
  };

  const handleEditCancel = () => {
    setEditingIndex(null);
    setEditTagValue("");
  };

  const handleRemove = (index: number) => {
    onItemsChange(items.filter((_, i) => i !== index));
  };

  const disabled = saving;

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {items.length === 0 && !addingTag && (
        <span className="text-xs text-system-log/40 font-body-ui">暂无</span>
      )}

      {items.map((item, index) => (
        <span
          key={`${item}-${index}`}
          className="inline-flex items-center gap-1 px-2 py-1 bg-surface-container rounded text-xs font-body-narrative text-primary"
        >
          {editingIndex === index ? (
            <input
              value={editTagValue}
              onChange={(e) => setEditTagValue(e.target.value)}
              className="w-24 input-underline text-xs"
              autoFocus
              disabled={disabled}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleEditSave();
                if (e.key === "Escape") handleEditCancel();
              }}
            />
          ) : (
            <button
              onClick={() => handleEditStart(index, item)}
              disabled={disabled}
              className="hover:text-primary-container transition-colors"
            >
              {item}
            </button>
          )}
          <button
            onClick={() => handleRemove(index)}
            disabled={disabled}
            className="text-system-log/40 hover:text-error transition-colors leading-none"
          >
            <span className="material-symbols-outlined text-xs">close</span>
          </button>
        </span>
      ))}

      {addingTag ? (
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-surface-container-low border border-primary-container/50 rounded">
          <input
            value={newTagValue}
            onChange={(e) => setNewTagValue(e.target.value)}
            className="w-24 input-underline text-xs"
            autoFocus
            disabled={disabled}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddSave();
              if (e.key === "Escape") handleAddCancel();
            }}
          />
          <button
            onClick={handleAddSave}
            disabled={disabled || !newTagValue.trim()}
            className="text-primary-container hover:opacity-80 transition-opacity disabled:opacity-30 leading-none"
          >
            <span className="material-symbols-outlined text-xs">check</span>
          </button>
          <button
            onClick={handleAddCancel}
            disabled={disabled}
            className="text-system-log/40 hover:text-system-log transition-colors leading-none"
          >
            <span className="material-symbols-outlined text-xs">close</span>
          </button>
        </span>
      ) : (
        <button
          onClick={handleAddStart}
          disabled={disabled}
          className="inline-flex items-center gap-0.5 px-2 py-1 border border-dashed border-system-log/30
                     rounded text-xs text-system-log/50 hover:text-primary-container hover:border-primary-container/50
                     transition-colors disabled:opacity-30"
        >
          <span className="material-symbols-outlined text-xs">add</span>
        </button>
      )}
    </div>
  );
}
