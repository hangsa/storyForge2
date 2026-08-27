import { useMemo } from "react";
import { ProjectStats } from "../../api/client";
import { PhaseIndicator, Sidebar, SidebarNavItem, Sparkline, StatCard } from "../ds";
import { BUSINESS_GROUPS, businessGroupOf } from "../ds/stages";

interface StatsSidebarProps {
  stats: ProjectStats | null;
  statsLoading: boolean;
  onOpenPlaza?: () => void;
  plazaDisabled?: boolean;
  plazaTooltip?: string;
  onOpenConsole?: () => void;
  consoleDisabled?: boolean;
  consoleTooltip?: string;
  onOpenSettings?: () => void;
  onOpenSupport?: () => void;
}

export default function StatsSidebar({
  stats,
  statsLoading,
  onOpenPlaza,
  plazaDisabled,
  plazaTooltip,
  onOpenConsole,
  consoleDisabled,
  consoleTooltip,
  onOpenSettings,
  onOpenSupport,
}: StatsSidebarProps) {
  // Collapse the 8 backend stages into the 4 business-facing groups shown
  // in the sidebar. Sum counts across every stage that maps to each group,
  // so a project in STAGE3 contributes to 概念 alongside STAGE1/2.
  const phases = useMemo(
    () =>
      BUSINESS_GROUPS.map((label) => {
        const count = Object.entries(stats?.stage_distribution ?? {}).reduce(
          (acc, [stage, n]) => (businessGroupOf(stage) === label ? acc + (n ?? 0) : acc),
          0
        );
        return {
          key: label,
          label,
          count,
          active: label === "写作中",
          completed: label === "已完成",
        };
      }),
    [stats]
  );

  return (
    <Sidebar
      width={240}
      persistKey="storyforge.home.sidebar.collapsed"
      header={null}
      footer={
        <div className="flex flex-col gap-1">
          <FooterButton
            icon="settings"
            label="设置"
            testId="footer-settings"
            onClick={onOpenSettings}
          />
          <FooterButton
            icon="help"
            label="支持"
            testId="footer-support"
            onClick={onOpenSupport}
          />
        </div>
      }
      testId="stats-sidebar"
    >
      {(collapsed) => (
        <div className="flex flex-col gap-4">
          <nav className="flex flex-col">
            <SidebarNavItem
              icon="auto_stories"
              label="图书墙"
              active
              collapsed={collapsed}
              testId="nav-bookshelf"
            />
            <SidebarNavItem
              icon="smart_toy"
              label="AI 控制台"
              onClick={onOpenConsole}
              collapsed={collapsed}
              testId="nav-ai-console"
            />
            <SidebarNavItem
              icon="forum"
              label="提示词广场"
              onClick={onOpenPlaza}
              collapsed={collapsed}
              testId="nav-prompt-plaza"
            />
            <SidebarNavItem
              icon="monitoring"
              label="统计数据"
              collapsed={collapsed}
              testId="nav-stats"
            />
          </nav>

          {!collapsed && (
            <>
              <section>
                <h3 className="font-mono text-label-sm uppercase tracking-wider text-on-surface-variant mb-2">
                  全部统计
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  <StatCard label="书籍数量" value={stats?.total_books ?? null} size="sm" />
                  <StatCard label="总章节" value={stats?.total_chapters ?? null} size="sm" />
                  <StatCard
                    label="总字数"
                    value={stats?.total_words ?? null}
                    size="sm"
                    sublabel="Total"
                    sparkline={
                      stats?.word_count_series && stats.word_count_series.length >= 2 ? (
                        <Sparkline data={stats.word_count_series} testId="sparkline-total-words" />
                      ) : null
                    }
                  />
                </div>
              </section>

              <section>
                <h3 className="font-mono text-label-sm uppercase tracking-wider text-on-surface-variant mb-2">
                  阶段分布
                </h3>
                <PhaseIndicator phases={phases} />
              </section>
            </>
          )}

          {statsLoading && (
            <div className="font-mono text-label-sm text-on-surface-variant/60">
              加载中…
            </div>
          )}
        </div>
      )}
    </Sidebar>
  );
}

function FooterButton({
  icon, label, onClick, testId,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="w-full flex items-center gap-2 py-1.5 pl-4 pr-3 rounded text-sm text-on-surface-variant hover:text-primary hover:bg-surface-container-low"
    >
      <span className="material-symbols-outlined text-lg" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}