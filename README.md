# CALIBER

CALIBER is a web platform for collecting multi-dimensional human annotations of behavioral
interview responses. It presents each annotator with an LLM's proposed STAR
(Situation–Task–Action–Result) highlights and scores **pre-populated**, turning annotation into
an *edit-and-confirm* task.

**Website:** [https://www.caliber-assess.org](https://www.caliber-assess.org)

This README focuses on how the platform is **built and operated**. For the study/annotation
design see [`SURVEY_CODEBOOK.md`](SURVEY_CODEBOOK.md); for the full architecture reference with
diagrams see [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## System Overview

A single-page React app served by a stateless Express API, with all state in AWS managed
services (DynamoDB + S3) and deployment on Elastic Beanstalk.

```
┌────────────┐     REST /api/*      ┌──────────────────────┐     AWS SDK v3    ┌─────────────┐
│  Browser   │ ───────────────────► │  Express (Node.js)   │ ────────────────► │  DynamoDB   │
│  React SPA │ ◄─────────────────── │  on Elastic Beanstalk│ ◄──────────────── │  (state)    │
└────────────┘   JSON + JWT (admin) │  + serves built dist/│                   └─────────────┘
      │                             └──────────────────────┘                   ┌─────────────┐
      │                                        │ presigned GET URLs ─────────► │     S3      │
      └────────── streams audio directly ─────────────────────────────────────►│ (audio/data)│
                                                                               └─────────────┘
```

- **Frontend (`src/`)** — a Vite SPA with two experiences: the annotator flow (`App.jsx`) and a
  JWT-gated admin console (`pages/admin/`).
- **Backend (`server/`)** — a stateless Express app exposing `/api/*` routes for the annotator
  lifecycle, annotations, admin management, exports, and telemetry.
- **Storage** — DynamoDB holds all state; S3 holds audio, served to the browser via short-lived
  presigned URLs (the server never proxies media).

## Design Notes

- **Shrinking-pool assignment** — items are drawn breadth-first and reserved with DynamoDB
  conditional writes, so concurrent annotators never over-assign; stale holds are swept back.
- **Offline LLM hydration** — LLM grades are imported once, not called at runtime, then
  rehydrated into the same shape as human annotations so the two are indistinguishable downstream.
- **One codebase, three studies** — `ProlificAnnotationApp`, `CALIBER-full`, and `CALIBER-part`
  share content and server code, differing only by environment variables and per-project tables.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the details behind each of these.

---

## Tech Stack

- **Frontend:** React 19 + Vite (SPA, vanilla CSS)
- **Backend:** Node.js + Express (stateless)
- **Storage:** AWS DynamoDB (state) + S3 (media)
- **Auth:** JWT + bcrypt (admin console)
- **Deployment:** AWS Elastic Beanstalk
- **Recruitment:** [Prolific](https://www.prolific.com/)

## Quick Start

```bash
npm install
cp .env.example .env        # fill in AWS + JWT values
npm run dev                 # Vite (5173) + Express (3001) concurrently
```

```bash
npm run build               # production build → dist/
npm start                   # Express serves the built app + /api/*
eb deploy caliber-part-env  # deploy to Elastic Beanstalk
```

See `.env.example` for required environment variables. Health check: `/health`.

---

## Contact

**Ray Alavo**
[salavo@nd.edu](mailto:salavo@nd.edu)
University of Notre Dame
