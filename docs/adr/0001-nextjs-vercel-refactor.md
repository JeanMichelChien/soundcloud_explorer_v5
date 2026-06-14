# 0001. Next.js Vercel Architecture

Status: Accepted
Date: 2026-06-14

## Context

The app analyzes public SoundCloud profiles and renders a graph-first discovery experience on Vercel with publicly accessible GitHub code. Full local cache data can contain tens of thousands of second-degree artists and personal taste history, which is too large for direct browser rendering and inappropriate as default public repository data.

## Decision

Use a TypeScript Next.js App Router application deployed on Vercel. The app uses a route handler for live SoundCloud analysis, pure TypeScript graph/ranking logic, a client-only canvas graph, and a small fictional demo fixture. Full local caches and generated HTML/text outputs stay ignored.

The seed set is the deduplicated union of artists from target liked tracks/playlists and target followings. Each seed stores `seedSource: "liked" | "followed" | "both"`.

## Consequences

- The app can be deployed directly to Vercel with the Node.js runtime used by Next.js.
- The UI can render a responsive graph-first experience on desktop and mobile.
- The analysis response must remain bounded because Vercel Functions and browsers cannot handle the full local graph as a single payload.
- SoundCloud access remains dependent on unofficial public web/API behavior, so route handlers need clear partial-failure warnings.
- Public repository data is intentionally limited to a small demo fixture.

## Alternatives

- Commit the full cache for cache-first behavior: rejected because it exposes personal data and is too large for browser rendering.
- Add a database cache in v1: deferred to avoid storage setup and operational complexity before live capped analysis is validated.
- Render the entire second-degree graph: rejected because full local cache data can contain tens of thousands of nodes and over one hundred thousand edges.
