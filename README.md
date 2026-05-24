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
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5-20251001` | Model used for reply generation |
| `LOG_LEVEL` | `info` | Pino log level |

## Storage

<!-- Storage choice and trade-off write-up goes here -->

## Threading Algorithm

<!-- Algorithm description goes here -->

## LLM Integration

<!-- Model and prompt shape description goes here -->

## What Would I Do With Another Day?

<!-- Write-up goes here -->
