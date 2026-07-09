import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ConsistencyWarnings from "../../../components/stage2/ConsistencyWarnings";
import type { ConsistencyWarning } from "../../../api/client";

const WARN: ConsistencyWarning = {
  rule_id: "tight_spacing", severity: "warning", stage_index: 1,
  chapter_number: 4, message: "间隔太近", suggestion: "拉大",
};
const ERR: ConsistencyWarning = {
  rule_id: "out_of_range", severity: "error", stage_index: 0,
  chapter_number: 50, message: "超出范围", suggestion: null,
};

describe("ConsistencyWarnings", () => {
  it("renders the empty state when no warnings", () => {
    render(<ConsistencyWarnings warnings={[]} />);
    expect(screen.getByText(/暂无.*警告/)).toBeInTheDocument();
  });

  it("renders error and warning with distinct icons", () => {
    render(<ConsistencyWarnings warnings={[ERR, WARN]} />);
    expect(screen.getByText("超出范围")).toBeInTheDocument();
    expect(screen.getByText("间隔太近")).toBeInTheDocument();
    expect(screen.getByText(/建议：拉大/)).toBeInTheDocument();
  });

  it("groups warnings by severity (errors first)", () => {
    const { container } = render(<ConsistencyWarnings warnings={[WARN, ERR]} />);
    const items = container.querySelectorAll("[data-severity]");
    expect(items[0].getAttribute("data-severity")).toBe("error");
    expect(items[1].getAttribute("data-severity")).toBe("warning");
  });
});
