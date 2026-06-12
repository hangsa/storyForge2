import { ProgressFile } from "../../api/client";

interface ChapterProgressProps {
  chapterNumber: number;
  onChapterChange: (chapter: number) => void;
  onAdvance: () => void;
  advancing: boolean;
  progress: ProgressFile | null;
}

export default function ChapterProgress({
  chapterNumber,
  onChapterChange,
  onAdvance,
  advancing,
  progress,
}: ChapterProgressProps) {
  const totalChapters = progress?.total_chapters || 1;
  const chapters = progress?.chapters || [];
  const currentChapterProgress = chapters.find(
    (ch) => ch.chapter_number === chapterNumber
  );

  const completedScenes =
    currentChapterProgress?.scenes.filter(
      (s) => s.status === "completed" || s.status === "force_passed"
    ).length || 0;

  const trackedScenes = currentChapterProgress?.scenes.length || 0;
  const plannedScenes = currentChapterProgress?.total_scenes || trackedScenes;
  const chapterDone = plannedScenes > 0 && completedScenes >= plannedScenes;
  const overallPercent =
    totalChapters > 1
      ? Math.round((chapters.filter((ch) => ch.status === "completed").length / totalChapters) * 100)
      : chapterDone
        ? 100
        : 0;

  return (
    <div className="space-y-3">
      {/* Chapter selector */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => onChapterChange(chapterNumber - 1)}
          disabled={chapterNumber <= 1}
          className="px-3 py-1.5 text-sm bg-surface-container text-system-log font-body-ui
                     rounded-lg hover:bg-surface-container-low transition-colors
                     disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ◀ 上一章
        </button>

        <div className="flex items-center gap-2">
          <span className="font-label-mono text-primary">
            第 {chapterNumber} 章 / 共 {totalChapters} 章
          </span>
          {chapterDone && (
            <span className="text-xs px-2 py-0.5 bg-tertiary-container/20 text-tertiary-container rounded font-body-ui">
              本章已完成
            </span>
          )}
        </div>

        <button
          onClick={() => onChapterChange(chapterNumber + 1)}
          disabled={chapterNumber >= totalChapters}
          className="px-3 py-1.5 text-sm bg-surface-container text-system-log font-body-ui
                     rounded-lg hover:bg-surface-container-low transition-colors
                     disabled:opacity-30 disabled:cursor-not-allowed"
        >
          下一章 ▶
        </button>
      </div>

      {/* Overall progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="font-label-mono text-system-log text-xs">全书进度</span>
          <span className="font-label-mono text-system-log text-xs">{overallPercent}%</span>
        </div>
        <div className="w-full h-2 bg-surface-container rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-container rounded-full transition-all duration-500"
            style={{ width: `${overallPercent}%` }}
          />
        </div>
      </div>

      {/* Scene progress within chapter */}
      {plannedScenes > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="font-label-mono text-system-log text-xs">本章场景</span>
            <span className="font-label-mono text-system-log text-xs">
              已完成 {completedScenes} / 共 {plannedScenes} 场景
            </span>
          </div>
          <div className="flex gap-1.5">
            {Array.from({ length: plannedScenes }, (_, i) => {
              const s = currentChapterProgress?.scenes.find(
                (sc) => sc.scene_number === i + 1
              );
              const status = s?.status || "pending";
              return (
                <div
                  key={i}
                  className={`flex-1 h-1.5 rounded-full ${
                    status === "completed" || status === "force_passed"
                      ? "bg-tertiary-container"
                      : status === "skipped"
                        ? "bg-system-log/40"
                        : "bg-surface-container-low"
                  }`}
                  title={`Scene ${i + 1}: ${status}`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Advance chapter button — only when not last chapter */}
      {chapterDone && chapterNumber < totalChapters && (
        <button
          onClick={onAdvance}
          disabled={advancing}
          className="w-full px-4 py-3 bg-tertiary-container text-surface-container-low font-body-ui
                     rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {advancing ? "推进中..." : `进入第 ${chapterNumber + 1} 章 →`}
        </button>
      )}
    </div>
  );
}
