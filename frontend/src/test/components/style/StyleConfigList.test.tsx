import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StyleConfigList from "../../../components/style/StyleConfigList";
import type { SavedStyleConfig } from "../../../api/client";
import { DEFAULT_SANDBOX_PARAMS } from "../../../api/client";

const CFG: SavedStyleConfig = {
  name: "快节奏 v1", path: "/tmp/x.yaml",
  params: DEFAULT_SANDBOX_PARAMS, created_at: "2026-06-29T10:00:00Z",
};

describe("StyleConfigList", () => {
  it("renders each config name", () => {
    render(<StyleConfigList configs={[CFG]} onLoad={() => {}} />);
    expect(screen.getByText("快节奏 v1")).toBeInTheDocument();
  });

  it("renders the empty state when no configs", () => {
    render(<StyleConfigList configs={[]} onLoad={() => {}} />);
    expect(screen.getByText(/暂无已保存/)).toBeInTheDocument();
  });

  it("invokes onLoad with the clicked config", async () => {
    const onLoad = vi.fn();
    render(<StyleConfigList configs={[CFG]} onLoad={onLoad} />);
    await userEvent.click(screen.getByText("快节奏 v1"));
    expect(onLoad).toHaveBeenCalledWith(CFG);
  });
});
