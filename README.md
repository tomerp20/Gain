# Gain — Email Chain Analysis & Auto-Reply System

<!-- Filled in by issue #7 -->

## Overview

Gain pulls every message from the Gain Email Server, reconstructs conversation threads via `in_reply_to` chains, identifies which threads are waiting on a reply, drafts a contextually-grounded response with an LLM, sends it, and records the reply — so the same conversation is never answered twice even across repeated runs.

## Setup

```sh
cp .env.example .env
# Edit .env: add your ANTHROPIC_API_KEY and confirm the other defaults
npm install
```

## Usage

```sh
npm run gain -- run
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run gain -- ingest` | Fetch and persist all emails from the API |
| `npm run gain -- threads` | Build and persist thread tree from stored emails |
| `npm run gain -- actionable` | List threads whose latest message is unread and incoming |
| `npm run gain -- reply` | Draft and send LLM replies to all actionable threads |
| `npm run gain -- run` | Run the full pipeline end-to-end |

## Configuration

All config is loaded from environment variables. Copy `.env.example` to `.env` and fill in the values.

| Variable | Default | Description |
|----------|---------|-------------|
| `GAIN_API_BASE_URL` | — | Base URL of the Gain Email Server |
| `GAIN_FROM_ADDRESS` | — | Sender address used for all outgoing replies |
| `GAIN_STORAGE_PATH` | — | Path to the local JSON storage file |
| `AZURE_OPENAI_ENDPOINT` | — | Azure OpenAI resource endpoint URL |
| `AZURE_OPENAI_API_KEY` | — | Azure OpenAI API key |
| `AZURE_OPENAI_DEPLOYMENT` | — | Deployment name (e.g. `gpt-5.4-mini`) |
| `AZURE_OPENAI_API_VERSION` | `2025-01-01-preview` | Azure OpenAI API version |
| `LOG_LEVEL` | `info` | Pino log level |

## Storage

Emails, threads, and reply records are persisted as a single JSON file (default: `./data/emails.json`). The file is written atomically via a tmp-rename pattern so a crash mid-write never produces a corrupt store.

**Why JSON over SQLite/Postgres?** For the scope of this exercise the entire dataset fits in memory — a few hundred to a few thousand emails — so a relational engine adds setup friction with no query-speed benefit. JSON is schema-free, trivially inspectable (`cat data/emails.json | jq`), and the reply-idempotency guarantee only requires a keyed lookup by thread ID, which a plain object handles in O(1). The trade-off is that every write re-serialises the whole file; at ~5 000 emails that's still under 50 ms, which is fine.

## Threading Algorithm

Thread reconstruction is a forest-building DFS over the `in_reply_to` graph:

1. Build an adjacency list: for each email whose `in_reply_to` points to a *known* email, record it as a child.
2. Identify roots: any email whose parent is `null` or missing from the dataset (orphans are promoted to roots with a warning log).
3. Run DFS from every root, collecting members. A `globalVisited` set spans all roots — if a node appears twice (cycle), the function throws rather than silently dropping data.
4. Sort each thread's messages by `(created_at, id)` ascending for deterministic ordering when timestamps tie.
5. Sort threads themselves by `latest.created_at` descending so the most-recent conversation is first.

The smallest valid thread is a single email with no children.

## LLM Integration

Replies are generated via **Azure OpenAI** using the `openai` SDK (configured for Azure via `baseURL` + `api-key` header). The deployment is set through `AZURE_OPENAI_DEPLOYMENT` (e.g. `gpt-4o-mini`).

**Prompt shape:**
- *System:* establishes Natalie's persona — professional, concise, no generic openers, reply body only.
- *User:* the full thread formatted as numbered messages with `from`, `date`, and `body`, followed by a reply instruction.

Passing the full thread (not just the last message) lets the model answer questions that reference earlier messages and maintain consistent tone. `max_tokens: 500` keeps replies tight.

## What Would I Do With Another Day?

- **Spam classifier** — add a Naive-Bayes or TF-IDF logistic classifier trained on the SpamAssassin public corpus; store `spam_label` and `confidence` next to each email and skip replies for spam. The infrastructure (label field in types, skip path in the reply engine) is already wired.
- **Batch store writes** — the current store reads and rewrites the whole JSON on every `upsert`; a bulk `upsertMany` path during ingest would be ~100× faster for large datasets.
- **Structured run log** — surface a final summary table (emails fetched, threads built, actionable, replied, errors) at the end of `run` instead of scattering counts through pino log lines.
- **Dockerfile** — a two-stage build (install → compile → copy dist) to make the tool portable without requiring a local Node install.
