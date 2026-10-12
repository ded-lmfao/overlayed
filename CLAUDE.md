# Repo Intelligence

Overlayed is a pnpm/Turborepo workspace for a Discord voice overlay. Desktop: React/Vite + Rust/Tauri; web: Astro; API and Discord bot: Hono/Cloudflare Workers. Shared packages provide types and styling utilities.

Start with [.claude/repo-knowledge/index.md](.claude/repo-knowledge/index.md), then load only the relevant app/topic. Source paths and change propagation live in file-index.md files. Verify current symbols and inferred facts before editing; the graph is a snapshot, not a replacement for source verification.

Run desktop with `pnpm desktop`; unsigned packaging with `pnpm build:desktop:unsigned`. CI checks formatting/lint and platform builds; inline Rust placement tests exist but CI does not invoke tests. Keep JS/Rust invoke contracts, cross-window events, config defaults and update payloads synchronized.
