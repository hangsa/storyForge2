import { useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api/client";
import GlassPanel from "../components/shared/GlassPanel";

interface ExportOptions {
  strip_sf_logs: boolean;
  add_toc: boolean;
  include_title_page: boolean;
}

export default function Stage6Page() {
  const { projectId } = useParams<{ projectId: string }>();

  const [options, setOptions] = useState<ExportOptions>({
    strip_sf_logs: true,
    add_toc: true,
    include_title_page: true,
  });

  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{
    preview: string;
    total_chars: number;
    file_path: string;
  } | null>(null);
  const [error, setError] = useState("");

  const handleExport = async () => {
    if (!projectId) return;
    setExporting(true);
    setError("");
    try {
      const r = await api.exportNovel(projectId, options);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const handleDownload = () => {
    if (!projectId) return;
    window.open(`/api/stage6/download?project_id=${encodeURIComponent(projectId)}`, "_blank");
  };

  const toggleOption = (key: keyof ExportOptions) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-display text-white">导出中心</h2>
        <p className="text-system-log/50 mt-1 text-sm">
          将已完成的小说导出为 Markdown 文件
        </p>
      </div>

      {/* Export options */}
      <GlassPanel>
        <h3 className="text-sm font-medium text-white mb-4">导出选项</h3>
        <div className="space-y-3">
          {([
            { key: "strip_sf_logs", label: "去除 SF_LOG 标记", desc: "移除所有内部叙事标记，生成干净的读者版本" },
            { key: "add_toc", label: "添加章节目录", desc: "在文件头部生成目录" },
            { key: "include_title_page", label: "包含书名页", desc: "添加书名、作者和章节统计" },
          ] as const).map(({ key, label, desc }) => (
            <label
              key={key}
              className="flex items-start gap-3 cursor-pointer group"
            >
              <input
                type="checkbox"
                checked={options[key as keyof ExportOptions]}
                onChange={() => toggleOption(key as keyof ExportOptions)}
                className="mt-0.5 h-4 w-4 rounded border-system-log/30 bg-transparent accent-accent-purple"
              />
              <div>
                <span className="text-sm text-white group-hover:text-accent-purple transition">
                  {label}
                </span>
                <p className="text-xs text-system-log/40 mt-0.5">{desc}</p>
              </div>
            </label>
          ))}
        </div>
      </GlassPanel>

      {/* Export button */}
      <button
        onClick={handleExport}
        disabled={exporting || !projectId}
        className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent-purple px-6 py-3 text-sm font-medium text-white transition hover:bg-accent-purple/80 disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-lg">
          {exporting ? "progress_activity" : "file_save"}
        </span>
        {exporting ? "导出中..." : "导出 .md"}
      </button>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <>
          {/* Preview */}
          <GlassPanel>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-white">预览</h3>
              <span className="text-xs text-system-log/40">
                共 {result.total_chars.toLocaleString()} 字
              </span>
            </div>
            <pre className="text-xs text-system-log/50 leading-relaxed whitespace-pre-wrap font-sans max-h-64 overflow-y-auto">
              {result.preview}
              {result.total_chars > 500 && (
                <span className="text-system-log/30">\n\n... 更多内容 ...</span>
              )}
            </pre>
          </GlassPanel>

          {/* Download button */}
          <button
            onClick={handleDownload}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-emerald-500"
          >
            <span className="material-symbols-outlined text-lg">download</span>
            下载 .md 文件
          </button>
        </>
      )}
    </div>
  );
}
