import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PromptPlazaModal from "../../components/home/promptPlaza/PromptPlazaModal";

describe("PromptPlazaModal", () => {
  it("does not render when closed", () => {
    const { container } = render(
      <PromptPlazaModal
        isOpen={false}
        projectId="proj_x"
        projectTitle="测试"
        onClose={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders title and project name when open", () => {
    render(
      <PromptPlazaModal
        isOpen={true}
        projectId="proj_x"
        projectTitle="诡眼少年"
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("提示词广场")).toBeInTheDocument();
    expect(screen.getByText(/诡眼少年/)).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <PromptPlazaModal
        isOpen={true}
        projectId="proj_x"
        projectTitle="测试"
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /关闭/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows empty state when projectId is null", () => {
    render(
      <PromptPlazaModal
        isOpen={true}
        projectId={null}
        projectTitle={null}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/请先创建项目/)).toBeInTheDocument();
  });
});