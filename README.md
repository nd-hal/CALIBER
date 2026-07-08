# CALIBER

CALIBER is an open web platform for collecting high-quality, multi-dimensional human
annotations of behavioral interview responses using the **STAR** (Situation–Task–Action–Result)
framework. Unlike from-scratch annotation, CALIBER presents each annotator with an LLM's
proposed STAR highlights and 1–5 scores **pre-populated** — turning the task into
*edit-and-confirm* rather than *create-from-blank*, and letting us study how humans revise
machine judgments.

The platform recruits annotators through [Prolific](https://www.prolific.com/), walks them
through consent, a survey, and a guided training tour, then has them annotate and score real
interview transcripts across four tasks per question.

---

## Annotation Tasks

For every interview question, an annotator:

1. **Text Annotation** — highlights the spans corresponding to each STAR frame.
2. **Structural Accumulation Score** — rates the thoroughness of each frame on a 1–5 scale.
3. **Competency (BARS)** — gives a behaviorally-anchored 1–5 competency rating.
4. **Binary Checklist** — marks presence/absence of each frame.

A guided interactive tour with audio narration brings every annotator to a shared baseline
before they touch real data, and a rich telemetry stream (clicks, mouse movement,
time-per-task) is recorded alongside the annotations.

---

## Tech Stack

- **Frontend:** React 19 + Vite (single-page app, vanilla CSS)
- **Backend:** Node.js + Express
- **Storage:** AWS DynamoDB (state) + S3 (audio, transcripts, narration)
- **Auth:** JWT + bcrypt (admin console)
- **Deployment:** AWS Elastic Beanstalk

## Quick Start

```bash
npm install
cp .env.example .env        # fill in AWS + JWT values
npm run dev                 # Vite (5173) + Express (3001) concurrently
```

```bash
npm run build               # production build → dist/
npm start                   # serve the built app via Express
```

See `.env.example` for the required environment variables.

---

## Citation

This platform accompanies a system-demonstration paper (EMNLP 2026, under review).
Citation details will be added on acceptance.

## Contact

**Ray Alavo** — [salavo@nd.edu](mailto:salavo@nd.edu)
University of Notre Dame
