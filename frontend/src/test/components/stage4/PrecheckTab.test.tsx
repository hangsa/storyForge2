import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PrecheckTab from "../../../components/stage4/PrecheckTab";
import type { PrecheckResult } from "../../../api/client";

describe("PrecheckTab", () => {
  it("rendersSuggestionCards", () => {
    const data: PrecheckResult = {
      precheck_passed: false, tokens_used: 100,
      suggestions: [
        { event_type: "character_location_change", location_hint: "第 3 段", suggested_tag: "<!-- SF_LOG ... -->", reason: "未声明位置变化" },
      ],
    };
    render(<PrecheckTab data={data} loading={false} error={null} />);
    expect(screen.getByText(/character_location_change/)).toBeInTheDocument();
    expect(screen.getByText(/第 3 段/)).toBeInTheDocument();
    expect(screen.getByText(/未声明位置变化/)).toBeInTheDocument();
  });

  it("emptyData_rendersEmptyString", () => {
    render(<PrecheckTab data={{ precheck_passed: true, suggestions: [], tokens_used: 0 }} loading={false} error={null} />);
    expect(screen.getByText(/本次写作无需补充标记/)).toBeInTheDocument();
  });

  it("skippedReason_rendersInfoNoteNotError", () => {
    render(<PrecheckTab data={{ precheck_passed: true, suggestions: [], tokens_used: 0, skipped_reason: "no router" }} loading={false} error={null} />);
    expect(screen.getByText(/预检已跳过：no router/)).toBeInTheDocument();
  });
});
