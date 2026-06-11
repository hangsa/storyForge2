import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProject } from "../hooks/useProject";
import GlassPanel from "../components/shared/GlassPanel";

type WizardStep = "intent" | "settings";

export default function InitPage() {
  const navigate = useNavigate();
  const { createProject, loading, error, clearError } = useProject();

  const [step, setStep] = useState<WizardStep>("intent");
  const [intent, setIntent] = useState("");
  const [genre, setGenre] = useState("cool_novel");
  const [minWords, setMinWords] = useState(4000);

  const handleNext = () => {
    if (!intent.trim()) return;
    setStep("settings");
  };

  const handleSubmit = async () => {
    if (!intent.trim()) return;
    try {
      const project = await createProject(intent, genre, minWords);
      navigate(`/project/${project.id}/stage1`);
    } catch {
      // error handled by hook
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-12">
      {/* Step indicator */}
      <div className="flex items-center gap-4 mb-10 justify-center">
        {(["intent", "settings"] as WizardStep[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center font-label-mono text-sm
                ${step === s
                  ? "bg-primary-container text-surface-container-low"
                  : "bg-surface-container text-system-log"
                }`}
            >
              {i + 1}
            </div>
            <span className={`font-body-ui text-sm ${step === s ? "text-primary" : "text-system-log"}`}>
              {s === "intent" ? "创作意图" : "项目设置"}
            </span>
            {i === 0 && <div className="w-16 h-px bg-outline-variant" />}
          </div>
        ))}
      </div>

      {/* Step 1: Intent */}
      {step === "intent" && (
        <GlassPanel>
          <h1 className="font-display-lg text-primary-container mb-2">欢迎使用 StoryForge</h1>
          <p className="font-body-ui text-system-log mb-6">
            描述你想要的故事情节，AI 将协助你完成一部网文小说。
          </p>

          <label className="block font-label-mono text-system-log mb-2">
            故事构思
          </label>
          <textarea
            value={intent}
            onChange={(e) => { setIntent(e.target.value); clearError(); }}
            placeholder="例如：一个被家族抛弃的少年，在异世界觉醒了隐藏的血脉之力，从此踏上强者之路..."
            className="w-full h-40 bg-surface-container border border-outline-variant rounded-lg px-4 py-3
                       font-body-narrative text-primary placeholder-system-log/50
                       focus:outline-none focus:border-primary-container resize-none"
            autoFocus
          />

          {error && (
            <div className="mt-4 p-3 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-sm">
              {error}
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <button
              onClick={handleNext}
              disabled={!intent.trim()}
              className="px-6 py-2.5 bg-primary-container text-surface-container-low font-body-ui
                         rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              下一步：项目设置
            </button>
          </div>
        </GlassPanel>
      )}

      {/* Step 2: Settings */}
      {step === "settings" && (
        <GlassPanel>
          <h2 className="font-display-lg text-primary-container mb-6">项目设置</h2>

          <div className="space-y-5">
            {/* Genre */}
            <div>
              <label className="block font-label-mono text-system-log mb-2">体裁模板</label>
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="w-full bg-surface-container border border-outline-variant rounded-lg px-4 py-2.5
                           font-body-ui text-primary focus:outline-none focus:border-primary-container"
              >
                <option value="cool_novel">爽文</option>
                <option value="xianxia">仙侠</option>
                <option value="xuanhuan">玄幻</option>
                <option value="dushi">都市</option>
                <option value="kehuan">科幻</option>
              </select>
            </div>

            {/* Min words */}
            <div>
              <label className="block font-label-mono text-system-log mb-2">
                最低字数（字）
              </label>
              <input
                type="number"
                value={minWords}
                onChange={(e) => setMinWords(Number(e.target.value))}
                min={2000}
                max={20000}
                step={1000}
                className="w-full bg-surface-container border border-outline-variant rounded-lg px-4 py-2.5
                           font-body-ui text-primary focus:outline-none focus:border-primary-container"
              />
              <p className="font-body-ui text-system-log text-xs mt-1">
                MVP 建议 4000-6000 字，控制在 50K tokens 预算内
              </p>
            </div>

            {/* Summary */}
            <div className="bg-surface-container rounded-lg p-4">
              <h3 className="font-label-mono text-system-log mb-2">创作意图回顾</h3>
              <p className="font-body-narrative text-primary text-sm">{intent}</p>
            </div>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-sm">
              {error}
            </div>
          )}

          <div className="mt-6 flex justify-between">
            <button
              onClick={() => setStep("intent")}
              className="px-6 py-2.5 bg-surface-container text-system-log font-body-ui
                         rounded-lg hover:bg-surface-container-low transition-colors"
            >
              返回修改
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="px-6 py-2.5 bg-primary-container text-surface-container-low font-body-ui
                         rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {loading ? "创建中..." : "创建项目并开始"}
            </button>
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
