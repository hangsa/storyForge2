import type { SandboxParams } from "../../api/client";

interface Props {
  params: SandboxParams;
  onChange: (params: SandboxParams) => void;
}

function update<K extends keyof SandboxParams>(
  params: SandboxParams, key: K, patch: Partial<SandboxParams[K]>,
): SandboxParams {
  return { ...params, [key]: { ...(params[key] as object), ...patch } as SandboxParams[K] };
}

export default function ParamSliders({ params, onChange }: Props) {
  const s = params.sentence;
  const d = params.dialogue;
  const r = params.rhythm;
  const dens = params.density;
  const sat = params.satisfaction;

  return (
    <div className="space-y-4" aria-label="风格参数面板">
      <fieldset className="border rounded p-2">
        <legend className="text-sm font-medium px-1">句长</legend>
        <label className="block text-xs">
          平均句长下限（字）：
          <input
            type="number" min={5} max={100}
            value={s.avg_length_range[0]}
            onChange={(e) => onChange(update(params, "sentence", {
              avg_length_range: [Number(e.target.value), s.avg_length_range[1]],
            }))}
            className="ml-2 w-16 border rounded px-1"
          />
        </label>
        <label className="block text-xs">
          平均句长上限（字）：
          <input
            type="number" min={5} max={100}
            value={s.avg_length_range[1]}
            onChange={(e) => onChange(update(params, "sentence", {
              avg_length_range: [s.avg_length_range[0], Number(e.target.value)],
            }))}
            className="ml-2 w-16 border rounded px-1"
          />
        </label>
        <label className="block text-xs">
          短句占比：
          <input
            type="number" step={0.05} min={0} max={1}
            value={s.short_sentence_ratio}
            onChange={(e) => onChange(update(params, "sentence", {
              short_sentence_ratio: Number(e.target.value),
            }))}
            className="ml-2 w-16 border rounded px-1"
          />
        </label>
      </fieldset>

      <fieldset className="border rounded p-2">
        <legend className="text-sm font-medium px-1">对白</legend>
        <label className="block text-xs">
          对白占比：
          <input
            type="number" step={0.05} min={0} max={1}
            value={d.ratio}
            onChange={(e) => onChange(update(params, "dialogue", {
              ratio: Number(e.target.value),
            }))}
            aria-label="对白占比"
            className="ml-2 w-16 border rounded px-1"
          />
        </label>
        <label className="block text-xs">
          连续对白上限（行）：
          <input
            type="number" min={1} max={20}
            value={d.max_consecutive_lines}
            onChange={(e) => onChange(update(params, "dialogue", {
              max_consecutive_lines: Number(e.target.value),
            }))}
            className="ml-2 w-16 border rounded px-1"
          />
        </label>
      </fieldset>

      <fieldset className="border rounded p-2">
        <legend className="text-sm font-medium px-1">节奏</legend>
        <label className="block text-xs">
          节奏 BPM：
          <input
            type="number" min={60} max={600}
            value={r.pacing_bpm}
            onChange={(e) => onChange(update(params, "rhythm", {
              pacing_bpm: Number(e.target.value),
            }))}
            className="ml-2 w-16 border rounded px-1"
          />
        </label>
      </fieldset>

      <fieldset className="border rounded p-2">
        <legend className="text-sm font-medium px-1">密度</legend>
        <label className="block text-xs">
          描写占比：
          <input
            type="number" step={0.05} min={0} max={1}
            value={dens.description_ratio}
            onChange={(e) => onChange(update(params, "density", {
              description_ratio: Number(e.target.value),
            }))}
            className="ml-2 w-16 border rounded px-1"
          />
        </label>
        <label className="block text-xs">
          动作占比：
          <input
            type="number" step={0.05} min={0} max={1}
            value={dens.action_ratio}
            onChange={(e) => onChange(update(params, "density", {
              action_ratio: Number(e.target.value),
            }))}
            className="ml-2 w-16 border rounded px-1"
          />
        </label>
      </fieldset>

      <fieldset className="border rounded p-2">
        <legend className="text-sm font-medium px-1">爽点</legend>
        <label className="block text-xs">
          爽点数量：
          <input
            type="number" min={0} max={50}
            value={sat.satisfaction_beat_count}
            onChange={(e) => onChange(update(params, "satisfaction", {
              satisfaction_beat_count: Number(e.target.value),
            }))}
            className="ml-2 w-16 border rounded px-1"
          />
        </label>
        <label className="block text-xs mt-1">
          <input
            type="checkbox"
            checked={sat.suspense_hook_required}
            onChange={(e) => onChange(update(params, "satisfaction", {
              suspense_hook_required: e.target.checked,
            }))}
          />
          <span className="ml-1">必需悬念钩子</span>
        </label>
      </fieldset>
    </div>
  );
}
