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

  it("clicking '跳过' marks the current step as skipped and advances", () => {
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
    // v2.x: MapStep is step 5 in the 7-step wizard (legacy 6-step had it on
    // step 4). Pre-seed sessionStorage so the modal lands on step 5.
    sessionStorage.setItem(
      "storyforge.wizard.state.proj_x",
      JSON.stringify({
        currentStep: 5,
        completedSteps: [1, 2, 3, 4],
        status: "idle",
        data: {},
        errorMessage: null,
      }),
    );
    render(
      <WizardProvider projectId="proj_x">
        <Harness />
      </WizardProvider>
    );
    act(() => screen.getByTestId("map-skip").click());
    expect(screen.getByTestId("cur").textContent).toBe("6");
    expect(screen.getByTestId("done").textContent).toBe("1,2,3,4,5");
  });
});