import { useEffect, useState } from "react";
import api, { MapPayload, MapLocation, MapRegion, MapRoute, MapPOI } from "../../api/client";
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
        {activeKey === "snapshots" && <SnapshotsPanel mapData={mapData} />}
      </div>

      <MermaidMapModal
        open={showMermaid}
        onClose={() => setShowMermaid(false)}
        mapData={mapData}
      />
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

function SnapshotsPanel({ mapData }: { mapData: MapPayload }) {
  return (
    <ul data-testid="snapshots-list" className="space-y-2">
      {mapData.snapshots.length === 0 && (
        <li className="text-sm text-on-surface-variant">暂无快照</li>
      )}
      {mapData.snapshots.map(s => (
        <li key={s.chapter} className="p-3 border border-outline-variant rounded">
          第 {s.chapter} 章 · hash={s.map_hash.slice(0, 12)}…
        </li>
      ))}
    </ul>
  );
}