import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { WizardProvider, useWizard } from "../components/wizard/WizardContext";
import MapStep from "../components/wizard/MapStep";

beforeEach(() => {
  sessionStorage.clear();
});

describe("MapStep", () => {
  it("renders placeholder copy and only '跳过' is enabled", () => {
    render(
      <WizardProvider projectId="proj_x">
        <MapStep />
      </WizardProvider>
    );
    expect(screen.getByTestId("map-step")).toBeInTheDocument();
    expect(screen.getByText(/地图系统.*即将推出|功能即将推出/)).toBeInTheDocument();
    expect(screen.getByTestId("map-skip")).toBeInTheDocument();
    expect(screen.queryByTestId("map-start")).not.toBeInTheDocument();
  });

  it("clicking '跳过' marks step as skipped and advances to step 5", () => {
    function Harness() {
      const wizard = useWizard();
      return (
        <>
          <MapStep />
          <span data-testid="cur">{wizard.currentStep}</span>
          <span data-testid="done">{wizard.completedSteps.join(",")}</span>
        </>
      );
    }
    render(
      <WizardProvider projectId="proj_x">
        <Harness />
      </WizardProvider>
    );
    act(() => screen.getByTestId("map-skip").click());
    expect(screen.getByTestId("cur").textContent).toBe("5");
    expect(screen.getByTestId("done").textContent).toBe("4");
  });
});