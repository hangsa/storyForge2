import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BulkDeleteModal from "../../components/home/BulkDeleteModal";

describe("BulkDeleteModal", () => {
  it("does not render when isOpen is false", () => {
    render(
      <BulkDeleteModal
        isOpen={false}
        selectedIds={["p1"]}
        selectedTitles={["书 A"]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.queryByText(/确定要删除以下/)).not.toBeInTheDocument();
  });

  it("renders the count and a truncated list when isOpen is true", () => {
    render(
      <BulkDeleteModal
        isOpen
        selectedIds={["p1", "p2", "p3"]}
        selectedTitles={["书 A", "书 B", "书 C"]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText(/确定要删除以下 3 个项目/)).toBeInTheDocument();
    expect(screen.getByText("书 A")).toBeInTheDocument();
    expect(screen.getByText("书 B")).toBeInTheDocument();
    expect(screen.getByText("书 C")).toBeInTheDocument();
  });

  it("caps the visible list at 10 entries and shows the overflow count", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const titles = Array.from({ length: 12 }, (_, i) => `书 ${i}`);
    render(
      <BulkDeleteModal
        isOpen
        selectedIds={ids}
        selectedTitles={titles}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText(/还有 2 个/)).toBeInTheDocument();
  });

  it("fires onConfirm when the destructive button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <BulkDeleteModal
        isOpen
        selectedIds={["p1"]}
        selectedTitles={["书 A"]}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("fires onCancel when the cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(
      <BulkDeleteModal
        isOpen
        selectedIds={["p1"]}
        selectedTitles={["书 A"]}
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
