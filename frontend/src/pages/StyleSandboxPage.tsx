import { useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api/client";
import GlassPanel from "../components/shared/GlassPanel";

interface ExtractedStyleResult {
  sentence: { avg_length: number; distribution: { short_pct: number; medium_pct: number; long_pct: number } };
  dialogue: { ratio: number; avg_turn_length: number };
  description: { environment_pct: number; action_pct: number; psychology_pct: number; other_pct: number };
  vocabulary: { top_words: string[]; idiom_frequency: number; unique_word_ratio: number };
  rhythm: { scene_change_frequency: string; emotional_peak_density: string };
  source_text_length: number;
  name: string;
}

export default function StyleSandboxPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const [referenceText, setReferenceText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<ExtractedStyleResult | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const handleAnalyze = async () => {
    if (!projectId || !referenceText.trim()) return;
    setAnalyzing(true);
    setError("");
    setSaved(false);
    try {
      const r = await api.extractStyle(projectId, referenceText);
      setResult(r as unknown as ExtractedStyleResult);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-3xl font-display text-white">风格沙盒</h2>
        <p className="text-system-log/50 mt-1 text-sm">
          上传参考文本，分析写作风格特征（句式、词汇、节奏等）
        </p>
      </div>

      {/* Input area */}
      <GlassPanel>
        <h3 className="text-sm font-medium text-white mb-3">参考文本</h3>
        <textarea
          value={referenceText}
          onChange={(e) => setReferenceText(e.target.value)}
          placeholder="在此粘贴参考文本（建议 ≥500 字）..."
          rows={8}
          className="w-full rounded-lg border border-system-log/20 bg-surface-container-low px-4 py-3 text-sm text-white placeholder-system-log/30 focus:outline-none focus:border-accent-purple/50 resize-y"
        />
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-system-log/40">
            {referenceText.length} 字符
          </span>
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !referenceText.trim() || !projectId}
            className="flex items-center gap-2 rounded-lg bg-accent-purple px-5 py-2 text-sm font-medium text-white transition hover:bg-accent-purple/80 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-lg">
              {analyzing ? "progress_activity" : "psychology"}
            </span>
            {analyzing ? "分析中..." : "开始分析"}
          </button>
        </div>
      </GlassPanel>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {saved && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-400">
              风格配置已保存至项目目录
            </div>
          )}

          {/* Sentence features */}
          <GlassPanel>
            <h3 className="text-sm font-medium text-white mb-3">句式特征</h3>
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl font-semibold text-white">{result.sentence.avg_length}</div>
                <div className="text-xs text-system-log/40 mt-1">平均句长（字）</div>
              </div>
              <div>
                <div className="text-2xl font-semibold text-accent-purple">{result.sentence.distribution.short_pct}%</div>
                <div className="text-xs text-system-log/40 mt-1">短句 &lt;15字</div>
              </div>
              <div>
                <div className="text-2xl font-semibold text-emerald-400">{result.sentence.distribution.medium_pct}%</div>
                <div className="text-xs text-system-log/40 mt-1">中句 15-40字</div>
              </div>
              <div>
                <div className="text-2xl font-semibold text-amber-400">{result.sentence.distribution.long_pct}%</div>
                <div className="text-xs text-system-log/40 mt-1">长句 &gt;40字</div>
              </div>
            </div>
          </GlassPanel>

          {/* Dialogue + Description */}
          <div className="grid grid-cols-2 gap-4">
            <GlassPanel>
              <h3 className="text-sm font-medium text-white mb-3">对话特征</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-xs text-system-log/50">对话占比</span>
                  <span className="text-sm text-white">{(result.dialogue.ratio * 100).toFixed(0)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-system-log/50">平均对话长度</span>
                  <span className="text-sm text-white">{result.dialogue.avg_turn_length} 字/轮</span>
                </div>
              </div>
            </GlassPanel>

            <GlassPanel>
              <h3 className="text-sm font-medium text-white mb-3">描写类型分布</h3>
              <div className="space-y-3">
                {[
                  { label: "环境描写", pct: result.description.environment_pct, color: "bg-sky-400" },
                  { label: "动作描写", pct: result.description.action_pct, color: "bg-red-400" },
                  { label: "心理描写", pct: result.description.psychology_pct, color: "bg-purple-400" },
                  { label: "其他", pct: result.description.other_pct, color: "bg-system-log/30" },
                ].map(({ label, pct, color }) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="text-xs text-system-log/50 w-16">{label}</span>
                    <div className="flex-1 h-3 rounded-full bg-surface-container-low overflow-hidden">
                      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-white w-10 text-right">{pct}%</span>
                  </div>
                ))}
              </div>
            </GlassPanel>
          </div>

          {/* Vocabulary */}
          <GlassPanel>
            <h3 className="text-sm font-medium text-white mb-3">词汇特征</h3>
            <div className="flex items-center gap-8 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-system-log/50">成语频率</span>
                <span className="text-sm text-white">{result.vocabulary.idiom_frequency}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-system-log/50">独特词汇比</span>
                <span className="text-sm text-white">{result.vocabulary.unique_word_ratio}</span>
              </div>
            </div>
            <div>
              <span className="text-xs text-system-log/50">高频词 Top 20</span>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {result.vocabulary.top_words.slice(0, 20).map((word) => (
                  <span
                    key={word}
                    className="rounded bg-surface-container-low border border-system-log/10 px-2 py-0.5 text-xs text-system-log/70 font-mono"
                  >
                    {word}
                  </span>
                ))}
              </div>
            </div>
          </GlassPanel>

          {/* Rhythm */}
          <GlassPanel>
            <h3 className="text-sm font-medium text-white mb-3">节奏特征</h3>
            <div className="flex gap-8">
              <div className="flex items-center gap-2">
                <span className="text-xs text-system-log/50">场景切换频率</span>
                <span className="text-sm text-white">{result.rhythm.scene_change_frequency}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-system-log/50">情绪高潮密度</span>
                <span className="text-sm text-white">{result.rhythm.emotional_peak_density}</span>
              </div>
            </div>
          </GlassPanel>
        </>
      )}
    </div>
  );
}
