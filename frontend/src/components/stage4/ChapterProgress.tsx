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

  const totalScenes = currentChapterProgress?.scenes.length || 0;
  const chapterDone = totalScenes > 0 && completedScenes >= totalScenes;
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
      {totalScenes > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="font-label-mono text-system-log text-xs">本章场景</span>
            <span className="font-label-mono text-system-log text-xs">
              {completedScenes}/{totalScenes}
            </span>
          </div>
          <div className="flex gap-1.5">
            {currentChapterProgress?.scenes.map((s) => (
              <div
                key={s.scene_number}
                className={`flex-1 h-1.5 rounded-full ${
                  s.status === "completed" || s.status === "force_passed"
                    ? "bg-tertiary-container"
                    : s.status === "skipped"
                      ? "bg-system-log/40"
                      : "bg-surface-container-low"
                }`}
                title={`Scene ${s.scene_number}: ${s.status}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Advance chapter button */}
      {chapterDone && (
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
