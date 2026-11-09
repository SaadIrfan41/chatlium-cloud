# ADR 0005: UI stack and design direction

- Status: Accepted
- Date: 2026-11-09

## Context

The decision record names Next.js (App Router) and Tailwind for the dashboard and a Vite widget, but no component system or visual direction. On 2026-11-07 the owner chose **shadcn/ui + Tailwind** for both, asked for a beautiful, fully accessible, responsive UI with modern features, and delegated all other design choices.

## Decision

**Stack**

- shadcn/ui 4.23 with **Base UI** primitives (`@base-ui/react`) and the `base-nova` style, Tailwind CSS 4.3, Lucide icons, and shadcn's `cn` package (a compiled replacement for `clsx` + `tailwind-merge`, published by the shadcn team).
- Components are added with the shadcn CLI and restyled through their `cva` variants, not ad-hoc classes. Chat UI uses the shadcn chat primitives (`Message`, `Bubble`, `Marker`).
- All versions are pinned exactly, including the ones the CLI added with `^`.

**Design direction.** The subject is support operators watching an AI answer their customers from their own documents, and taking over when it cannot. Colour carries that meaning, not decoration:

| Token               | Light                        | Dark                   | Meaning             |
| ------------------- | ---------------------------- | ---------------------- | ------------------- |
| `background`        | `#f3f6f8` (fog)              | `#0e151b`              | surface             |
| `foreground`        | `#15202b` (slate ink)        | `#e6edf2`              | text                |
| `primary`, `answer` | `#0b6e6e` teal               | `#5ed0c6`              | the AI is answering |
| `handoff`           | `#8a4106` on `#fbebd3` amber | `#f4bc74` on `#3a2611` | handed to a person  |

`Bubble variant="answer"` and `Marker variant="handoff"` encode those two states. They mirror the `conversation_status` values `active` and `escalated`.

**Type.** One family, Instrument Sans, using its width axis: headlines at 75% width, body text at normal width.

**Accessibility (WCAG 2.2 AA)**

- Every text/background pair is computed, not eyeballed: 22 pairs pass in light and dark (body text above 13:1, muted text above 6:1, input borders above 3:1).
- A skip-to-content link, landmarks (`main`, a labelled `section`, `figure`/`figcaption`), and visible focus rings in the accent colour.
- `prefers-reduced-motion` turns animation and transitions off everywhere.
- Navigation uses links (Sign in), and actions use forms or buttons (Sign out is a POST).

**Theme.** Light, Dark, or Match my device (the default). The choice is stored in a cookie and applied on the server to `<html>`, so there is no flash of the wrong theme. The `dark:` variant follows both the saved choice and the system setting.

**Avoided on purpose:** cream-and-terracotta, black-with-acid-accent, identical card grids, all-caps eyebrow labels, and middle-dot meta strings.

## Consequences

- The widget (Step 2.13) reuses the tokens and components, scoped for Shadow DOM: Tailwind theme variables on `:host`, and Base UI portals pointed inside the shadow root.
- New colours must be added as tokens with a contrast check, never as raw values in components.
