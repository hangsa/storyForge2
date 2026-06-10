---
name: StoryForge Creative OS
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#b9cacb'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#849495'
  outline-variant: '#3b494b'
  surface-tint: '#00dbe9'
  primary: '#dbfcff'
  on-primary: '#00363a'
  primary-container: '#00f0ff'
  on-primary-container: '#006970'
  inverse-primary: '#006970'
  secondary: '#d0bcff'
  on-secondary: '#3c0091'
  secondary-container: '#571bc1'
  on-secondary-container: '#c4abff'
  tertiary: '#d8ffe7'
  on-tertiary: '#003824'
  tertiary-container: '#65f2b5'
  on-tertiary-container: '#006d4a'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#7df4ff'
  primary-fixed-dim: '#00dbe9'
  on-primary-fixed: '#002022'
  on-primary-fixed-variant: '#004f54'
  secondary-fixed: '#e9ddff'
  secondary-fixed-dim: '#d0bcff'
  on-secondary-fixed: '#23005c'
  on-secondary-fixed-variant: '#5516be'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
  canvas-bg: '#020617'
  surface-panel: '#1E293B'
  novelty-high: '#3B82F6'
  saturation-high: '#EF4444'
  warning-p1: '#F59E0B'
  error-p0: '#DC2626'
  system-log: '#64748B'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-narrative:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-ui:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-mono:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.4'
    letterSpacing: 0.05em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: '1.4'
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  container-margin: 24px
  gutter: 16px
  canvas-padding: 64px
  panel-gap: 1px
---

## Brand & Style

The brand personality is that of a **High-Precision Creative Co-pilot**. It positions itself not merely as a text editor, but as a sophisticated narrative operating system. The target audience includes professional novelists, screenwriters, and narrative designers who require both deep creative flow and rigorous structural management.

The design style is **Corporate / Modern with Technical / Sci-Fi influences**, leaning into a "Pro-Tool" aesthetic. It utilizes a modular, dashboard-centric layout that emphasizes high information density and real-time analytical feedback. The emotional response should be one of **total control and intellectual expansion**—evoking the feeling of being in a high-tech "command center" for storytelling.

Key visual principles:
- **Modular Precision:** Every element exists within a defined functional grid.
- **System Transparency:** Visible logic logs and "under-the-hood" data streams (SF_LOG) are integrated into the aesthetic.
- **Narrative Vitality:** Using motion and vibrant accents to represent the "living" nature of the story data.

## Colors

The system operates exclusively in **Dark Mode** to reduce eye strain during long creative sessions and to maximize the contrast of analytical data.

- **Primary (Tech Blue):** Used for interactive states, primary actions, and "Novelty" indicators. It represents the "Blue Ocean" of creative potential.
- **Secondary (Ether Purple):** Used for creative AI suggestions, narrative "WhatIf" branches, and internal monologues.
- **Tertiary (Vitality Green):** Used for "Success" states, resolved mysteries, and narrative consistency passes.
- **Neutral (Deep Slate):** The foundation of the UI, providing a range of dark surfaces to distinguish between the Canvas, the Inspiration Panel, and the Asset Registry.

Semantic colors are strictly enforced: **Red** for logic contradictions/timeline breaks, **Amber** for reader frustration/tension drift, and **Slate** for background system logs.

## Typography

The typography strategy separates **Narrative Content** from **System Data**.

1.  **System Interface:** Uses **Hanken Grotesk** for headlines and navigation. It is clean, modern, and professional.
2.  **The Narrative Canvas:** Uses **Inter** for the drafting area. It is chosen for its exceptional readability and neutral character, allowing the author’s "voice" to lead without typographic bias.
3.  **Analytical Data & SF_LOG:** Uses **JetBrains Mono**. This monospaced font is used for all technical metadata, novelty scores, memory tokens (L0-L4), and narrative logic guards.

Text density changes based on the "Genre Template." For "Cool Novel" settings, increase paragraph spacing. For "Literary" settings, use tighter leading to create a "wall of prose" effect.

## Layout & Spacing

The layout follows a **Fixed-Fluid Hybrid** model. The sidebars (Inspiration and Asset Registry) are fixed-width "control panels," while the central Creative Canvas is fluid but constrained by wide "safe margins" to maintain focus.

- **The Grid:** A 12-column system is used for dashboard views. In "Focus Mode," the sidebars collapse to a 1-column icon strip.
- **The Panel Gap:** Instead of standard margins, panels are separated by 1px "dividing lines" (system-log color) to mimic a modular terminal interface.
- **Narrative Density:** Spacing in the drafting area is dynamic. "Action" scenes utilize more whitespace between short paragraphs, while "Worldbuilding" blocks are allowed to cluster into denser visual weights.
- **Breakpoints:**
    - **Desktop (1440px+):** Full 3-panel layout (Inspiration | Canvas | Assets).
    - **Tablet (1024px):** Canvas + 1 toggleable side panel.
    - **Mobile:** Read-only "Live Stream" and Approval Gate actions only.

## Elevation & Depth

This design system uses **Tonal Layers** and **Subtle Glows** rather than traditional drop shadows to indicate hierarchy.

- **L0 (The Void):** The background layer (`canvas-bg`). Deepest level.
- **L1 (Panels):** Surfaces (`surface-panel`) that house tools and logs. These use a 1px solid border instead of shadows.
- **L2 (Active Nodes):** Interactive elements in the WhatIf tree. These use a subtle outer glow of the `primary_color` to indicate "active thought" status.
- **L3 (Overlays/Modals):** AI suggestions and "Inspiration Router" pop-ups. These use a light backdrop blur (12px) to lift them off the canvas without breaking the technical aesthetic.

Memory levels are visually coded: High-elevation (L0 Runtime) elements are always pinned and have a high-contrast treatment, while Deep Storage (L3 Cold) elements are dimmed and semi-transparent.

## Shapes

The shape language is **Technical and Precise**. We use a "Soft" (0.25rem) roundedness for standard buttons and inputs to keep the interface feeling modern but efficient.

- **Nodes:** Narrative nodes in the tree diagram use a specialized shape—hexagonal for "Plot Points" and circular for "Character Assets."
- **Guards:** 
    - **Fact Guards (Strict):** Use perfectly sharp 0px corners to signal rigidity and "unbreakable" logic.
    - **Narrative Guards (Soft):** Use dashed borders and standard roundedness.
- **Interactive States:** Buttons use a "clipped corner" aesthetic on hover to reinforce the Sci-Fi/Tooling theme.

## Components

- **Buttons:** Primary buttons are "Ghost" style with high-saturation borders and no fill, filling with color only on hover.
- **Narrative Chips:** Used for "Conflict Intensity" and "Mystery Status." These are small, monospaced labels with a subtle background tint corresponding to their intensity level.
- **The WhatIf Tree:** A custom component. Nodes are connected by thin, animated paths. "Pruned" branches fade to 20% opacity; "Preferred" branches gain a secondary purple glow.
- **Input Fields:** Minimalist design—only a bottom border that illuminates in the primary color when focused. No background fill.
- **Asset Cards:** Modular cards that display "Mystery," "Goal," or "Reveal." They include a "Satisfaction/Tension" sparkline at the bottom of the card.
- **Circuit Breaker:** A specialized "Error" component that overlays the screen with a red terminal-style warning when logic contradictions (P0) are detected by the AI.
- **SF_LOG Feed:** A scrolling, vertical list of monospaced text at the bottom of the interface, showing real-time token processing and memory retrieval.