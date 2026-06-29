import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import Stage4Drawer from "../../../components/stage4/Stage4Drawer";

const counts = { precheck: 0, impact: 0, exemption: 0, sfLogSuggestions: 0 };
const children = {
  precheck: <div />, impact: <div />, exemption: <div />, sfLogSuggestions: <div />,
};

describe("Stage4Drawer a11y", () => {
  it("meetsAxeCoreNoViolations", async () => {
    const { container } = render(
      <Stage4Drawer counts={counts} activeTab="precheck" onTabChange={() => {}} onCollapse={() => {}}>
        {children}
      </Stage4Drawer>
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});