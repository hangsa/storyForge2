---
name: Nebula Forge
colors:
  surface: '#051424'
  surface-dim: '#051424'
  surface-bright: '#2c3a4c'
  surface-container-lowest: '#010f1f'
  surface-container-low: '#0d1c2d'
  surface-container: '#122131'
  surface-container-high: '#1c2b3c'
  surface-container-highest: '#273647'
  on-surface: '#d4e4fa'
  on-surface-variant: '#bdc8d1'
  inverse-surface: '#d4e4fa'
  inverse-on-surface: '#233143'
  outline: '#87929a'
  outline-variant: '#3e484f'
  surface-tint: '#7bd0ff'
  primary: '#8ed5ff'
  on-primary: '#00354a'
  primary-container: '#38bdf8'
  on-primary-container: '#004965'
  inverse-primary: '#00668a'
  secondary: '#bcc7de'
  on-secondary: '#263143'
  secondary-container: '#3e495d'
  on-secondary-container: '#aeb9d0'
  tertiary: '#c5cce6'
  on-tertiary: '#283044'
  tertiary-container: '#a9b1ca'
  on-tertiary-container: '#3c4459'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#c4e7ff'
  primary-fixed-dim: '#7bd0ff'
  on-primary-fixed: '#001e2c'
  on-primary-fixed-variant: '#004c69'
  secondary-fixed: '#d8e3fb'
  secondary-fixed-dim: '#bcc7de'
  on-secondary-fixed: '#111c2d'
  on-secondary-fixed-variant: '#3c475a'
  tertiary-fixed: '#dae2fd'
  tertiary-fixed-dim: '#bec6e0'
  on-tertiary-fixed: '#131b2e'
  on-tertiary-fixed-variant: '#3f465c'
  background: '#051424'
  on-background: '#d4e4fa'
  surface-variant: '#273647'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  title-md:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 30px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
  stats-number:
    fontFamily: JetBrains Mono
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 16px
  md: 24px
  lg: 40px
  xl: 64px
  gutter: 20px
  margin-mobile: 16px
  margin-desktop: 32px
---

## Brand & Style

This design system is built for the focused creator—the novelist who blends traditional storytelling with modern AI capabilities. The brand personality is **sophisticated, technical, and atmospheric**. It aims to evoke a sense of "boundless possibility" through a deep, expansive dark theme that minimizes eye strain during long writing sessions.

The aesthetic follows a **Modern Corporate / Tech-focused** style with subtle **Glassmorphic** influences. It prioritizes information density for power users while maintaining a "breathable" feel through generous internal padding and precise geometric alignment. The interface feels like a high-end IDE for literature: reliable, precise, and unobtrusive.

## Colors

The palette is anchored in **Deep Space Navy**, providing a low-contrast environment that Recedes to let text content shine. 

- **Primary (Electric Blue):** Reserved for high-action triggers, progress indicators, and active states. It acts as a beacon of "AI energy" within the dark canvas.
- **Surface Tiers:** Use a scale of slates. The background is the darkest (#0B1120), cards and sidebars sit slightly higher (#111827), and interactive elements (like input fields) use #1E293B.
- **Functional Accents:** Success, warning, and error states should use desaturated versions of green, amber, and red to maintain the professional, tech-focused mood without becoming garish.

## Typography

This design system uses a triple-font approach to balance editorial elegance with technical precision:
1. **Hanken Grotesk (Headlines):** Sharp and contemporary, used for project titles and major section headings.
2. **Inter (Body):** The workhorse for long-form writing and UI labels. It provides exceptional legibility in dark mode.
3. **JetBrains Mono (Metadata/Stats):** Used for word counts, timestamps, and technical data visualization to reinforce the "forge" or "engine" metaphor.

Maintain a vertical rhythm by ensuring line heights for body text are at least 1.5x the font size to prevent "text crowding" in the dark environment.

## Layout & Spacing

The design system utilizes a **12-column fluid grid** for the main content area, with a **fixed left-rail navigation** (240px wide). 

- **Density:** High-density in the sidebar and stats widgets (using `xs` and `sm` spacing), but low-density in the primary writing canvas (using `lg` and `xl` margins) to facilitate focus.
- **Safe Areas:** On desktop, the central writing column should be capped at 800px wide to maintain optimal reading speed, centered within the fluid grid.
- **Breakpoints:** 
    - *Mobile (<768px):* Sidebar collapses into a hamburger menu; 4-column grid; margins reduced to 16px.
    - *Tablet (768px - 1024px):* Sidebar collapses to icons only; 8-column grid.
    - *Desktop (>1024px):* Full sidebar; 12-column grid.

## Elevation & Depth

Hierarchy is established through **Tonal Layering** and **Low-Contrast Outlines** rather than heavy shadows.

- **Level 0 (Background):** Deep navy (#0B1120).
- **Level 1 (Cards/Sidebar):** #111827 with a 1px border of #1E293B.
- **Level 2 (Popovers/Modals):** #1E293B with a subtle blue-tinted ambient shadow (0px 8px 24px rgba(0, 0, 0, 0.5)) and a semi-transparent backdrop blur (12px).

Active states for interactive cards should use a 1px glow effect using the Primary Electric Blue at 40% opacity.

## Shapes

The design system adopts a **Soft (0.25rem / 4px)** base roundedness to maintain a professional, architectural feel. 

- **Buttons & Inputs:** Use the standard `rounded` (4px).
- **Project Cards & Container Boxes:** Use `rounded-lg` (8px) to soften the larger blocks of color.
- **Status Indicators (Chips):** Use `rounded-full` (pill-shaped) to differentiate them from interactive buttons.
- **Progress Bars:** Use a sharp 2px radius to maintain a technical, data-driven look.

## Components

### Buttons & Triggers
- **Primary:** Solid Electric Blue with white text. No gradient.
- **Secondary/Ghost:** Slate gray borders with a subtle hover state that fills the background slightly (#1E293B).
- **New Project Trigger:** A distinctive large-format card with a dashed border and a centered "plus" icon using the primary color.

### Data Visualization Widgets
- **Stats Cards:** Minimalist blocks featuring a `label-sm` title and a `stats-number` value. Include a small sparkline using a 2px stroke in Electric Blue.
- **Phase Indicators:** A vertical list of steps with circular markers. Active phases pulse with a subtle blue outer glow.

### Bookshelf (List View)
- Use a high-density horizontal layout for the bookshelf. Each row includes the title, a "last edited" timestamp in `label-sm`, and a condensed progress bar showing the percentage toward the word-count goal.

### Input Fields
- Dark-filled inputs (#1E293B) with a focus state that changes the border color to Electric Blue. Placeholders should be a muted slate (#475569) to remain secondary to user-generated content.