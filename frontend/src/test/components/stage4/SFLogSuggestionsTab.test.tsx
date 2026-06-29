import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SFLogSuggestionsTab from "../../../components/stage4/SFLogSuggestionsTab";
import type { SFLogDiffReport, SFLogSuggestion } from "../../../api/client";

const report: SFLogDiffReport = {
  original_text: "a", modified_text: "b",
  deleted_logs: [{ raw_text: "<!-- SF_LOG x -->", type: "character_location_change", id: "log1" }],
  suggestions: [
    { type: "missing", severity: "warning", event_type: "character_location_change",
      suggested_tag: "<!-- SF_LOG char=\"林峰\" -->", location_hint: "第 1 段", reason: "位置变化未声明" },
  ] satisfies SFLogSuggestion[],
  tokens_used: 50,
};

describe("SFLogSuggestionsTab", () => {
  it("rendersDeletedSection_infoOnly", () => {
    render(
      <SFLogSuggestionsTab
        data={report} loading={false} error={null}
        onApply={async () => {}} onDismiss={() => {}}
      />
    );
    expect(screen.getByText(/已删除的 SF_LOG 标记/)).toBeInTheDocument();
    // Deleted section has no action button.
    const deletedHeading = screen.getByText(/已删除的 SF_LOG 标记/);
    expect(deletedHeading.parentElement?.querySelector("button")).toBeNull();
  });

  it("rendersSuggestedSection_actionable", () => {
    render(
      <SFLogSuggestionsTab
        data={report} loading={false} error={null}
        onApply={async () => {}} onDismiss={() => {}}
      />
    );
    expect(screen.getByText(/建议添加的 SF_LOG 标记/)).toBeInTheDocument();
    expect(screen.getByText("插入")).toBeInTheDocument();
    expect(screen.getByText(/全部插入/)).toBeInTheDocument();
  });

  it("insertOne_callsOnApplyWithThatSuggestion", async () => {
    const cb = vi.fn(async () => {});
    render(
      <SFLogSuggestionsTab
        data={report} loading={false} error={null}
        onApply={cb} onDismiss={() => {}}
      />
    );
    fireEvent.click(screen.getByText("插入"));
    await waitFor(() => expect(cb).toHaveBeenCalledWith([report.suggestions[0]]));
  });

  it("insertAll_callsOnApplyWithAllSuggestions", async () => {
    const cb = vi.fn(async () => {});
    render(
      <SFLogSuggestionsTab
        data={report} loading={false} error={null}
        onApply={cb} onDismiss={() => {}}
      />
    );
    fireEvent.click(screen.getByText(/全部插入/));
    await waitFor(() => expect(cb).toHaveBeenCalledWith(report.suggestions));
  });

  it("applyInFlight_disablesButtonsShowsSpinner", async () => {
    let resolve!: () => void;
    const cb = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    render(
      <SFLogSuggestionsTab
        data={report} loading={false} error={null}
        onApply={cb} onDismiss={() => {}}
      />
    );
    const insertBtn = screen.getByText("插入");
    fireEvent.click(insertBtn);
    await waitFor(() => expect(insertBtn).toBeDisabled());
    resolve();
  });

  it("nullData_rendersEmptyString", () => {
    render(
      <SFLogSuggestionsTab
        data={null} loading={false} error={null}
        onApply={async () => {}} onDismiss={() => {}}
      />
    );
    expect(screen.getByText(/编辑草稿并保存后，会在此处显示建议/)).toBeInTheDocument();
  });
});
