# CALIBER

CALIBER is a web platform for collecting multi-dimensional human annotations of behavioral
interview responses. It presents each annotator with an LLM's proposed STAR
(Situation–Task–Action–Result) highlights and scores **pre-populated**, turning annotation into
an *edit-and-confirm* task. This README focuses on how the platform is **built and operated**;
for the study/annotation design see [`SURVEY_CODEBOOK.md`](SURVEY_CODEBOOK.md), and for a full
architecture reference with diagrams see [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## System Overview

CALIBER is a single-page React app served by an Express API, backed entirely by AWS managed
services (DynamoDB + S3) and deployed on Elastic Beanstalk. There is no relational database and
no persistent server state — the Express layer is stateless and horizontally replaceable, with
all state living in DynamoDB.

```
┌────────────┐     REST /api/*      ┌──────────────────────┐     AWS SDK v3    ┌─────────────┐
│  Browser   │ ───────────────────► │  Express (Node.js)   │ ────────────────► │  DynamoDB   │
│  React SPA │ ◄─────────────────── │  on Elastic Beanstalk│ ◄──────────────── │  (state)    │
└────────────┘   JSON + JWT (admin) │  + serves built dist/│                   └─────────────┘
      │                             └──────────────────────┘                   ┌─────────────┐
      │                                        │  presigned GET URLs ─────────► │     S3      │
      └────────── streams audio directly ─────────────────────────────────────►│ (audio/data)│
                                                                                └─────────────┘
```

The same server codebase runs three sibling studies (`ProlificAnnotationApp`, `CALIBER-full`,
`CALIBER-part`) off a shared content pool, differentiated only by environment variables and
per-project DynamoDB tables. See [Multi-Study Design](#multi-study-design).

---

## Architecture

### Frontend (`src/`)

A single Vite build hosting two experiences selected at runtime:

- **Annotator SPA** (`App.jsx`) — a strictly linear, phase-aware screen router covering consent,
  survey, guided tutorial, the annotation/grading workspace, and post-task surveys.
- **Admin console** (`pages/admin/`) — JWT-gated dashboard for progress, insights, pool
  management, and CSV exports.

Supporting modules: `api.js` (fetch wrapper), `data.js` (static survey/rubric content),
`telemetry.js` (client-side event batching over `sendBeacon`).

### Backend (`server/`)

A stateless Express app with seven route modules mounted under `/api`:

| Module | Mount | Responsibility |
|---|---|---|
| `auth.js` | `/api/auth` | Admin login, JWT issuance, account CRUD |
| `session.js` | `/api/session` | Annotator lifecycle: start, item draw, hydration, heartbeat, complete |
| `annotations.js` | `/api/annotations` | Persist annotation progress (highlights + grades) |
| `admin.js` | `/api/admin` | Config, progress, insights, annotator management |
| `sonaItems.js` | `/api/admin/sona-items` | Content ingest, pool + eligibility management |
| `export.js` | `/api/admin/export` | CSV data exports |
| `telemetry.js` | `/api/telemetry` | Bulk UI-event ingest |

Shared logic lives in `server/lib/` and is kept **identical across all three sibling repos**:

- **`pool.js`** — the assignment engine. A breadth-first, stratified-shuffle *shrinking pool*
  that atomically reserves items via DynamoDB conditional writes, so concurrent annotators never
  over-assign. Also releases stale assignments.
- **`hydrate.js`** — converts stored LLM phrase strings into the highlight HTML
  (`<span class="hl hl-{s,t,a,r}">`) the grading UI renders, handling overlaps and paraphrase
  mismatches.
- **`llmEligibility.js`** — caches the set of items that have LLM grades for the configured
  model, so only annotatable items are ever drawn.
- **`tableBootstrap.js`** — idempotently provisions any missing DynamoDB tables on boot.

### Background jobs

Two `setInterval` jobs run on the server (single-instance assumption):

- **Stale-assignment sweep** — releases items held by idle annotators back to the pool.
- **LLM-eligibility refresh** — re-scans grades so newly imported content becomes assignable
  without a restart.

---

## Key Subsystems

### Assignment pool

Items carry a per-project counter on their DynamoDB meta row. `drawFromPool()` fills items with
the lowest counter first (breadth-first coverage), reserving each with a conditional update
(`counter < target AND eligible`) so races resolve to a single winner. Stale holds are swept
back automatically; the admin console can top-up, reset, or reopen the pool.

### LLM hydration pipeline

LLM grades are produced **offline** and imported once (`server/scripts/import-llm-grades.js`)
into a shared grades table — there are no runtime model calls. On item delivery, `hydrate.js`
rehydrates highlights and scores into the exact shape the human-annotation UI uses, so
LLM-proposed and human-made annotations are indistinguishable in the workspace and in exports.

### Telemetry

The client buffers interaction events (clicks, sampled mouse movement, per-screen timing) and
flushes them in batches — surviving page unload via `navigator.sendBeacon` — to a per-project
telemetry table, exportable as CSV.

### Storage model

- **DynamoDB** — all persistent state. Shared `paa-*` tables (admins, content items, LLM grades)
  are common across siblings; project-scoped `caliberp-*` tables (annotators, annotations,
  config, telemetry) isolate each study.
- **S3** — interview and tutorial audio. The server never proxies media; it returns 1-hour
  presigned URLs and the browser streams directly from the bucket.

---

## Multi-Study Design

One codebase, three studies. Behavior is switched entirely through environment variables — no
code forks:

| Concern | Mechanism |
|---|---|
| Isolated assignment pool | `POOL_COUNTER_COLUMN` (per-project counter on shared items) |
| Project-scoped state | `TABLE_*` env vars point at `caliberp-*` tables |
| Study-specific flow | Feature flags (`PARTIAL_MODE_BLANK_FIRST`, `RETURNING_DISABLED`, …) |
| Eligible content | `CALIBER_LLM_MODEL` + admin allowlist |

The four `server/lib/` modules are project-agnostic — a change here must be mirrored across the
sibling repos.

---

## Tech Stack

- **Frontend:** React 19 + Vite (SPA, vanilla CSS)
- **Backend:** Node.js + Express (stateless)
- **Storage:** AWS DynamoDB (state) + S3 (media)
- **Auth:** JWT + bcrypt (admin console)
- **Deployment:** AWS Elastic Beanstalk (behind an ALB; `trust proxy` for real client IP)
- **Recruitment:** [Prolific](https://www.prolific.com/) (URL-param handoff + completion redirect)

---

## Quick Start

```bash
npm install
cp .env.example .env        # fill in AWS + JWT values
npm run dev                 # Vite (5173) + Express (3001) concurrently
```

```bash
npm run build               # production build → dist/
npm start                   # Express serves the built app + /api/*
```

Deployment (Elastic Beanstalk):

```bash
npm run build
eb deploy caliber-part-env
```

See `.env.example` for required environment variables. The health check endpoint is `/health`.

---

## Repository Layout

```
src/                    React SPA (annotator + admin)
  ├── App.jsx           annotator screen flow + grading workspace
  ├── api.js            REST client
  ├── data.js           survey / rubric / tutorial content
  ├── telemetry.js      client event batching
  └── pages/admin/      admin console
server/
  ├── index.js          Express app, middleware, background jobs
  ├── routes/           API route modules
  ├── lib/              pool, hydrate, eligibility, table bootstrap (shared)
  ├── middleware/       JWT auth guards
  ├── db/dynamo.js      DynamoDB client + table map
  └── scripts/          one-off maintenance (LLM grade import)
ARCHITECTURE.md         full architecture reference (diagrams)
SURVEY_CODEBOOK.md      study / annotation design
```

---

## Citation

This platform accompanies a system-demonstration paper (EMNLP 2026, under review).
Citation details will be added on acceptance.

## Contact

**Ray Alavo** 
[salavo@nd.edu](mailto:salavo@nd.edu)
University of Notre Dame
