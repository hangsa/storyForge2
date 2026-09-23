import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import type { MapPayload } from "../../api/client";

interface MermaidMapModalProps {
  open: boolean;
  onClose: () => void;
  mapData: MapPayload;
}

export function buildMermaidSyntax(mapData: MapPayload): string {
  const lines: string[] = ["graph TD"];
  // subgraphs
  const regionMap = new Map<string, string[]>();
  for (const loc of mapData.locations) {
    const regionId = loc.region_id ?? "_orphan";
    if (!regionMap.has(regionId)) regionMap.set(regionId, []);
    regionMap.get(regionId)!.push(loc.id);
  }
  for (const [regionId, locIds] of regionMap) {
    const region = mapData.regions.find(r => r.id === regionId);
    const regionName = region?.name ?? "无区域";
    // region.id is regex-safe (^region_[a-z0-9_]+$) — use as Mermaid ID.
    // region.name may contain CJK + special chars (e.g. · U+00B7) — pass as display label.
    const safeRegionName = regionName.replace(/"/g, '\\"').replace(/\]/g, '\\]');
    lines.push(`  subgraph ${regionId}["${safeRegionName}"]`);
    for (const locId of locIds) {
      const loc = mapData.locations.find(l => l.id === locId)!;
      const safeName = loc.name.replace(/"/g, '\\"').replace(/\]/g, '\\]');
      lines.push(`    ${loc.id}["${safeName}"]`);
    }
    lines.push("  end");
  }
  // edges
  for (const route of mapData.routes) {
    const label = `${route.est_travel_minutes}min ${route.risk}`;
    lines.push(`  ${route.from} -->|${label}| ${route.to}`);
  }
  return lines.join("\n");
}

mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });

export function MermaidMapModal({ open, onClose, mapData }: MermaidMapModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const syntax = buildMermaidSyntax(mapData);
    mermaid.render("mermaid-svg", syntax)
      .then(({ svg }) => {
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      })
      .catch(e => setError(String(e)));
  }, [open, mapData]);

  if (!open) return null;

  return (
    <div
      data-testid="mermaid-backdrop"
      onClick={onClose}
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
    >
      <div
        data-testid="mermaid-modal"
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-container rounded-lg shadow-xl p-6 max-w-4xl w-full max-h-[80vh] overflow-auto"
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-medium">地图拓扑</h2>
          <button
            data-testid="mermaid-close"
            onClick={onClose}
            className="text-on-surface-variant hover:text-on-surface"
          >
            关闭
          </button>
        </div>
        {error && (
          <p data-testid="mermaid-error" className="text-error text-sm">
            渲染失败: {error}
          </p>
        )}
        <div ref={containerRef} data-testid="mermaid-container" />
      </div>
    </div>
  );
}
