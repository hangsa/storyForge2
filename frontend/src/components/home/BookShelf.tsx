import { useEffect, useMemo, useState } from "react";
import api, { ProjectSummary } from "../../api/client";
import {
  DropdownSelect, GhostButton, LENGTH_CATEGORIES, PrimaryButton, ProjectTableRow,
  SearchInput, SecondaryButton, TableCheckbox,
} from "../ds";
import { isPreWizardStage, STAGE_LABELS } from "../ds/stages";
import { useGenres } from "../../hooks/useGenres";
import BulkDeleteModal from "./BulkDeleteModal";

type SortKey = "default" | "title" | "chapter_count" | "word_count" | "target_total_words" | "updated_at";
type SortDir = "asc" | "desc";

interface BookShelfProps {
  projects: ProjectSummary[];
  loading: boolean;
  onProjectsDeleted: (deletedIds: string[]) => void;
  /** Fires when the user clicks a row whose stage is pre-wizard (INIT/STAGE1-3).
   *  HomePage uses this to navigate into the project's workspace with the
   *  settings tab active, where the wizard panel now lives (v2.x fusion). */
  onResumeWizard?: (projectId: string) => void;
  /** Fires when the user clicks the "+ 新建项目" action button. */
  onOpenCreate?: () => void;
  /** Fires when the user clicks the "查询" button. HomePage re-fetches the
   *  project list so changes made elsewhere (another tab, an autopilot
   *  completion, a manual rename) become visible without a page reload. */
  onRefresh?: () => void;
}

const STAGE_OPTIONS = [
  { value: "all", label: "所有阶段" },
  ...Object.entries(STAGE_LABELS).map(([value, label]) => ({ value, label })),
];

const PAGE_SIZE_OPTIONS = [
  { value: "15", label: "15 / 页" },
  { value: "30", label: "30 / 页" },
  { value: "50", label: "50 / 页" },
  { value: "100", label: "100 / 页" },
];

const DEFAULT_PAGE_SIZE = 15;
// Fixed height for the populated table card. Sized so the rows area scrolls
// internally when its content exceeds the available space, while the
// pagination footer stays anchored at the bottom of the card. The page
// itself scrolls naturally — only the rows area is constrained.
const CARD_HEIGHT = "640px";

