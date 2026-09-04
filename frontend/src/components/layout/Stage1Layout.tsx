import { Outlet } from "react-router-dom";

export default function Stage1Layout() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-5 space-y-3">
      <div>
        <h1 className="font-headline-lg text-headline-lg font-bold text-on-surface">
          Stage 1 — 概念
        </h1>
        <p className="text-sm text-on-surface-variant">
          从一个 Idea 出发，生成你的故事核心。
        </p>
      </div>
      <Outlet />
    </div>
  );
}
