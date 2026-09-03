import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "@/components/creative-canvas/EmptyState";

describe("EmptyState", () => {
  it("renders PRD §11.2 copy", () => {
    render(<EmptyState />);
    expect(screen.getByText(/创造一个故事/)).toBeInTheDocument();
    expect(screen.getByText(/你脑子里现在有什么/)).toBeInTheDocument();
  });

  it("renders init form (textarea + genre select + button)", () => {
    render(<EmptyState onInit={(prompt, genre) => {}} />);
    expect(screen.getByPlaceholderText(/一个关于|用一句话/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /开始|初始化/ })).toBeInTheDocument();
  });
});
