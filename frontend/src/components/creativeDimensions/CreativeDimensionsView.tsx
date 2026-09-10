import { useEffect, useMemo, useState } from "react";
import api from "@/api/client";
import type { ActiveDimensions, DimensionEntry, DimensionEntryPayload, DimensionKind } from "@/api/types";
import DimensionTabs from "./DimensionTabs";
import EntryEditPanel from "./EntryEditPanel";
import { PrimaryButton, SearchInput } from "@/components/ds";

interface Props {
  onClose: () => void;
}

const LABELS: Record<DimensionKind, string> = { subject: "题材", tone: "基调", style: "风格" };

export default function CreativeDimensionsView({ onClose }: Props) {
  const [data, setData] = useState<ActiveDimensions | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [activeKind, setActiveKind] = useState<DimensionKind>("subject");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ kind: DimensionKind; entry: DimensionEntry | null } | null>(null);

  const refresh = async () => {
    setLoading(true);
    setErr(null);
    try {
      const d = await api.listAllCreativeDimensions();
      setData(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const counts = useMemo(() => {
    const c: Record<DimensionKind, { active: number; total: number }> = {
      subject: { active: 0, total: 0 },
      tone:    { active: 0, total: 0 },
      style:   { active: 0, total: 0 },
    };
    if (!data) return c;
    (["subject", "tone", "style"] as DimensionKind[]).forEach((k) => {
      c[k].total = data[k].length;
      c[k].active = data[k].filter((e) => e.status === "active").length;
    });
    return c;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const items = data[activeKind];
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((e) =>
      e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)
    );
  }, [data, activeKind, search]);

  const handleSave = async (payload: DimensionEntryPayload) => {
    if (!editing) return;
    if (editing.entry) {
      await api.updateCreativeDimension(editing.kind, editing.entry.id, payload);
    } else {
      await api.addCreativeDimension(editing.kind, payload);
    }
    setEditing(null);
    await refresh();
  };

  const handleDelete = async () => {
    if (!editing?.entry) return;
    await api.deleteCreativeDimension(editing.kind, editing.entry.id);
    setEditing(null);
    await refresh();
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
      <header className="flex items-center justify-between border-b border-outline-variant px-6 py-4">
        <h2 className="font-display text-xl text-primary">创作维度</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          data-testid="dimensions-close"
          className="text-on-surface-variant hover:text-primary"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </header>

      {err && (
        <div className="mx-6 mt-3 p-2 bg-error/10 border border-error/30 rounded text-error text-xs">
          {err}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-56 border-r border-outline-variant p-3">
          <DimensionTabs active={activeKind} onChange={setActiveKind} counts={counts} />
        </aside>
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-6 py-3 border-b border-outline-variant">
            <SearchInput value={search} onChange={setSearch} placeholder="搜索名称或特征" />
            <span data-testid="dimensions-add">
              <PrimaryButton label="+ 新增" onClick={() => setEditing({ kind: activeKind, entry: null })} />
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="text-on-surface-variant text-sm">加载中…</div>
            ) : filtered.length === 0 ? (
              <div className="text-on-surface-variant text-sm">
                {LABELS[activeKind]} 暂无条目
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-on-surface-variant">
                    <th className="pb-2">名称</th>
                    <th className="pb-2">状态</th>
                    <th className="pb-2">特征</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr
                      key={e.id}
                      onClick={() => setEditing({ kind: activeKind, entry: e })}
                      className="border-t border-outline-variant hover:bg-surface-container cursor-pointer"
                      data-testid={`row-${e.id}`}
                    >
                      <td className="py-2 text-sm text-primary">{e.name}</td>
                      <td className="py-2 text-sm">
                        <span
                          className={`inline-block w-2 h-2 rounded-full mr-2 ${
                            e.status === "active" ? "bg-green-500" : "bg-gray-400"
                          }`}
                        />
                        {e.status === "active" ? "生效" : "失效"}
                      </td>
                      <td className="py-2 text-sm text-on-surface-variant truncate max-w-md">
                        {e.description.slice(0, 50)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </main>
      </div>

      {editing && (
        <EntryEditPanel
          kind={editing.kind}
          entry={editing.entry}
          onSave={handleSave}
          onDelete={editing.entry ? handleDelete : undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
