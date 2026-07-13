import { useAutopilotConfig } from "../../hooks/useAutopilotConfig";
import { useToast } from "../../hooks/useToast";

export interface ManagedStartConfig {
  scope: "all_planned" | "next_chapter";
  cadence: "fast" | "balanced" | "careful";
  policy: "auto" | "ask";
  notify: "all" | "milestones";
}

interface Props {
  projectId: string;
  open: boolean;
  onCancel: () => void;
  onStarted: () => void;
}

export default function ManagedStartModal({
  projectId, open, onCancel, onStarted,
}: Props) {
  const { config, setConfig, loaded, submitting, submit } =
    useAutopilotConfig(projectId);
  const { show } = useToast();

  if (!open || !loaded) return null;

  const setField = <K extends keyof ManagedStartConfig>(
    key: K, value: ManagedStartConfig[K],
  ) => setConfig({ ...config, [key]: value });

  return (
    <div
      data-testid="managed-start-modal"
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
    >
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 max-w-lg w-full space-y-4">
        <h2 className="font-display text-primary text-lg">启动托管模式</h2>
        <p className="font-body-ui text-sm text-system-log">
          配置将写入项目会话；再次打开会自动恢复。
        </p>

        <Field label="推进范围">
          <Radio name="scope" value="all_planned" current={config.scope} onChange={(v) => setField("scope", v as any)} label="所有已规划章节" />
          <Radio name="scope" value="next_chapter" current={config.scope} onChange={(v) => setField("scope", v as any)} label="仅下一章" />
        </Field>
        <Field label="推进节奏">
          <Radio name="cadence" value="fast" current={config.cadence} onChange={(v) => setField("cadence", v as any)} label="快" />
          <Radio name="cadence" value="balanced" current={config.cadence} onChange={(v) => setField("cadence", v as any)} label="均衡" />
          <Radio name="cadence" value="careful" current={config.cadence} onChange={(v) => setField("cadence", v as any)} label="稳" />
        </Field>
        <Field label="AI 决策策略">
          <Radio name="policy" value="auto" current={config.policy} onChange={(v) => setField("policy", v as any)} label="自动决策" />
          <Radio name="policy" value="ask" current={config.policy} onChange={(v) => setField("policy", v as any)} label="关键决策前询问" />
        </Field>
        <Field label="通知规则">
          <Radio name="notify" value="all" current={config.notify} onChange={(v) => setField("notify", v as any)} label="每次事件" />
          <Radio name="notify" value="milestones" current={config.notify} onChange={(v) => setField("notify", v as any)} label="仅里程碑" />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            data-testid="start-cancel"
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg bg-surface-container text-system-log hover:bg-surface-container-low"
          >
            稍后再说
          </button>
          <button
            type="button"
            data-testid="start-submit"
            disabled={submitting}
            onClick={async () => {
              try {
                await submit();
                onStarted();
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                show(`启动失败：${msg}`);
              }
            }}
            className="px-4 py-2 text-sm rounded-lg bg-tertiary-container text-surface-container-low hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "启动中…" : "启动托管"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">{label}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Radio({
  name, value, current, onChange, label,
}: { name: string; value: string; current: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 text-sm font-body-ui text-system-log cursor-pointer">
      <input
        type="radio"
        name={name}
        value={value}
        checked={current === value}
        onChange={(e) => onChange(e.target.value)}
        className="accent-primary-container"
      />
      {label}
    </label>
  );
}