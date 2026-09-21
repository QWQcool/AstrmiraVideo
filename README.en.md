# AstrmiraVideo

> **From one brief to a deliverable cut — a dual-mode AI video production pipeline.**

[![Status](https://img.shields.io/badge/status-early%20development-orange)](#roadmap)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> ⚠️ **Early development.** APIs and data contracts are not stable yet. See [docs/PLAN.md](docs/PLAN.md) (Chinese).

## What it is

A browser-based production workbench for AI video: give it a short brief and optional reference images, and it runs the whole chain — **script → footage → voiceover → subtitles → composition → delivery** — with every step **visible, editable and re-runnable**.

## Two modes, one core

Two very different cost structures, sharing ~80% of the pipeline:

```
brief → script (LLM) → shot split → ┃FOOTAGE┃ → audio → subtitles → compose → deliver
                                       ↑ the only difference
  ① Stock mode     keywords → royalty-free stock search → download clips
                   free · seconds · deterministic · fully automatic
  ② Model mode     prompt compilation → AI video generation → download clips
                   pay-per-use · minutes · requires human checkpoints
```

Adding a new video provider means replacing **one stage implementation** — nothing else changes.

| Mode | Cost (15s @720p) | GPU needed |
|---|---|---|
| Stock | ≈ $0 | No |
| Model · cloud API | ~$2–10 | No |
| Model · local | $0 (electricity) | Yes (≥10GB VRAM) |

## Design principles

1. **Vertical slice first** — make "one brief → one video" work end-to-end, then harden.
2. **Honest by default** — never silently degrade, never fake a result.
3. **Checkpoints follow cost** — free paths run through; any paid call must stop for confirmation.
4. **Guardrails live server-side** — rate limits, idempotency, billing-risk classification cannot be bypassed by the client.
5. **Contract first** — freeze data contracts and state machines before implementation.
6. **Traceable reuse** — every upstream project we borrow from is logged in [docs/UPSTREAM.md](docs/UPSTREAM.md).

## Stack

Node.js 22 · TypeScript · Fastify · zod · better-sqlite3 · React 19 · Vite
FFmpeg · Edge TTS · SQLite · Docker Compose · Caddy

## Docs

| Doc | Content |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | Master plan: architecture, schedule, cost, compliance |
| [docs/CONTRACT.md](docs/CONTRACT.md) | Data contracts & state machines (draft) |
| [docs/UPSTREAM.md](docs/UPSTREAM.md) | Upstream reuse ledger |
| [docs/COMPLIANCE.md](docs/COMPLIANCE.md) | Compliance ledger |

## Credits

Architecture and interaction patterns are inspired by [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) (MIT), [InvokeAI](https://github.com/invoke-ai/InvokeAI), [ComfyUI](https://github.com/comfyanonymous/ComfyUI), [React Flow](https://reactflow.dev/) (MIT), [Dify](https://github.com/langgenius/dify) and [n8n](https://github.com/n8n-io/n8n) (patterns only — no frontend code copied).

Visual language references the public design system of [Astrmira](https://www.astrmira.com/). **This project is not affiliated with that site.**

## License

[MIT](LICENSE) — note that the third-party models and stock libraries we call have their own terms; see [docs/COMPLIANCE.md](docs/COMPLIANCE.md).
