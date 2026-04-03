# Dashboard Triage Color And Startup Selection Design

## Summary

Upgrade the dashboard sidebar from a passive list into explicit startup navigation, and add restrained health color cues that make triage readable at a glance.

This change should preserve the product's "data-forward, surgical, calm" brief:

- color communicates state, not decoration
- startup selection becomes explicit and URL-addressable
- the shell remains stable while selected-startup content changes

## Goals

- Make startup health visible without requiring the founder to read every badge.
- Turn the startup list into real navigation instead of an informational sidebar.
- Preserve startup selection in the URL across refresh, back/forward, and shared links.
- Keep the interface calm and low-noise while improving scan speed.

## Non-Goals

- Rebuilding the dashboard into a multi-page product area beyond the startup route refactor.
- Introducing a dedicated visual treatment for `syncing` in the sidebar.
- Refactoring unrelated dashboard layout or copy.
- Redesigning health computation or connector logic.

## Approved Direction

### 1. Routing And Selection

The current implicit model (`primaryStartup = startups[0]`) should be replaced with explicit startup-addressed navigation.

- The dashboard should use a startup-based path rather than session-only selection state.
- The concrete route shape should become `/app/startups/$startupId`.
- The existing `/app` entry should redirect to the first valid startup in the active workspace, or to the current empty-state experience if the workspace has no startups.
- Clicking a startup row in the sidebar should navigate to that startup's dashboard route.
- The selected startup should be derived from the route param, not from list order.
- Refresh, browser history, and copied links should preserve the selected startup.
- If the route points to a startup that is not available in the active workspace, redirect to the first valid startup in that workspace.
- If the active workspace has no startups, preserve the existing empty-state flow instead of forcing startup resolution.
- When the workspace changes and the route's startup is no longer valid, navigate to the first startup in the new workspace.

### 2. Visual Language

Color cues should stay restrained and state-driven.

- `PortfolioStartupCard` gets a soft semantic background wash based on health state.
- The card should not gain a loud semantic shadow or alert-style border treatment.
- Sidebar rows should display a compact state marker before the startup name.
- The selected sidebar row should also receive a faint health-tinted background wash.
- Unselected rows should remain neutral apart from the state marker.
- `syncing` should remain visually neutral in the sidebar.

#### Sidebar Marker Treatments

- `healthy`: solid green dot
- `attention`: solid amber dot
- `blocked`: solid red dot
- `error`: muted red ring with a neutral center

This keeps `blocked` and `error` in the same severity family while preserving their semantic difference:

- `blocked` means the startup needs founder attention
- `error` means the data pipeline for that startup is unreliable

#### Portfolio Card Treatments

- `healthy`: soft green surface wash
- `attention`: soft amber surface wash
- `blocked`: soft red surface wash
- `error`: distinct but related red-family surface wash

The wash should be visible enough to answer "which startup needs me?" quickly, but quiet enough to remain consistent with the calm brief.

#### Health Detail Separator

The "Health detail" separation treatment should move from a hard border feel to a softer muted separator closer to the existing warm, Luma-like surface language.

### 3. Data Flow

The sidebar now needs portfolio-wide state, not only selected-startup data.

- Introduce a lightweight health summary map keyed by startup id.
- This summary should support sidebar rendering and selected-row tinting without requiring the full selected-startup dashboard payload.
- Health summaries for all startups in the active workspace should load in parallel after the startup list resolves.
- Failures should be isolated per startup row.
- If a startup summary cannot be loaded, the sidebar should fall back to the `error` indicator for that row.

The selected startup should continue to load full detail payloads for:

- health
- insight
- tasks
- connectors

Selection changes should reset and refetch only selected-startup surfaces, not the whole shell.

### 4. Error Handling

- Invalid startup route: redirect to the first valid startup in the active workspace.
- Empty workspace: preserve the existing empty state and omit startup routing resolution.
- Workspace switch with stale startup route: navigate to the first startup in the new workspace.
- Sidebar summary failure for one startup: show the `error` ring for that row, but keep the rest of the list usable.
- Selected startup data failure: preserve existing error behavior in the main dashboard panels.

## Implementation Notes

- Reuse the existing health-state semantics and portfolio card view model where possible.
- Route changes should become the single source of truth for selected startup identity.
- The sidebar interaction should feel like navigation, not like a temporary local filter.
- Keep the current shell mounted during startup switches to avoid unnecessary instability or visual churn.

## Testing Requirements

Add or update coverage for:

- route-driven startup selection
- sidebar row click navigates to the selected startup route
- refresh preserves the selected startup
- invalid startup route redirects to a valid startup
- workspace switch rewrites selection when needed
- sidebar renders `healthy`, `attention`, `blocked`, and `error` markers correctly
- selected row receives semantic tint
- portfolio card receives semantic surface tint
- selected-startup content refetches on route change without reloading the entire shell

## Risks

- The route refactor is larger than a pure visual pass because the dashboard currently assumes one implicit startup.
- Portfolio-wide health summary loading adds request fan-out and should remain lightweight.
- Invalid-selection handling must be explicit to avoid route loops during workspace changes.

## Out Of Scope Follow-Ups

- Dedicated `syncing` sidebar state if founders later need it.
- Separate startup-specific nested pages beyond the initial route refactor.
- Further dashboard IA changes unrelated to triage and startup selection.
