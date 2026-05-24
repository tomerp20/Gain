# Gain — Email Chain Analysis & Auto-Reply System

## Overview

Gain pulls every message from the Gain Email Server, reconstructs conversation threads via `in_reply_to` chains, identifies which threads are waiting on a reply, drafts a contextually-grounded response with an LLM, sends it, and records the reply — so the same conversation is never answered twice even across repeated runs.

## Setup

```sh
cp .env.example .env
# Edit .env: add your AZURE_OPENAI_API_KEY and confirm the other defaults
npm install
```

## Usage

```sh
npm run gain -- run
```

To capture a structured run log:

```sh
npm run gain -- run 2>run.log
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
| `LOG_LEVEL` | `info` | Pino log level (`trace`/`debug`/`info`/`warn`/`error`/`fatal`) |

## Storage

Emails and thread snapshots are persisted as two JSON files on disk:

- `$GAIN_STORAGE_PATH/emails.json` — all fetched emails, keyed by UUID, plus a reply ledger (`replies` map from `thread_id` → `{ replyEmailId, sentAt }`).
- `$GAIN_STORAGE_PATH/threads.json` — a snapshot of the last-built thread forest (for inspection/debugging).

**Why JSON files?** The dataset fits comfortably in memory (~1 000 emails, a few MB). A JSON file is immediately inspectable with any editor, requires no migration tooling, and survives between runs without a running database process. Atomic writes (write to a `.tmp` file, then `fs.rename`) make the store crash-safe.

**Trade-off:** JSON does not support concurrent writes or indexed lookups. If the dataset grew to hundreds of thousands of emails or required multi-process access, the natural upgrade path is SQLite (single-file, no separate process, adds indexed queries with almost no operational overhead).

The `EmailStore` interface (`src/types/index.ts`) intentionally hides the storage backend, so swapping to SQLite or Postgres only requires a new implementation of that interface.

## Threading Algorithm

An email thread is the transitive closure of `in_reply_to` links. The algorithm in `src/threads/index.ts`:

1. **Build a parent→children adjacency map** from all stored emails.
2. **Find roots** — emails whose `in_reply_to` is `null` or points to an email not in the dataset (orphans). Orphans are accepted with a warning log; the spec notes parents may be missing.
3. **DFS from each root** to collect all descendants into one component (Thread).
4. **Cycle detection** — the DFS tracks a `visiting` set; entering a node already in that set throws immediately. The spec says cycles should be impossible, but we assert it.
5. **Sort messages** within each thread by `created_at ASC`, breaking ties by `id ASC` for determinism.
6. **Sort threads** by `latest.created_at DESC, latest.id DESC` so the most-recently-active thread comes first.

The result is a flat `Thread[]` where each `Thread.latest` is the newest email in the component.

## LLM Integration

**Model:** Azure OpenAI — deployment configurable via `AZURE_OPENAI_DEPLOYMENT` (tested with `gpt-5.4-mini`).

**Prompt shape:**

*System prompt:*
> You are a professional email assistant. You will receive an email thread and must write a reply to the most recent message. Be concise, helpful, and address the specific content of the conversation. Write only the reply body — no subject line, no headers, no salutation unless appropriate.

*User prompt:*
```
Please write a reply to the following email thread (shown oldest to newest):

---
Date: <ISO timestamp>
From: <sender>
To: <recipients>
Subject: <subject>

<body>

[... remaining messages ...]

Write only the reply body.
```

**Temperature:** 0.3 — low enough for consistent, professional replies, high enough to avoid repetitive phrasing across threads.

**Idempotency:** Before sending, `ReplyService` checks `store.hasRepliedTo(thread_id)`. After a successful send, the reply is recorded in the store before `markRead` is called. A crash between send and markRead is safe — on the next run the store record gates out the thread, so it won't be replied to again even if the email is technically still unread.

## What Would I Do With Another Day?

1. **Spam classification** — the mailbox is seeded with spam/ham data. A TF-IDF + logistic regression classifier (scikit-learn port via ONNX, or a zero-shot LLM prompt) would let us skip auto-replying to obvious spam. The `ReplyService` already has a `skippedSpam` counter in its summary and a `skipped_spam` status on `ThreadReplyResult` — the plumbing is ready, just needs a classifier wired in.

2. **Parallel ingestion** — currently emails are fetched page-by-page sequentially. A bounded concurrency pool (e.g. `p-limit` with concurrency 5) would cut ingest time significantly on large mailboxes without hammering the API.

3. **SQLite storage** — for a larger dataset or multi-process access, swapping `JsonEmailStore` for an SQLite implementation behind the same `EmailStore` interface is straightforward. SQLite would also enable indexed queries (e.g. "all unread inbound emails") instead of full-scan.

4. **Proper test coverage for the orchestrator** — `GainMailbox` currently has no unit tests. With the existing `EmailStore` and `ApiClient` interfaces it's easy to inject fakes and assert that `ingest()` paginates correctly, `buildThreads()` saves a snapshot, and `replyToActionable()` only touches actionable threads.

5. **Containerization** — a `Dockerfile` with a node:slim image and a volume mount for `GAIN_STORAGE_PATH` would make this deployable anywhere without a local Node environment.

## Run Log

The structured log (pino JSON) is written to stderr; the human-readable summary is written to stdout. Capture both:

```sh
npm run gain -- run > summary.txt 2> run.log
```

Example summary output:

```
=== Run Summary ===
  fetched: 1053
  built: 287
  actionable: 203
  replied: 203
  skippedAlreadyReplied: 0
  errors: 0
```

Second run (idempotency):

```
=== Run Summary ===
  fetched: 1053
  built: 287
  actionable: 0
  replied: 0
  skippedAlreadyReplied: 203
  errors: 0
```
