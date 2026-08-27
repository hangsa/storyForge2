import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "var(--color-primary)",
          container: "var(--color-primary-container)",
          "fixed-dim": "var(--color-primary-fixed-dim)",
          "on-primary": "var(--color-on-primary)",
          "on-container": "var(--color-on-primary-container)",
        },
        secondary: {
          DEFAULT: "var(--color-secondary)",
          container: "var(--color-secondary-container)",
          "on-container": "var(--color-on-secondary-container)",
          fixed: "var(--color-secondary-fixed)",
          "fixed-dim": "var(--color-secondary-fixed-dim)",
        },
        tertiary: {
          DEFAULT: "var(--color-tertiary)",
          container: "var(--color-tertiary-container)",
          "fixed-dim": "var(--color-tertiary-fixed-dim)",
        },
        surface: {
          DEFAULT: "var(--color-surface)",
          dim: "var(--color-surface-dim)",
          bright: "var(--color-surface-bright)",
          panel: "var(--color-surface-panel)",
          variant: "var(--color-surface-variant)",
          container: "var(--color-surface-container)",
          "container-low": "var(--color-surface-container-low)",
          "container-lowest": "var(--color-surface-container-lowest)",
          "container-high": "var(--color-surface-container-high)",
          "container-highest": "var(--color-surface-container-highest)",
        },
        "on-surface": {
          DEFAULT: "var(--color-on-surface)",
          variant: "var(--color-on-surface-variant)",
        },
        canvas: {
          bg: "var(--color-canvas-bg)",
          surface: "var(--color-canvas-surface)",
          "text-muted": "var(--color-canvas-text-muted)",
          "text-secondary": "var(--color-canvas-text-secondary)",
          accent: "var(--color-canvas-accent)",
        },
        background: {
          DEFAULT: "var(--color-background)",
          on: "var(--color-on-background)",
        },
        outline: {
          DEFAULT: "var(--color-outline)",
          variant: "var(--color-outline-variant)",
        },
        error: {
          DEFAULT: "var(--color-error)",
          p0: "var(--color-error-p0)",
          container: "var(--color-error-container)",
          "on-error": "var(--color-on-error)",
          "on-container": "var(--color-on-error-container)",
        },
        warning: {
          p1: "var(--color-warning-p1)",
        },
        system: {
          log: "var(--color-system-log)",
        },
        novelty: {
          high: "var(--color-novelty-high)",
        },
        saturation: {
          high: "var(--color-saturation-high)",
        },
      },
      fontSize: {
        "display-lg": [
          "48px",
          { lineHeight: "56px", fontWeight: "700", letterSpacing: "-0.02em" },
        ],
        "headline-lg": ["32px", { lineHeight: "40px", fontWeight: "600" }],
        "headline-lg-mobile": ["24px", { lineHeight: "32px", fontWeight: "600" }],
        "title-md": ["20px", { lineHeight: "28px", fontWeight: "500" }],
        "body-lg": ["18px", { lineHeight: "30px", fontWeight: "400" }],
        "body-md": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "label-sm": [
          "12px",
          { lineHeight: "16px", fontWeight: "500", letterSpacing: "0.05em" },
        ],
        "stats-number": ["24px", { lineHeight: "32px", fontWeight: "600" }],
      },
      fontFamily: {
        display: ['"Hanken Grotesk"', "system-ui", "sans-serif"],
        body: ["Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      keyframes: {
        slideDown: {
          "0%": { transform: "translateY(-8px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        slideDown: "slideDown 150ms ease-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
