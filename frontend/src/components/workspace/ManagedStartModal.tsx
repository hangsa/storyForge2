import { useState } from "react";

export interface ManagedStartConfig {
  scope: "all_planned" | "next_chapter";
  cadence: "fast" | "balanced" | "careful";
  policy: "auto" | "ask";
  notify: "all" | "milestones";
}

interface Props {
  open: boolean;
  onCancel: () => void;
  onStart: (cfg: ManagedStartConfig) => void;
}

export default function ManagedStartModal({ open, onCancel, onStart }: Props) {
  const [scope, setScope] = useState<ManagedStartConfig["scope"]>("all_planned");
  const [cadence, setCadence] = useState<ManagedStartConfig["cadence"]>("balanced");
  const [policy, setPolicy] = useState<ManagedStartConfig["policy"]>("auto");
  const [notify, setNotify] = useState<ManagedStartConfig["notify"]>("milestones");

  if (!open) return null;

  return (
    <div
      data-testid="managed-start-modal"
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
    >
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 max-w-lg w-full space-y-4">
        <h2 className="font-display text-primary text-lg">启动托管模式</h2>
        <p className="font-body-ui text-sm text-system-log">
          所有选项仅在本机 UI 中生效；真实 AI 调度在 v1.9+ 接入。
        </p>

        <Field label="推进范围">
          <Radio name="scope" value="all_planned" current={scope} onChange={(v) => setScope(v as any)} label="所有已规划章节" />
          <Radio name="scope" value="next_chapter" current={scope} onChange={(v) => setScope(v as any)} label="仅下一章" />
        </Field>
        <Field label="推进节奏">
          <Radio name="cadence" value="fast" current={cadence} onChange={(v) => setCadence(v as any)} label="快" />
          <Radio name="cadence" value="balanced" current={cadence} onChange={(v) => setCadence(v as any)} label="均衡" />
          <Radio name="cadence" value="careful" current={cadence} onChange={(v) => setCadence(v as any)} label="稳" />
        </Field>
        <Field label="AI 决策策略">
          <Radio name="policy" value="auto" current={policy} onChange={(v) => setPolicy(v as any)} label="自动决策" />
          <Radio name="policy" value="ask" current={policy} onChange={(v) => setPolicy(v as any)} label="关键决策前询问" />
        </Field>
        <Field label="通知规则">
          <Radio name="notify" value="all" current={notify} onChange={(v) => setNotify(v as any)} label="每次事件" />
          <Radio name="notify" value="milestones" current={notify} onChange={(v) => setNotify(v as any)} label="仅里程碑" />
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
            onClick={() => onStart({ scope, cadence, policy, notify })}
            className="px-4 py-2 text-sm rounded-lg bg-tertiary-container text-surface-container-low hover:opacity-90"
          >
            启动托管
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