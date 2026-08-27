import { useMemo } from "react";
import { ProjectStats } from "../../api/client";
import { BrandHeader, PhaseIndicator, Sidebar, StatCard } from "../ds";
import { STAGE_LABELS } from "../ds/stages";
import QuickActions from "./QuickActions";

interface StatsSidebarProps {
  stats: ProjectStats | null;
  statsLoading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  onOpenPlaza?: () => void;
  plazaDisabled?: boolean;
  plazaTooltip?: string;
  onOpenConsole?: () => void;
  consoleDisabled?: boolean;
  consoleTooltip?: string;
  onOpenMore?: () => void;
}

const STAGE_ORDER = [
  "INIT", "STAGE1", "STAGE2", "STAGE3",
  "STAGE4", "STAGE5", "STAGE6", "COMPLETED",
] as const;

export default function StatsSidebar({
  stats,
  statsLoading,
  onRefresh,
  refreshing,
  onOpenPlaza,
  plazaDisabled,
  plazaTooltip,
  onOpenConsole,
  consoleDisabled,
  consoleTooltip,
  onOpenMore,
}: StatsSidebarProps) {
  const phases = useMemo(
    () =>
      STAGE_ORDER.map((key) => ({
        key,
        label: STAGE_LABELS[key],
        count: stats?.stage_distribution?.[key] ?? 0,
        active: key === "STAGE4",
        completed: key === "COMPLETED",
      })),
    [stats]
  );

  return (
    <Sidebar
      persistKey="storyforge.home.sidebar.collapsed"
      header={<BrandHeader brandName="Nebula Forge" />}
      footer={null}
      testId="stats-sidebar"
    >
      {(collapsed) => (
        <div className="flex flex-col gap-4">
          {collapsed ? (
            <QuickActions
              collapsed
              onRefresh={onRefresh}
              refreshing={refreshing}
              onOpenPlaza={onOpenPlaza}
              plazaDisabled={plazaDisabled}
              plazaTooltip={plazaTooltip}
              onOpenConsole={onOpenConsole}
              consoleDisabled={consoleDisabled}
              consoleTooltip={consoleTooltip}
              onOpenMore={onOpenMore}
            />
          ) : (
            <>
              <section>
                <h3 className="font-mono text-label-sm uppercase tracking-wider text-on-surface-variant mb-2">
                  统计
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  <StatCard label="总书籍" value={stats?.total_books ?? null} size="sm" />
                  <StatCard label="总章节" value={stats?.total_chapters ?? null} size="sm" />
                  <StatCard label="总字数" value={stats?.total_words ?? null} size="sm" />
                </div>
              </section>

              <section>
                <h3 className="font-mono text-label-sm uppercase tracking-wider text-on-surface-variant mb-2">
                  阶段分布
                </h3>
                <PhaseIndicator phases={phases} />
              </section>

              <section>
                <h3 className="font-mono text-label-sm uppercase tracking-wider text-on-surface-variant mb-2">
                  快捷操作
                </h3>
                <QuickActions
                  onRefresh={onRefresh}
                  refreshing={refreshing}
                  onOpenPlaza={onOpenPlaza}
                  plazaDisabled={plazaDisabled}
                  plazaTooltip={plazaTooltip}
                  onOpenConsole={onOpenConsole}
                  consoleDisabled={consoleDisabled}
                  consoleTooltip={consoleTooltip}
                  onOpenMore={onOpenMore}
                />
                {statsLoading && (
                  <div className="mt-3 font-mono text-label-sm text-on-surface-variant/60">
                    加载中…
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </Sidebar>
  );
}