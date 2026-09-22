import { useEffect, useState } from "react";
import api, { MapPayload, MapLocation, MapRegion, MapRoute, MapPOI, ApiMapSnapshot } from "../../api/client";
import { useWizard } from "./WizardContext";
import { PanelCard } from "../ds";
import { SubTabStrip } from "../shared/SubTabStrip";
import { MermaidMapModal } from "./MermaidMapModal";

interface MapStepProps {
  projectId: string;
}

const MAP_TABS = [
  { key: "locations", label: "地点", icon: "place" },
  { key: "regions", label: "区域", icon: "landscape" },
  { key: "routes", label: "路线", icon: "route" },
  { key: "pois", label: "POI", icon: "explore" },
  { key: "snapshots", label: "快照", icon: "history" },
] as const;
type MapTabKey = (typeof MAP_TABS)[number]["key"];

export default function MapStep({ projectId }: MapStepProps) {
  const wizard = useWizard();
  const [mapData, setMapData] = useState<MapPayload | null>(
    wizard.data.map,
  );
  const [activeKey, setActiveKey] = useState<MapTabKey>("locations");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMermaid, setShowMermaid] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (mapData) return;
    let alive = true;
    (async () => {
      const res = await api.getMap(projectId);
      if (alive && res && Object.keys(res).length > 0) {
        setMapData(res as MapPayload);
      }
    })();
    return () => { alive = false; };
  }, [projectId, mapData]);

  const handleGenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.generateMap(projectId, "");
      if (res && typeof res === "object" && "detail" in (res as Record<string, unknown>)) {
        const detail = (res as { detail: MapPayload }).detail;
        setMapData(detail);
        wizard.markStepGenerated(4, { map: detail });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!mapData) return;
    setBusy(true);
    try {
      await api.updateMap(projectId, mapData);
      wizard.saveStep(4, { map: mapData });
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  if (!mapData) {
    return (
      <div data-testid="map-step-empty" className="text-center py-12 space-y-6">
        <span className="material-symbols-outlined text-6xl text-on-surface-variant/30 block">map</span>
        <div>
          <h2 className="font-display text-primary text-xl mb-2">地图系统</h2>
          <p className="font-body text-body-md text-on-surface-variant text-sm max-w-md mx-auto">
            基于世界观自动生成初始地图(5-15 个区域 + 20-40 个地点),可在 5 个 Tab 中行内编辑。
          </p>
        </div>
        {error && (
          <p data-testid="map-error" className="text-error text-sm">{error}</p>
        )}
        <button
          data-testid="map-generate"
          onClick={handleGenerate}
          disabled={busy}
          className="px-5 py-2 bg-primary text-on-primary text-sm rounded-lg hover:bg-primary-container transition-colors disabled:opacity-50"
        >
          {busy ? "生成中…" : "基于世界观自动生成初始地图"}
        </button>
      </div>
    );
  }

  return (
    <div data-testid="map-step" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <SubTabStrip
          tabs={MAP_TABS.map(t => ({ key: t.key, label: t.label }))}
          active={activeKey}
          onChange={(k) => setActiveKey(k as MapTabKey)}
          testidPrefix="map"
        />
        <PanelCard padding="sm">
          <div className="flex gap-2">
            <button
              data-testid="map-settings"
              onClick={() => setShowSettings(true)}
              className="px-3 py-1 text-sm rounded border border-outline-variant hover:border-primary"
            >
              设定
            </button>
            <button
              data-testid="map-view-graph"
              onClick={() => setShowMermaid(true)}
              className="px-3 py-1 text-sm rounded border border-outline-variant hover:border-primary"
            >
              查看地图
            </button>
            <button
              data-testid="map-save"
              onClick={handleSave}
              disabled={busy}
              className="px-3 py-1 text-sm bg-primary text-on-primary rounded hover:bg-primary-container disabled:opacity-50"
            >
              {busy ? "保存中…" : "保存修改"}
            </button>
          </div>
        </PanelCard>
      </div>

      <div data-testid={`map-panel-${activeKey}`} className="min-h-[400px]">
        {activeKey === "locations" && (
          <LocationsPanel mapData={mapData} setMapData={setMapData} />
        )}
        {activeKey === "regions" && <RegionsPanel mapData={mapData} setMapData={setMapData} />}
        {activeKey === "routes" && <RoutesPanel mapData={mapData} setMapData={setMapData} />}
        {activeKey === "pois" && <PoisPanel mapData={mapData} setMapData={setMapData} />}
        {activeKey === "snapshots" && (
          <SnapshotsPanel
            mapData={mapData}
            setMapData={setMapData}
            setError={setError}
          />
        )}
      </div>

      <MermaidMapModal
        open={showMermaid}
        onClose={() => setShowMermaid(false)}
        mapData={mapData}
      />
      {showSettings && (
        <SettingsPanel
          mapData={mapData}
          setMapData={setMapData}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

// --- Tab panels(本 task 给出 locations 最小可渲染版,其余在后续 task 补全) ---

function LocationsPanel({
  mapData,
  setMapData,
}: {
  mapData: MapPayload;
  setMapData: (m: MapPayload) => void;
}) {
  const handleDelete = async (id: string) => {
    try {
      await api.deleteMapLocation(mapData.project_id, id);
    } catch (e) {
      // 422 LOCATION_REFERENCED_BY_ROUTES — 前端显示 modal(本 task 简化:
      // 让后端错误冒泡,后续 task 加 modal)
      throw e;
    }
    setMapData({
      ...mapData,
      locations: mapData.locations.filter(l => l.id !== id),
    });
  };

  const handlePatch = async (id: string, patch: Partial<MapLocation>) => {
    const updated = await api.patchMapLocation(mapData.project_id, id, patch);
    setMapData({
      ...mapData,
      locations: mapData.locations.map(l => (l.id === id ? updated : l)),
    });
  };

  return (
    <ul data-testid="locations-list" className="space-y-2">
      {mapData.locations.map((loc) => (
        <li
          key={loc.id}
          data-testid={`location-row-${loc.name}`}
          className="p-3 border border-outline-variant rounded space-y-2"
        >
          <div className="flex items-center justify-between">
            <div>
              <input
                data-testid={`location-name-${loc.id}`}
                defaultValue={loc.name}
                onBlur={(e) => {
                  if (e.target.value !== loc.name) {
                    handlePatch(loc.id, { name: e.target.value });
                  }
                }}
                className="font-medium bg-transparent border-b border-transparent hover:border-outline-variant focus:border-primary"
              />
              <span className="ml-2 text-xs text-on-surface-variant">
                {loc.type} · {loc.region_id ?? "无区域"}
              </span>
            </div>
            <button
              data-testid={`location-delete-${loc.id}`}
              onClick={() => handleDelete(loc.id)}
              className="text-error text-sm hover:underline"
            >
              删除
            </button>
          </div>
          {loc.pos_hint && (
            <p className="text-xs text-on-surface-variant">{loc.pos_hint}</p>
          )}
          <p className="text-xs">
            <span className="font-semibold">想来的：</span>
            <span>{loc.dramatic_role.wanted_by.join("、") || "（无）"}</span>
            {" · "}
            <span className="font-semibold">离开代价：</span>
            <span>{loc.dramatic_role.departure_cost || "（无）"}</span>
            {" · "}
            <span className="font-semibold">解锁决策：</span>
            <span>{loc.dramatic_role.decisions_unlocked.join("、") || "（无）"}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

function RegionsPanel({
  mapData,
  setMapData,
}: {
  mapData: MapPayload;
  setMapData: (m: MapPayload) => void;
}) {
  const handleAdd = async () => {
    const name = prompt("新区域名:") ?? "";
    if (!name) return;
    const created = await api.addMapRegion(mapData.project_id, { name });
    setMapData({ ...mapData, regions: [...mapData.regions, created] });
  };
  const handlePatch = async (id: string, patch: Partial<MapRegion>) => {
    const updated = await api.patchMapRegion(mapData.project_id, id, patch);
    setMapData({
      ...mapData,
      regions: mapData.regions.map(r => (r.id === id ? updated : r)),
    });
  };
  return (
    <div className="space-y-2">
      <button
        data-testid="region-add"
        onClick={handleAdd}
        className="px-3 py-1 text-sm bg-primary text-on-primary rounded"
      >
        + 添加区域
      </button>
      <ul data-testid="regions-list" className="space-y-2">
        {mapData.regions.map((r) => (
          <li key={r.id} className="p-3 border border-outline-variant rounded">
            <input
              defaultValue={r.name}
              onBlur={(e) => {
                if (e.target.value !== r.name) handlePatch(r.id, { name: e.target.value });
              }}
              className="font-medium bg-transparent border-b border-transparent hover:border-outline-variant"
            />
            <span className="ml-2 text-xs text-on-surface-variant">{r.level}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoutesPanel({
  mapData,
  setMapData,
}: {
  mapData: MapPayload;
  setMapData: (m: MapPayload) => void;
}) {
  const handleAdd = async () => {
    if (mapData.locations.length < 2) {
      alert("至少需要 2 个 location 才能新增 route");
      return;
    }
    const from = prompt(`起点 location id (${mapData.locations.map(l => l.id).join(", ")})`) ?? "";
    const to = prompt(`终点 location id`) ?? "";
    if (!from || !to) return;
    const minutes = parseInt(prompt("耗时 (分钟):") ?? "30", 10);
    const created = await api.addMapRoute(mapData.project_id, {
      from,
      to,
      est_travel_minutes: minutes,
    });
    setMapData({ ...mapData, routes: [...mapData.routes, created] });
  };
  const handleDelete = async (id: string) => {
    await api.deleteMapRoute(mapData.project_id, id);
    setMapData({
      ...mapData,
      routes: mapData.routes.filter(r => r.id !== id),
    });
  };
  return (
    <div className="space-y-2">
      <button
        data-testid="route-add"
        onClick={handleAdd}
        className="px-3 py-1 text-sm bg-primary text-on-primary rounded"
      >
        + 添加路线
      </button>
      <ul data-testid="routes-list" className="space-y-2">
        {mapData.routes.map((rt) => (
          <li key={rt.id} className="p-3 border border-outline-variant rounded flex justify-between">
            <span className="font-mono text-sm">
              {rt.from} → {rt.to}
            </span>
            <span className="ml-2 text-xs text-on-surface-variant">
              {rt.est_travel_minutes}min · {rt.risk}
            </span>
            <button
              data-testid={`route-delete-${rt.id}`}
              onClick={() => handleDelete(rt.id)}
              className="text-error text-sm hover:underline"
            >
              删除
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PoisPanel({
  mapData,
  setMapData,
}: {
  mapData: MapPayload;
  setMapData: (m: MapPayload) => void;
}) {
  const handleAdd = async () => {
    if (mapData.locations.length === 0) {
      alert("至少需要 1 个 location 才能新增 POI");
      return;
    }
    const name = prompt("POI 名:") ?? "";
    const parentId = prompt(`父 location id (${mapData.locations.map(l => l.id).join(", ")})`) ?? "";
    if (!name || !parentId) return;
    const created = await api.addMapPoi(mapData.project_id, {
      name,
      parent_location_id: parentId,
    });
    setMapData({ ...mapData, pois: [...mapData.pois, created] });
  };
  const handleDelete = async (id: string) => {
    await api.deleteMapPoi(mapData.project_id, id);
    setMapData({
      ...mapData,
      pois: mapData.pois.filter(p => p.id !== id),
    });
  };
  return (
    <div className="space-y-2">
      <button
        data-testid="poi-add"
        onClick={handleAdd}
        className="px-3 py-1 text-sm bg-primary text-on-primary rounded"
      >
        + 添加 POI
      </button>
      <ul data-testid="pois-list" className="space-y-2">
        {mapData.pois.map((p) => (
          <li key={p.id} className="p-3 border border-outline-variant rounded flex justify-between">
            <span className="font-medium">{p.name}</span>
            <span className="ml-2 text-xs text-on-surface-variant">{p.kind}</span>
            {!p.discoverable && <span className="ml-2 text-xs text-error">[未发现]</span>}
            <button
              data-testid={`poi-delete-${p.id}`}
              onClick={() => handleDelete(p.id)}
              className="text-error text-sm hover:underline"
            >
              删除
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SnapshotsPanel({
  mapData,
  setMapData,
  setError,
}: {
  mapData: MapPayload;
  setMapData: (m: MapPayload) => void;
  setError: (e: string | null) => void;
}) {
  const [snapshots, setSnapshots] = useState<ApiMapSnapshot[]>([]);
  const [rollbackTarget, setRollbackTarget] = useState<ApiMapSnapshot | null>(null);
  const [rolling, setRolling] = useState(false);

  const fetchSnapshots = async () => {
    try {
      const items = await api.getMapSnapshots(mapData.project_id);
      setSnapshots(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载快照失败");
    }
  };

  useEffect(() => {
    fetchSnapshots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapData.project_id]);

  const handleRollbackConfirm = async () => {
    if (!rollbackTarget) return;
    setRolling(true);
    try {
      await api.rollbackMap(mapData.project_id, rollbackTarget.chapter);
      setRollbackTarget(null);
      // Refetch current map.json so changes propagate
      const fresh = await api.getMap(mapData.project_id);
      if (fresh && Object.keys(fresh).length > 0) {
        setMapData(fresh as MapPayload);
      }
      await fetchSnapshots();
    } catch (e) {
      setError(e instanceof Error ? e.message : "回滚失败");
    } finally {
      setRolling(false);
    }
  };

  return (
    <div data-testid="snapshots-panel" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">章节快照</h3>
        <button
          data-testid="snapshots-refresh"
          onClick={fetchSnapshots}
          className="px-3 py-1 text-sm border border-outline-variant rounded"
        >
          刷新
        </button>
      </div>
      {snapshots.length === 0 ? (
        <p className="text-sm text-on-surface-variant">暂无快照</p>
      ) : (
        <ul data-testid="snapshots-list" className="space-y-2">
          {snapshots.map((s) => (
            <li
              key={s.chapter}
              data-testid={`snapshot-row-${s.chapter}`}
              className="p-3 border border-outline-variant rounded flex items-center gap-3"
            >
              <span className="font-mono text-sm">第 {s.chapter} 章</span>
              <span className="text-xs text-on-surface-variant">{s.snapshot_hash}</span>
              <span className="text-xs">
                {s.locations_count} 地 / {s.routes_count} 路
              </span>
              <span className="text-xs text-on-surface-variant ml-auto">
                {s.created_at}
              </span>
              <button
                data-testid={`rollback-${s.chapter}`}
                onClick={() => setRollbackTarget(s)}
                className="px-3 py-1 text-sm text-error hover:underline"
              >
                回滚
              </button>
            </li>
          ))}
        </ul>
      )}
      {rollbackTarget && (
        <div
          data-testid="rollback-confirm-backdrop"
          onClick={() => !rolling && setRollbackTarget(null)}
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
        >
          <div
            data-testid="rollback-confirm-modal"
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-container rounded-lg shadow-xl p-6 max-w-md w-full space-y-3"
          >
            <h4 className="font-medium">确认回滚到第 {rollbackTarget.chapter} 章?</h4>
            <p className="text-sm text-on-surface-variant">
              当前 map.json 将被覆盖。原版仍保留在 map_snapshots/chapter_{rollbackTarget.chapter}.json。
            </p>
            <div className="flex gap-2 justify-end">
              <button
                data-testid="rollback-cancel"
                onClick={() => setRollbackTarget(null)}
                disabled={rolling}
                className="px-3 py-1 text-sm border border-outline-variant rounded disabled:opacity-50"
              >
                取消
              </button>
              <button
                data-testid="rollback-confirm"
                onClick={handleRollbackConfirm}
                disabled={rolling}
                className="px-3 py-1 text-sm bg-primary text-on-primary rounded disabled:opacity-50"
              >
                {rolling ? "回滚中…" : "确认回滚"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsPanel({
  mapData,
  setMapData,
  onClose,
}: {
  mapData: MapPayload;
  setMapData: (m: MapPayload) => void;
  onClose: () => void;
}) {
  const [strictGeo, setStrictGeo] = useState(mapData.settings.strict_geo);
  const [cap, setCap] = useState(mapData.settings.chapter_new_location_cap);
  const [mode, setMode] = useState(mapData.settings.mode);

  const handleSave = async () => {
    const updated = await api.patchMapSettings(mapData.project_id, {
      strict_geo: strictGeo,
      chapter_new_location_cap: cap,
      mode,
    });
    setMapData({
      ...mapData,
      settings: { ...mapData.settings, ...updated },
    });
    onClose();
  };

  return (
    <div
      data-testid="settings-backdrop"
      onClick={onClose}
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
    >
      <div
        data-testid="settings-modal"
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-container rounded-lg shadow-xl p-6 max-w-md w-full"
      >
        <h2 className="text-lg font-medium mb-4">地图设定</h2>
        <div className="space-y-4">
          <label className="flex items-center gap-2">
            <input
              data-testid="settings-strict-geo"
              type="checkbox"
              checked={strictGeo}
              onChange={(e) => setStrictGeo(e.target.checked)}
            />
            <span className="text-sm">strict_geo 模式(Stage 4 启动时 map 缺失则硬阻断)</span>
          </label>
          <label className="block">
            <span className="text-sm">每章新增地点上限</span>
            <input
              data-testid="settings-cap"
              type="number"
              min={1}
              max={20}
              value={cap}
              onChange={(e) => setCap(parseInt(e.target.value, 10) || 5)}
              className="ml-2 w-20 border rounded px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="text-sm">新地点处理模式</span>
            <select
              data-testid="settings-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
              className="ml-2 border rounded px-2 py-1"
            >
              <option value="strict_geo">strict_geo</option>
              <option value="allow_alias_new">allow_alias_new</option>
              <option value="freeze_locations">freeze_locations</option>
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button
            data-testid="settings-cancel"
            onClick={onClose}
            className="px-3 py-1 text-sm border border-outline-variant rounded"
          >
            取消
          </button>
          <button
            data-testid="settings-save"
            onClick={handleSave}
            className="px-3 py-1 text-sm bg-primary text-on-primary rounded"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}