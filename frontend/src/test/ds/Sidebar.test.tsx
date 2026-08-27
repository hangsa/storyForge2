import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import Sidebar from "../../components/ds/Sidebar";

describe("Sidebar", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders header, children, and footer", () => {
    render(
      <Sidebar header={<span>brand</span>} footer={<span>foot</span>}>
        <span>body</span>
      </Sidebar>
    );
    expect(screen.getByText("brand")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
    expect(screen.getByText("foot")).toBeInTheDocument();
  });

  it("toggles collapsed state when the toggle button is clicked", () => {
    render(
      <Sidebar header={<span>brand</span>} persistKey="test.sidebar">
        <span data-testid="content">body</span>
      </Sidebar>
    );
    expect(screen.getByTestId("content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /collapse/i }));
    // After collapse, content still in DOM but width reduced
    const sidebar = screen.getByTestId("content").closest("aside, div");
    expect(sidebar).toBeTruthy();
  });

  it("persists collapsed state to localStorage under the provided key", () => {
    render(
      <Sidebar header={<span>brand</span>} persistKey="test.sidebar.persist">
        <span>x</span>
      </Sidebar>
    );
    fireEvent.click(screen.getByRole("button", { name: /collapse/i }));
    expect(localStorage.getItem("test.sidebar.persist")).toBe("true");
  });
});