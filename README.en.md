# AstrmiraVideo

> **Natural-language description + reference image / reference video → local-or-cloud AI video generation workbench** (built for on-prem B2B delivery)

**English** | [中文](README.md)

[![Status](https://img.shields.io/badge/status-active%20development-blue)](docs/PLAN.md)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Backend](https://img.shields.io/badge/backend-Node%2022%20%2B%20Fastify%205%20%2B%20SQLite-3178c6)](docs/PLAN.md)
[![Frontend](https://img.shields.io/badge/frontend-React%2019%20%2B%20Vite%206-61dafb)](docs/PLAN.md)
[![Contract](https://img.shields.io/badge/CONTRACT-V2.37-success)](docs/CONTRACT.md)

> **The single source of truth for progress — what is finished and what is not — is
> [docs/PLAN.md](docs/PLAN.md) §5 (progress log) and §9 (backlog).** This file deliberately keeps no second copy of it.
>
> **All planning / contract / runbook documents are written in Chinese.** This English README exists so that
> non-Chinese readers can find their way around; **where the two disagree, the Chinese documents win.**
>
> **What this project is (honestly)**: a **learning project written in the shape of an on-prem B2B product** —
> the features and guardrails are built the way a private-deployment delivery would need them, but
> **there is no real customer today** (and no delivery schedule; see PLAN §6 **D56**).
> Copyright and licensing are handled as a **private repository / self-study** project: the
> [NOTICE](NOTICE) is kept as a **factual record** (facts should not be deleted just because they are not
> needed right now) rather than as a delivery gate.

## 30-second pitch

Describe a shot in natural language, drop in a reference image (first/last frame, style) or a reference video,
and the system routes the job to the engine **configured for this deployment**:

- **Cloud — Volcengine Ark / Seedance, BYOK**: you bring your own API key; the key lives **only in your browser**
  (the server forwards it, never stores it);
- **Local — `host-comfyui`**: **your own ComfyUI** (engine and models are yours; this repo only adapts the
  interface — CONTRACT §19). **Multiple instances are supported**: e.g. a 3080 box at 480p and a 5090 box at 720p,
  each selectable in the UI (`COMFYUI_SERVERS_FILE`).
- **H3 models can also be run inside ComfyUI.**
  A second local slot — **MiniMax H3** — was **removed in V2.37** (decision **D56**): it only ever had
  configuration conventions and no execution implementation, so keeping it meant shipping a button that
  only tells you "no" after you click it. The local track is now ComfyUI only.

Once a shot exists, the workbench closes the loop:

**browser-side edit desk** (multi-track timeline · Remotion preview & export · transitions / captions / SFX / BGM fades)
→ **render-to-library** (an edit is just another asset) → **lineage canvas** ("how did this shot come to be"),
which also has an **orchestration mode**: draw your own pipeline on the canvas, then run it
(idempotent submit / partial re-run / pin a segment / export-import the flow as a file).

B2B operations & delivery features: **projects**, **cost ledger** (estimates, with "Ark billing is authoritative"
shown side by side), **delivery packages** (multi-select export / naming templates / platform-spec transcoding /
manifest), **webhook terminal callbacks**, **observability** (live/ready levels + metric snapshots + threshold alerts),
**backup & restore** (consistent snapshots + three restore gates).

## UI (real screenshots, not concept art)

> Captured by `node scripts/capture-docs-shots.mjs` against a **local production-shaped** server
> (real service, real tasks, real rendering — the fixtures are zero-cost). Every shot is reproducible.

| Create entry (`#/create`, default landing) | Pro workbench (`#/workbench`) |
|---|---|
| ![Create](docs/assets/ui/desktop-01-create.png) | ![Workbench](docs/assets/ui/desktop-02-workbench.png) |
| One sentence → inferred mode (text/image/first-last-frame/video ref); `@` references past shots and assets | Three-column console: prompt & asset slots / live preview / tasks & gallery |

| Overview (`#/overview`) | Library (`#/library`) |
|---|---|
| ![Overview](docs/assets/ui/desktop-03-overview.png) | ![Library](docs/assets/ui/desktop-04-library.png) |
| Today's generations / success rate / queue / storage + recent shots and an activity feed | Filter, sort, per-card actions, multi-select delivery packages |

| Edit desk (`#/edit?task=…`) | Canvas (`#/canvas`: fact graph ↔ **orchestration**) |
|---|---|
| ![Edit](docs/assets/ui/desktop-05-edit.png) | ![Canvas](docs/assets/ui/desktop-06-canvas.png) |
| Browser-side composition & export (WebCodecs — **no server GPU involved**); exports go straight to the library | Fact graph: nodes = assets/tasks, edges = derives / extracted-frame / reference. **Orchestration mode**: lay out nodes, wire them, run once — idempotent, partial re-run, pin, export/import. <br>(The screenshot shows the **fact graph**; an orchestration screenshot is still to be added.) |

![Logs](docs/assets/ui/desktop-07-logs.png)

> **Mobile status (honest)**: it is a **"look and click" browsing mode, not an editing terminal** —
> the timeline, canvas and dual inspectors are unusable at 390px (the canvas is hidden on narrow screens).
> Evidence and the recorded cleanup items live in [docs/FRONTEND-REVIEW.md](docs/FRONTEND-REVIEW.md) §3
> and PLAN §9 item **B60**.

## Quick start

```bash
cp .env.example .env   # fill in your Ark key / local ComfyUI address (multi-instance: see GUIDE)
pnpm install
pnpm dev               # backend + frontend in parallel (dev, Vite HMR)

# To validate the *production shape* locally (single process serving API + /media + built frontend):
pnpm build && pnpm serve:local   # → http://127.0.0.1:3000 (add --fixture for zero-cost sample data)
pnpm smoke:ui                    # real Chrome UI smoke on the production build (CSP + zero console errors)
```

> **Node version**: **22 is the source of truth** (`.nvmrc` + CI + the production image agree; `engines` requires
> `>=22`). Node 24 works locally, but do not go older — we had a real "green locally, red in CI" drift in 2026-10-08.

Put in your own Ark key and you can generate immediately (the key stays in **your browser**). The local track is
**explicitly enabled by the deployer** (`EXPOSE_HOST_LOCAL_TRACK=1` + `COMFYUI_BASE_URL`; **multiple engines** via
`COMFYUI_SERVERS_FILE`); when it is not enabled, picking a local engine returns `PROVIDER_UNAVAILABLE`.

**After changing env and restarting, click “🔍 检测本地引擎” (check local engines) in the left panel** — it really
connects once and reports **per instance** (one unreachable engine does not affect the others). Recommended tiers,
multi-instance configuration and engine setup: [docs/GUIDE.md](docs/GUIDE.md).

> ✨ **Prompt expansion needs a separate text key** (a different credential from the video key; you can reuse the
> same one). The server keeps **no fallback text key** (pure BYOK) — without one the button is disabled and says why.
>
> **Troubleshooting entry point is the “operation log”** in the sidebar: who / when / what / result. Send the
> `requestId` of a failing entry to the developer and it lands in one hop (GUIDE §7, CONTRACT §10).

## Stack & layout (one screen)

**No jQuery-style stack, and no "everything framework" either.** Frontend: React 19 + Vite 6 + TypeScript
(hand-rolled hash router and a `useSyncExternalStore` store, hand-written CSS tokens), native `fetch` with
**every response validated against zod contracts**. Backend: Fastify 5 + Node 22 + better-sqlite3 (hand-written SQL,
incremental column migrations), **one process** serving API / media / built frontend, behind Caddy for TLS and login.
**Both sides share the zod contracts in `packages/shared`** (Fastify uses them as validators, the frontend as response
assertions) — that is the single most important structural choice in this project.

```
AstrmiraVideo/
├── backend/src/       routes(15 domains) · store(SQLite) · providers(upstream) · queue(dual-track scheduler)
│                      pipeline(guardrails & edit execution) · security(auth/credentials/rate-limit/redaction)
│                      webhook(terminal callbacks) · ops(backup/restore CLI) · observability(snapshots)
├── frontend/src/      views(8 top-level views) · components · edit(Remotion edit desk)
│                      canvas(lineage canvas) · lib(router/api/credentials/projects/packages) · styles(hand-written CSS)
├── packages/shared/   zod contracts shared by both sides (API / error codes / edit project / cost / naming …)
├── deploy/            compose + Caddyfile (domain & IP flavours); two containers: app + caddy
├── scripts/           smoke · local acceptance server · fixtures · deploy · **doc screenshots** · benchmarks
└── Dockerfile         single-process image (Node 22 + ffmpeg)
```

> **Should we switch to a "more mature" frontend framework? The answer is no** — with four decidable criteria for
> when that would change: [docs/FRONTEND-REVIEW.md](docs/FRONTEND-REVIEW.md) §5 (decisions PLAN §6-D46 / D47).

## Boundaries (what we deliberately do **not** do)

| Not done / not planned | Reality & reason |
|---|---|
| **Local “MiniMax H3” slot** | **Removed in V2.37** (decision **D56**): it only had configuration conventions and no execution implementation, so it was a button that only says "no" after you click it. The local track is **`host-comfyui`** only (your own ComfyUI — real-machine validated, multi-instance); **H3 models can run inside ComfyUI**. (The id and the `/status` `local` section are **kept** purely for compatibility with stale frontend bundles and historical request bodies — they get `503`, not a schema `400`.) |
| **Multi-tenancy / cross-tenant isolation** | Decision D42: the delivery shape is "one deployment per customer"; the isolation unit is the **project**, not a tenant |
| **Member roles (admin/creator/viewer)** | Requires a user identity system first; roles without login would be fake gating (PLAN §9-B58) |
| **Watermarks** | Decision D45: not doing it (a future "customer logo overlay" is a separate feature) |
| **Full-featured mobile** | Decision D47: browsing mode (look & click, no editing); five low-cost cleanups in item B60 |
| **Prometheus export / alert push** | CONTRACT §16 states it plainly: metrics are JSON snapshots (any external exporter can convert); alerts only expose "the fact that a threshold was crossed" |

## Documentation map (one owner per topic; everywhere else links)

| Document | Role | Owns |
|---|---|---|
| **README.en.md** (this file) | English entry point | The English summary; **the Chinese documents are authoritative** |
| [README.md](README.md) | Chinese entry point | Pitch, screenshots, stack summary, doc map, collaboration rules |
| **[NOTICE](NOTICE)** | **Third-party licensing** | License list of direct dependencies, the **Remotion source-available boundary (read before commercial delivery)**, external tools (ffmpeg / ComfyUI) and service terms |
| [docs/PLAN.md](docs/PLAN.md) | Product & development plan | Architecture, features, guardrails, steps & acceptance criteria, **progress log (§5, authoritative)**, decisions, security, **backlog (§9)** |
| [docs/CONTRACT.md](docs/CONTRACT.md) | Interface authority | TS types, **route table**, error dictionary, storage & asset lifecycle, backup contract |
| [docs/GUIDE.md](docs/GUIDE.md) | Getting started & runbook | Tier matrix, dual-track engine setup (incl. multi-instance ComfyUI), workflows, FAQ, ops & backup SOP |
| [docs/PENDING-DECISIONS.md](docs/PENDING-DECISIONS.md) | Open decisions | Only-decidable-by-the-product-owner items, with options / recommendation / what is blocked |

## Working agreements (every contributor and AI session follows these)

The full list (10 rules + 2 process rules) is in [README.md](README.md#协作与文档规范所有贡献者与-ai-会话必须遵守).
The short version:

1. **Redaction**: no IPs, absolute paths or credentials in Markdown — placeholders only; real values live in local `.env`;
2. **Single source of truth**: each fact is written once in its owner document; everything else links;
3. **Acceptance criteria first**: every step comes with testable ACs and a verification method;
4. **Mark your evidence**: 【已验证】measured / 【待验证】unmeasured / 【规划】does not exist yet;
5. **Contract first**: change `docs/CONTRACT.md` before changing code;
6. **No silent degradation**: unimplemented capabilities return explicit error codes; never pretend to work;
7. **Keys never persist**: credentials travel in request headers only (`X-Provider-Key` / `X-LLM-Key`) — never stored,
   never logged, never echoed;
8. **Probes do not judge visitors**: `/api/providers/status` only reports this service's own configuration,
   never the visitor's hardware;
9. **One slice, one commit**; evidence per slice; `pnpm lint && pnpm type && pnpm test:contract && pnpm test:coverage`
   plus `pnpm build && pnpm smoke:ui` must be green before committing.

## License

This repository is **[MIT](LICENSE)**.

> **How to read this (2026-10-15)**: the project is maintained as a **private repository / self-study**
> effort (see the project note at the top and PLAN §6 **D56**). The two items below are therefore **not
> delivery gates** — they are what to look at **if this ever gets distributed**; they stay in
> [NOTICE](NOTICE) because **facts should not be deleted just because they are not needed right now**.

**Two things in the dependency tree must be read separately** (details in **[NOTICE](NOTICE)**):

1. **Remotion — used by the browser-side edit desk — is _source-available_, not OSI open source.** Organizations
   outside its free range must **obtain a commercial Remotion license before commercial delivery**. This appears here
   because it is something you must know *before* shipping to a customer, not a footnote.
2. External tools (**ffmpeg**, your own **ComfyUI**, your Ark account) carry their own terms; the deployer / user
   confirms them.

Model weights and cloud API terms are covered in docs/PLAN.md §7.
