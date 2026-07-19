import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PromptPlazaModal from "../../components/home/promptPlaza/PromptPlazaModal";

// Stub the heavy sub-panels — we only care about modal-level title/subtitle here.
vi.mock("../../components/home/promptPlaza/PromptListPanel", () => ({
  default: () => <div data-testid="prompt-list-panel" />,
}));
vi.mock("../../components/home/promptPlaza/PromptEditPanel", () => ({
  default: () => <div data-testid="prompt-edit-panel" />,
}));

// vi.mock factory is hoisted to the top of the file, so the stub object has to
// live inside a vi.hoisted() block — referencing a regular `const` triggers a
// TDZ ReferenceError when the factory runs.
const apiStub = vi.hoisted(() => ({
  listPlazaPrompts: vi.fn(),
  getPlazaPrompt: vi.fn(),
  putPlazaPrompt: vi.fn(),
  deletePlazaPrompt: vi.fn(),
  listDefaultPrompts: vi.fn(),
  getDefaultPrompt: vi.fn(),
  putDefaultPrompt: vi.fn(),
  deleteDefaultPrompt: vi.fn(),
}));

vi.mock("../../api/promptPlaza", () => apiStub);

beforeEach(() => {
  Object.values(apiStub).forEach((fn) => {
    fn.mockReset();
    fn.mockResolvedValue([]);
  });
});

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

  it("renders title and project name when open (project mode)", () => {
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
    // Default-mode title should NOT appear
    expect(screen.queryByText("默认提示词")).not.toBeInTheDocument();
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

  it("renders '默认提示词' title and no project header when projectId is null (default mode)", () => {
    render(
      <PromptPlazaModal
        isOpen={true}
        projectId={null}
        projectTitle={null}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("默认提示词")).toBeInTheDocument();
    // No project header in default mode
    expect(screen.queryByText(/^项目：/)).not.toBeInTheDocument();
    // Project-mode title should NOT appear
    expect(screen.queryByText("提示词广场")).not.toBeInTheDocument();
  });
});
