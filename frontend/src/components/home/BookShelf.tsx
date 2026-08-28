import { useMemo, useState } from "react";
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
   *  HomePage uses this to re-open the InitWizardModal at the right step. */
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

  const filtered = useMemo(() => {
    let list = projects;
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) => p.title.toLowerCase().includes(q));
    if (filtersApplied) {
      if (genre !== "all") list = list.filter((p) => p.genre === genre);
      if (stage !== "all") list = list.filter((p) => p.current_stage === stage);
      if (length !== "all") list = list.filter((p) => p.target_length_category === length);
    }
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

  function toggleSort(key: SortKey) {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); return; }
    if (sortDir === "asc") setSortDir("desc");
    else { setSortKey("default"); setSortDir("desc"); }
  }

  const empty = !loading && projects.length === 0;
  const filteredEmpty = !loading && projects.length > 0 && sorted.length === 0;

  // Select-all toggles every row currently visible (after search/filter/sort).
  // The header checkbox's own checked state is binary: it only reflects
  // "all rows checked" vs. "anything else" — partial selection just shows
  // the unchecked state, per the design.
  const allChecked = sorted.length > 0 && selectedIds.size === sorted.length;
  function toggleSelectAll() {
    setSelectedIds(allChecked ? new Set() : new Set(sorted.map((p) => p.id)));
  }

  return (
    <section data-testid="book-shelf" className="space-y-3">
      <header className="flex items-center gap-3">
        <h2 className="font-display text-headline-lg-mobile text-primary">书架</h2>
        <span className="font-mono text-label-sm text-on-surface-variant">
          {loading ? "加载中…" : `共 ${projects.length} 本`}
        </span>
      </header>

      <div className="flex items-center gap-3 flex-wrap">
        <SearchInput value={search} onChange={setSearch} />
        <DropdownSelect label="题材" options={genreOptions} value={genre} onChange={setGenre} />
        <DropdownSelect label="阶段" options={STAGE_OPTIONS} value={stage} onChange={setStage} />
        <DropdownSelect label="篇幅" options={lengthOptions} value={length} onChange={setLength} />
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
            onRefresh?.();
          }}
        />
      </div>

      <div className="flex items-center gap-3">
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
      </div>

      {loading ? (
        <div className="text-center py-16 text-on-surface-variant">
          <span className="material-symbols-outlined text-3xl animate-spin">progress_activity</span>
          <div className="mt-2 font-body text-body-md">正在加载项目…</div>
        </div>
      ) : empty ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-on-surface-variant/20 mb-3 block">
            auto_stories
          </span>
          <p className="font-body text-body-md text-on-surface-variant">
            还没有项目，点击「+ 新建项目」开始
          </p>
        </div>
      ) : filteredEmpty ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-on-surface-variant/20 mb-3 block">
            search_off
          </span>
          <p className="font-body text-body-md text-on-surface-variant mb-3">未找到匹配项目</p>
          <GhostButton label="清空筛选" onClick={() => { setSearch(""); setGenre("all"); setStage("all"); setLength("all"); setFiltersApplied(false); }} />
        </div>
      ) : (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-lg overflow-hidden">
          <div className="grid grid-cols-[40px_2fr_1fr_1fr_1fr_1fr_1fr_1fr] items-center py-2 px-3 border-b border-outline-variant font-mono uppercase tracking-wider text-on-surface-variant text-sm">
            <TableCheckbox
              checked={allChecked}
              onChange={() => toggleSelectAll()}
              disabled={sorted.length === 0}
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
          {sorted.map((p) => (
            <ProjectTableRow
              key={p.id}
              project={p}
              selected={selectedIds.has(p.id)}
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
