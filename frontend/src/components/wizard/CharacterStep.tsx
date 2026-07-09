import { useState } from "react";
import api, { CharacterSet } from "../../api/client";
import { useWizard } from "./WizardContext";

interface CharacterStepProps {
  projectId: string;
}

const CHARACTER_TYPES: { value: string; label: string }[] = [
  { value: "protagonist", label: "主角" },
  { value: "antagonist", label: "反派" },
  { value: "supporting", label: "配角" },
  { value: "mentor", label: "导师" },
];

export default function CharacterStep({ projectId }: CharacterStepProps) {
  const wizard = useWizard();
  const [characters, setCharacters] = useState<CharacterSet | null>(wizard.data.characters ?? null);
  const [characterType, setCharacterType] = useState("protagonist");
  const [busy, setBusy] = useState(false);

  const handleStart = async () => {
    wizard.startStep(3);
    setBusy(true);
    try {
      const result = await api.generateCharacter(projectId, characterType);
      setCharacters(result);
      wizard.setStatus("completed");
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "角色生成失败");
    } finally {
      setBusy(false);
    }
  };

  const handleNext = async () => {
    if (!characters) return;
    setBusy(true);
    try {
      await api.updateCharacter(projectId, characters);
      wizard.saveStep(3, { characters });
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "角色保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="character-step" className="space-y-4">
      {wizard.status === "idle" && (
        <div data-testid="character-idle" className="text-center py-12 space-y-4">
          <span className="material-symbols-outlined text-5xl text-system-log/30 block">person</span>
          <p className="font-body-ui text-system-log">选择要生成的角色类型</p>
          <div className="flex flex-wrap justify-center gap-2">
            {CHARACTER_TYPES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                data-testid={`character-type-${value}`}
                onClick={() => setCharacterType(value)}
                className={`px-3 py-1.5 rounded-full border text-sm font-body-ui transition-colors ${
                  characterType === value
                    ? "bg-primary-container text-surface-container-low border-primary-container"
                    : "bg-surface-container text-system-log border-outline-variant hover:border-primary-container"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            data-testid="character-start"
            onClick={handleStart}
            disabled={busy}
            className="px-5 py-2.5 bg-primary-container text-surface-container-low font-body-ui rounded-lg hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "生成中…" : "开始生成"}
          </button>
        </div>
      )}

      {wizard.status === "generating" && (
        <div className="text-center py-12">
          <span className="material-symbols-outlined text-4xl text-primary-container animate-spin inline-block">progress_activity</span>
          <p className="font-body-ui text-system-log mt-3 text-sm">正在生成角色…</p>
        </div>
      )}

      {wizard.status === "error" && (
        <div className="p-4 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-sm">
          {wizard.errorMessage}
          <button onClick={handleStart} className="ml-3 px-3 py-1 bg-surface-container text-primary rounded text-xs">重试</button>
        </div>
      )}

      {characters && characters.characters.length > 0 && (
        <div data-testid="character-form" className="space-y-3">
          <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">
            已生成 {characters.characters.length} 个角色
          </div>
          <ul className="space-y-2">
            {characters.characters.map((c) => (
              <li
                key={c.id}
                data-testid={`character-${c.id}`}
                className="p-3 bg-surface-container rounded-lg flex items-center justify-between"
              >
                <div>
                  <div className="font-display text-primary">{c.name || "未命名"}</div>
                  <div className="font-label-mono text-system-log text-xs">
                    {CHARACTER_TYPES.find((t) => t.value === c.character_type)?.label || c.character_type}
                    {c.is_core_character ? " · 核心角色" : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="font-body-ui text-system-log/60 text-xs">
            角色详情可在工作台的角色标签页内继续编辑。
          </p>
          <div className="flex justify-between pt-2">
            <button
              onClick={handleStart}
              disabled={busy}
              className="px-4 py-2 text-sm bg-surface-container text-system-log rounded-lg hover:bg-surface-container-low disabled:opacity-40"
            >
              再生成一个
            </button>
            <button
              data-testid="character-next"
              onClick={handleNext}
              disabled={busy}
              className="px-5 py-2 bg-tertiary-container text-surface-container-low text-sm rounded-lg hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "保存中…" : "下一步"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
