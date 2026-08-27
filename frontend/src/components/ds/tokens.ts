// Nebula Forge design-token names. Numeric values live in
// frontend/src/styles/globals.css and frontend/tailwind.config.ts —
// this file gives components a stable TypeScript surface to import
// when they want to look up a token by name (rather than hard-coding
// "stats-number" as a string in many places).

export const FONT_SIZE_TOKENS = {
  display: "display-lg",
  headline: "headline-lg",
  headlineMobile: "headline-lg-mobile",
  title: "title-md",
  bodyLarge: "body-lg",
  body: "body-md",
  label: "label-sm",
  statsNumber: "stats-number",
} as const;

export type FontSizeToken = (typeof FONT_SIZE_TOKENS)[keyof typeof FONT_SIZE_TOKENS];

export const SURFACE_TOKENS = {
  background: "bg-background",
  surface: "bg-surface",
  surfaceDim: "bg-surface-dim",
  surfaceBright: "bg-surface-bright",
  surfaceContainerLowest: "bg-surface-container-lowest",
  surfaceContainerLow: "bg-surface-container-low",
  surfaceContainer: "bg-surface-container",
  surfaceContainerHigh: "bg-surface-container-high",
  surfaceContainerHighest: "bg-surface-container-highest",
  surfaceVariant: "bg-surface-variant",
} as const;

export const COLOR_ROLES = {
  primary: "text-primary",
  onPrimary: "text-on-primary",
  primaryContainer: "bg-primary-container",
  onPrimaryContainer: "text-on-primary-container",
  secondary: "text-secondary",
  tertiary: "text-tertiary",
  error: "text-error",
} as const;

export const RADIUS_TOKENS = {
  sm: "rounded-sm",
  base: "rounded",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  full: "rounded-full",
} as const;
