import { Outlet } from "react-router-dom";

// The 创意画布 tab was removed on 2026-09-02 while the feature is being
// refactored (see docs/design/creative-canvas-module.md). The /stage1/canvas
// route is kept in App.tsx only as a <Navigate> redirect so any stale links
// land back on /stage1. When the refactor lands, re-introduce the tab and
// the canvas route here.

export default function Stage1Layout() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-5 space-y-3">
      {/* Page title — matches STAGE2 header placement */}
      <div>
        <h1 className="text-3xl font-bold text-primary-container">概念讨论</h1>
        <p className="font-body-ui text-system-log mt-0.5 text-sm">
          生成故事概念与核心矛盾，构建小说的叙事基础
        </p>
      </div>

      {/* Child page content */}
      <Outlet />
    </div>
  );
}
