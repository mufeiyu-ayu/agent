<div align="center">

# TypeScript Agent Runtime

**An observable TypeScript runtime for building streaming, tool-using AI agents.**

Explicit orchestration for model sampling, tool execution, state transitions, and durable run traces.

</div>

## Overview

TypeScript Agent Runtime is a full-stack reference implementation of an explicit, inspectable Agent execution loop. It keeps model messages, user-visible messages, runtime events, and persisted execution records as separate concerns.

The runtime uses a policy-driven bounded sequential loop. A Run can directly answer or execute up to two validated Tool Calls across at most three model samplings by default. The current Run allowlist exposes the two read-only Article tools `search_articles` and `get_article_detail` without hard-coding their execution order.

DeepSeek thinking Tool Calls preserve required `reasoning_content` only as internal continuation data. Assistant Tool Call requests use non-null `content`, and reasoning is not exposed as user-visible content.

## Highlights

| Capability | Implementation |
| --- | --- |
| Agent orchestration | Explicit model sampling, tool execution, and final-answer boundaries |
| Streaming | Abort-aware NDJSON responses with incremental assistant deltas |
| Tool calling | Typed definitions, registry lookup, validation, executor isolation, per-run allowlisting |
| Tool safety | Risk gates, Tool timeout, cancellation propagation, per-tool Observation budgets |
| Runtime policy | Typed sampling / Tool Call limits, history policy, Run deadline and fail-fast configuration |
| Persistence | Conversations, Messages, Agent Runs, and ordered Agent Steps in PostgreSQL |
| Model integration | OpenAI-compatible Chat Completions + DeepSeek thinking continuation |
| Runtime traces | Persisted input, output, status, timing, and error snapshots for every step |
| User interfaces | Vue chat client and an operator console shell |

## Runtime lifecycle

```text
User Input
  -> Create Agent Run
  -> Load Conversation Context
  -> Model Sampling
       -> Final Answer --------------------> Complete Run
       -> Tool Call
            -> Validate & Execute
            -> Append Observation
            -> Model Sampling
            -> continue / final
```

Default server-owned bounds:

```text
historyLimit        = 40 completed messages
maxSamplingRounds   = 3
maxToolCalls        = 2
runDeadlineMs       = 600000
```

`AGENT_MAX_TOOL_CALLS=0` disables Tool exposure for that Run.

The Run deadline actively cancels in-flight model sampling and Tool Execution. Prisma query / transaction / Recorder database waits do not yet share active cancellation; database timeout and late-result semantics are tracked as a Phase 6 Task 2 reliability input rather than being hidden behind a fake `Promise.race` cancellation.

## Design principles

- **Explicit control flow** — orchestration stays visible in TypeScript rather than behind a workflow engine.
- **Untrusted model output** — tool names and arguments are validated before backend execution.
- **Separated message layers** — UI messages, model input items, runtime events, and Provider continuation data have different contracts.
- **Bounded execution** — sampling and Tool Calls are constrained by server-owned policy.
- **Safe cancellation** — model and Tool work receive the Run cancellation signal; unsupported database cancellation is documented as a separate reliability concern.
- **Evidence-driven evolution** — new Agent capabilities are planned after current behavior is implemented and tested.

## Repository structure

```text
apps/
  api/        NestJS API, Agent Runtime, model adapters, and tools
  web/        Vue chat application
  admin/      Operator console
packages/
  contracts/  Shared TypeScript contracts and product limits
prisma/       PostgreSQL schema and migrations
docs/         Roadmap, task state, workflow, research, and work log
```

## Getting started

Requirements:

- Node.js `^20.19.0` or `>=22.12.0`
- pnpm `10.32.1`
- PostgreSQL
- An OpenAI-compatible Chat Completions endpoint

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm prisma:generate
pnpm prisma:migrate
pnpm dev
```

| Application | URL |
| --- | --- |
| Web client | `http://localhost:5173` |
| Operator console | `http://localhost:5174` |
| API | `http://localhost:3000/api` |

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `LLM_API_KEY` | Yes | — | Provider API key |
| `LLM_BASE_URL` | Yes | — | OpenAI-compatible API base URL |
| `LLM_MODEL` | Yes | — | Supported model identifier |
| `LLM_CHAT_REQUEST_TIMEOUT_MS` | No | `60000` | Non-streaming model request timeout |
| `LLM_STREAM_TIMEOUT_MS` | No | `600000` | Streaming model request timeout |
| `LLM_DEFAULT_MAX_OUTPUT_TOKENS` | No | `65536` | Default output budget |
| `LLM_APPLICATION_MAX_OUTPUT_TOKENS` | No | `131072` | Application output hard limit |
| `SEO_CHAT_HISTORY_LIMIT` | No | `40` | Recent `COMPLETED` messages loaded into model history |
| `AGENT_MAX_SAMPLING_ROUNDS` | No | `3` | Maximum real model sampling requests per Run |
| `AGENT_MAX_TOOL_CALLS` | No | `2` | Maximum Tool Calls per Run; may be `0` and must remain below sampling limit |
| `AGENT_RUN_DEADLINE_MS` | No | `600000` | Agent orchestration deadline; actively cancels model / Tool work |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `PORT` | No | `3000` | API port |

## Development commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Start API, Web and Admin |
| `pnpm typecheck` | Type-check all workspaces |
| `pnpm lint` | Lint workspaces |
| `pnpm --filter @agent/api test:llm-config` | LLM profile/config tests |
| `pnpm --filter @agent/api test:model-stream` | Model stream and continuation tests |
| `pnpm --filter @agent/api test:tools` | Tool contract/execution tests |
| `pnpm --filter @agent/api test:tool-loop` | Agent Loop, budget, deadline and Abort tests |
| `pnpm --filter @agent/api test:seo-service` | SEO Service and prompt tests |
| `pnpm --filter @agent/api test:agent-recorder` | Run / Step persistence tests |

## Project status

Available now:

- Persistent Conversations and Messages
- Streaming chat and stop-generation handling
- AgentRun / AgentStep recording
- policy-driven bounded sequential Agent Loop
- `search_articles` and `get_article_detail` Tool Calling
- Tool allowlisting, validation, timeout and Observation budgets
- DeepSeek thinking continuation without reasoning leakage
- typed Provider profiles and runtime configuration
- static operator Run / Step views

Current mainline status:

- **Phase 6 Task 1 is Completed and merged**: Issue #29 is closed and PR #30 merged with commit `904b011d64e1aec7e36f706150fb8ef5ef89a761`.
- **Phase 6 remains Active** because Task 2 reliability / regression / learning acceptance is still outstanding.
- **Task 2 is Next**, but it starts only after a new Issue is created and its Clarification Gate is READY.

See [`docs/roadmap.md`](./docs/roadmap.md) and [`docs/README.md`](./docs/README.md).