export default function BookShelf({ projects, loading, onProjectsDeleted, onResumeWizard, onOpenCreate, onRefresh }: BookShelfProps) {
  const genres = useGenres(false);
  const [search, setSearch] = useState("");
  const [genre, setGenre] = useState("all");
  const [stage, setStage] = useState("all");
  const [length, setLength] = useState("all");
  const [filtersApplied, setFiltersApplied] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const genreOptions = useMemo(
    () => [
      { value: "all", label: "所有题材" },
      ...genres.map((g) => ({ value: g.id, label: g.label_zh })),
    ],
    [genres]
  );
  const lengthOptions = useMemo(
    () => [
      { value: "all", label: "篇幅不限" },
      ...LENGTH_CATEGORIES.map((c) => ({ value: c.label, label: c.label })),
    ],
    []
  );

  // All filter conditions (search + dropdowns) are held locally until
  // 查询 is clicked — otherwise typing in the search box or poking a
  // dropdown would re-render the list mid-keystroke, and chained
  // condition changes (search → dropdown → search) would each trip a
  // re-render before the user settles on a final query.
  const filtered = useMemo(() => {
    if (!filtersApplied) return projects;
    let list = projects;
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) => p.title.toLowerCase().includes(q));
    if (genre !== "all") list = list.filter((p) => p.genre === genre);
    if (stage !== "all") list = list.filter((p) => p.current_stage === stage);
    if (length !== "all") list = list.filter((p) => p.target_length_category === length);
    return list;
  }, [projects, search, genre, stage, length, filtersApplied]);

  const sorted = useMemo(() => {
    if (sortKey === "default") {
      return [...filtered].sort((a, b) => b.updated_at - a.updated_at);
    }
    const list = [...filtered];
    list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));

  // Clamp page whenever sorted shrinks or pageSize grows: if the user is on
  // page 4 and a filter narrows the list to 2 pages total, snap back to the
  // last valid page. Skip the first render so we don't fire the effect before
  // page has settled on its initial value.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  function toggleSort(key: SortKey) {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); return; }
    if (sortDir === "asc") setSortDir("desc");
    else { setSortKey("default"); setSortDir("desc"); }
  }

  const empty = !loading && projects.length === 0;
  const filteredEmpty = !loading && projects.length > 0 && sorted.length === 0;

  // Select-all toggles every row currently visible (on the current page).
  // The header checkbox's own checked state is binary: it only reflects
  // "all visible rows checked" vs. "anything else" — partial selection just
  // shows the unchecked state, per the design.
  const allChecked = paged.length > 0 && paged.every((p) => selectedIds.has(p.id));
  function toggleSelectAll() {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (allChecked) {
        for (const p of paged) next.delete(p.id);
      } else {
        for (const p of paged) next.add(p.id);
      }
      return next;
    });
  }

  function changePageSize(next: number) {
    setPageSize(next);
    setPage(1);
  }

  function resetAll() {
    setSearch("");
    setGenre("all");
    setStage("all");
    setLength("all");
    setFiltersApplied(false);
    setPage(1);
  }

  // Build a compact page navigator: first / prev / current / next / last.
  // Always shown once pagination is active; for very short lists (<=1 page)
  // we still render the footer so the page-size selector + total count stay
  // visible per the spec.
  function goPage(n: number) {
    setPage(Math.min(totalPages, Math.max(1, n)));
  }

  return (
    <section data-testid="book-shelf" className="space-y-3">
      <div className="pl-4 flex items-center gap-3 flex-wrap shrink-0">
        <SearchInput value={search} onChange={setSearch} />
        <DropdownSelect label="题材" options={genreOptions} value={genre} onChange={setGenre} />
        <DropdownSelect label="阶段" options={STAGE_OPTIONS} value={stage} onChange={setStage} />
        <DropdownSelect label="篇幅" options={lengthOptions} value={length} onChange={setLength} />
        <SecondaryButton
          label="重置"
          icon="restart_alt"
          size="sm"
          onClick={resetAll}
          testId="reset-filters"
        />
      </div>

      <div className="pl-4 flex items-center gap-3 shrink-0">
        {onOpenCreate && (
          <PrimaryButton
            label="+ 新建项目"
            onClick={onOpenCreate}
            size="sm"
          />
        )}
        <SecondaryButton
          label="删除"
          variant="destructive"
          icon="delete"
          size="sm"
          disabled={selectedIds.size === 0}
          onClick={() => setConfirmOpen(true)}
          testId="bulk-delete-trigger"
        />
        <PrimaryButton
          label="查询"
          icon="search"
          size="sm"
          onClick={() => {
            // Apply the local genre/stage/length dropdowns AND trigger a
            // server re-fetch. Two reasons the server side matters even
            // when the user hasn't changed any filter: (a) other clients
            // may have created/deleted/advanced projects since the page
            // mounted, (b) stats derived per-row (chapter_count,
            // word_count) get stale the moment an autopilot loop ticks a
            // chapter.
            setFiltersApplied(true);
            setPage(1);
            onRefresh?.();
          }}
        />
      </div>

      {loading ? (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-lg overflow-hidden flex items-center justify-center text-on-surface-variant py-16">
          <div className="text-center">
            <span className="material-symbols-outlined text-3xl animate-spin">progress_activity</span>
            <div className="mt-2 font-body text-body-md">正在加载项目…</div>
          </div>
        </div>
      ) : empty ? (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-lg overflow-hidden flex items-center justify-center py-16">
          <div className="text-center">
            <span className="material-symbols-outlined text-5xl text-on-surface-variant/20 mb-3 block">
              auto_stories
            </span>
            <p className="font-body text-body-md text-on-surface-variant">
              还没有项目，点击「+ 新建项目」开始
            </p>
          </div>
        </div>
      ) : filteredEmpty ? (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-lg overflow-hidden flex items-center justify-center py-16">
          <div className="text-center">
            <span className="material-symbols-outlined text-5xl text-on-surface-variant/20 mb-3 block">
              search_off
            </span>
            <p className="font-body text-body-md text-on-surface-variant mb-3">未找到匹配项目</p>
            <GhostButton label="清空筛选" onClick={resetAll} />
          </div>
        </div>
      ) : (
        <div
          className="flex flex-col bg-surface-container-lowest border border-outline-variant rounded-lg overflow-hidden"
          style={{ height: CARD_HEIGHT }}
          data-testid="bookshelf-card"
        >
          <div className="grid grid-cols-[40px_2fr_1fr_1fr_1fr_1fr_1fr_1fr] items-center py-2 px-3 border-b border-outline-variant font-mono uppercase tracking-wider text-on-surface-variant text-sm shrink-0">
            <TableCheckbox
              checked={allChecked}
              onChange={() => toggleSelectAll()}
              disabled={paged.length === 0}
              ariaLabel="select all"
              testId="select-all"
            />
            <button onClick={() => toggleSort("title")}>书名</button>
            <button className="text-center">题材</button>
            <button className="text-center">阶段</button>
            <button onClick={() => toggleSort("chapter_count")} className="text-center">章节</button>
            <button onClick={() => toggleSort("word_count")} className="text-center">字数</button>
            <button onClick={() => toggleSort("target_total_words")} className="text-center">篇幅</button>
            <button onClick={() => toggleSort("updated_at")} className="text-right">最后编辑</button>
          </div>
          <div
            data-testid="bookshelf-rows"
            className="flex-1 min-h-0 overflow-y-auto"
          >
            {paged.map((p) => (
              <ProjectTableRow
                key={p.id}
                project={p}
                selected={selectedIds.has(p.id)}
                testId={`row-select-${p.id}`}
                onClick={() => {
                  if (isPreWizardStage(p.current_stage)) {
                    onResumeWizard?.(p.id);
                  } else {
                    window.location.assign(`/project/${p.id}/stage4`);
                  }
                }}
                onSelectChange={(sel) => {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (sel) next.add(p.id); else next.delete(p.id);
                    return next;
                  });
                }}
              />
            ))}
          </div>

          <div
            data-testid="bookshelf-footer"
            className="flex items-center justify-between gap-3 px-3 py-2 border-t border-outline-variant bg-surface-container-lowest shrink-0"
          >
            <div className="flex items-center gap-3">
              <DropdownSelect
                label="每页"
                options={PAGE_SIZE_OPTIONS}
                value={String(pageSize)}
                onChange={(v) => changePageSize(Number(v))}
                direction="up"
              />
              <span
                data-testid="bookshelf-total"
                className="font-mono text-label-sm text-on-surface-variant"
              >
                共 {sorted.length} 本
              </span>
            </div>
            <div
              data-testid="bookshelf-pager"
              className="flex items-center gap-1 font-mono text-sm"
            >
              <button
                type="button"
                onClick={() => goPage(1)}
                disabled={page === 1}
                className="px-2 py-1 rounded hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="first page"
                data-testid="pager-first"
              >
                «
              </button>
              <button
                type="button"
                onClick={() => goPage(page - 1)}
                disabled={page === 1}
                className="px-2 py-1 rounded hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="previous page"
                data-testid="pager-prev"
              >
                ‹
              </button>
              <span
                data-testid="pager-current"
                className="px-2 text-on-surface-variant"
              >
                {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => goPage(page + 1)}
                disabled={page === totalPages}
                className="px-2 py-1 rounded hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="next page"
                data-testid="pager-next"
              >
                ›
              </button>
              <button
                type="button"
                onClick={() => goPage(totalPages)}
                disabled={page === totalPages}
                className="px-2 py-1 rounded hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="last page"
                data-testid="pager-last"
              >
                »
              </button>
            </div>
          </div>
        </div>
      )}

      <BulkDeleteModal
        isOpen={confirmOpen}
        selectedIds={[...selectedIds]}
        selectedTitles={sorted.filter((p) => selectedIds.has(p.id)).map((p) => p.title)}
        onConfirm={async () => {
          try {
            await api.bulkDeleteProjects([...selectedIds]);
          } catch {
            // swallow — HomePage will refresh and reflect server truth
          }
          const deleted = [...selectedIds];
          onProjectsDeleted(deleted);
          setSelectedIds(new Set());
          setConfirmOpen(false);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}