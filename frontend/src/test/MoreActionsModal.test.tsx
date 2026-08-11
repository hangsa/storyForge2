import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import MoreActionsModal from "../components/home/MoreActionsModal";

const STORAGE_KEY = "storyforge.theme";

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  document.documentElement.classList.remove("light");
});

describe("MoreActionsModal", () => {
  it("renders with title '更多' and a close button", () => {
    render(<MoreActionsModal onClose={() => {}} />);
    expect(screen.getByText("更多")).toBeInTheDocument();
    expect(screen.getByTestId("more-actions-close")).toBeInTheDocument();
  });

  it("renders 2 theme options: dark and light", () => {
    render(<MoreActionsModal onClose={() => {}} />);
    expect(screen.getByTestId("theme-option-dark")).toBeInTheDocument();
    expect(screen.getByTestId("theme-option-light")).toBeInTheDocument();
  });

  it("marks 'dark' as the selected option by default", () => {
    render(<MoreActionsModal onClose={() => {}} />);
    expect(screen.getByTestId("theme-option-dark").getAttribute("data-selected")).toBe("true");
    expect(screen.getByTestId("theme-option-light").getAttribute("data-selected")).toBe("false");
  });

  it("marks 'light' as selected when localStorage already has 'light'", () => {
    localStorage.setItem(STORAGE_KEY, "light");
    render(<MoreActionsModal onClose={() => {}} />);
    expect(screen.getByTestId("theme-option-light").getAttribute("data-selected")).toBe("true");
    expect(screen.getByTestId("theme-option-dark").getAttribute("data-selected")).toBe("false");
  });

  it("clicking 'light' applies the .light class to <html> and persists to localStorage", () => {
    render(<MoreActionsModal onClose={() => {}} />);
    act(() => {
      screen.getByTestId("theme-option-light").click();
    });
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");
  });

  it("clicking 'dark' removes the .light class and persists 'dark'", () => {
    localStorage.setItem(STORAGE_KEY, "light");
    document.documentElement.classList.add("light");
    render(<MoreActionsModal onClose={() => {}} />);
    act(() => {
      screen.getByTestId("theme-option-dark").click();
    });
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
  });

  it("clicking the close button calls onClose", () => {
    const onClose = vi.fn();
    render(<MoreActionsModal onClose={onClose} />);
    act(() => {
      screen.getByTestId("more-actions-close").click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("selection is exclusive — clicking one deselects the other", () => {
    render(<MoreActionsModal onClose={() => {}} />);
    act(() => {
      screen.getByTestId("theme-option-light").click();
    });
    expect(screen.getByTestId("theme-option-light").getAttribute("data-selected")).toBe("true");
    expect(screen.getByTestId("theme-option-dark").getAttribute("data-selected")).toBe("false");
    act(() => {
      screen.getByTestId("theme-option-dark").click();
    });
    expect(screen.getByTestId("theme-option-dark").getAttribute("data-selected")).toBe("true");
    expect(screen.getByTestId("theme-option-light").getAttribute("data-selected")).toBe("false");
  });
});