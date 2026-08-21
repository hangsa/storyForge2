import ChapterTreePanel, {
  type SceneStatusMap,
  type WorkspaceVolumeGroup,
} from "./ChapterTreePanel";
import type { ChapterStatus } from "../../types/chapter";

/**
 * Managed-mode left column. v1.9: now renders the same `<ChapterTreePanel />`
 * the manual-mode column uses, so the two columns show the same chapters,
 * same titles, same volume grouping, same status badges. The only deliberate
 * difference: `onAddChapter` is `undefined` here so the "+ 新章节" toolbar
 * button is hidden (managed mode has no manual chapter-adding workflow —
 * chapters are produced by the autopilot).
 */
interface Props {
  projectId: string;
  chapters: Array<{ chapter_number: number; status: ChapterStatus }>;
  /** Pre-grouped volumes from WorkspacePage. Optional — if omitted, an
   *  empty array is used and the chapter rows just don't render (the parent
   *  decides the ungrouped fallback policy). */
  volumes?: WorkspaceVolumeGroup[];
  currentChapter: number;
  currentScene: string | null;
  chapterStatus?: Record<number, ChapterStatus>;
  sceneStatus?: SceneStatusMap;
  onChapterClick: (chapter_number: number, status: ChapterStatus) => void;
  onSelectScene?: (chapter_number: number, scene_id: string) => void;
  onRefresh: () => void;
  /** v2.1: 透传到 ChapterTreePanel。 */
  onInit?: () => void;
}

export default function ManagedDashboard({
  projectId,
  volumes = [],
  currentChapter,
  currentScene,
  chapterStatus,
  sceneStatus,
  onChapterClick,
  onSelectScene,
  onRefresh,
  onInit,
}: Props) {
  return (
    <div data-testid="managed-dashboard" className="h-full">
      <ChapterTreePanel
        volumes={volumes}
        currentChapter={currentChapter}
        currentScene={currentScene}
        chapterStatus={chapterStatus}
        sceneStatus={sceneStatus}
        onSelectChapter={(n) => {
          const status = chapterStatus?.[n] ?? "pending";
          onChapterClick(n, status);
        }}
        onSelectScene={onSelectScene ?? ((_n, _s) => {})}
        // Deliberately undefined — managed mode has no manual add-chapter
        // workflow, so ChapterTreePanel hides the button when this is omitted.
        onRefresh={onRefresh}
        onInit={onInit}
      />
    </div>
  );
}