import type { ReactNode } from "react";

export interface PanelCardProps {
  children: ReactNode;
  padding?: "sm" | "md" | "lg";
  interactive?: boolean;
  onClick?: () => void;
}

const PADDING_CLASS: Record<NonNullable<PanelCardProps["padding"]>, string> = {
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
};

export default function PanelCard({
  children,
  padding = "md",
  interactive = false,
  onClick,
}: PanelCardProps) {
  const interactiveClass = interactive
    ? "cursor-pointer hover:border-primary-container/40"
    : "";

  return (
    <div
      onClick={interactive ? onClick : undefined}
      className={`bg-surface-container-low border border-outline-variant rounded-lg ${PADDING_CLASS[padding]} ${interactiveClass}`}
    >
      {children}
    </div>
  );
}
