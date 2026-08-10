<div align="center">

# TypeScript Agent Runtime

**An observable TypeScript runtime for building streaming, tool-using AI agents.**

Explicit orchestration for model sampling, tool execution, state transitions, database deadlines, and durable run traces.

</div>

## Overview

TypeScript Agent Runtime is a full-stack reference implementation of an explicit, inspectable Agent execution loop. It keeps model messages, user-visible messages, runtime events, provider continuation data, and persisted execution records as separate concerns.

The runtime uses a policy-driven bounded sequential loop. A Run can directly answer or execute up to two validated Tool Calls across at most three model samplings by default. The current Run allowlist exposes the two read-only Article tools `search_articles` and `get_article_detail` without hard-coding their execution order.

DeepSeek thinking Tool Calls preserve required `reasoning_content` only as internal continuation data. Reasoning is not exposed as user-visible content.

Phase 6 reliability work also binds Run remaining budget to database business statements, fences late database results, and atomically closes Message / AgentStep / AgentRun terminal state where the database can commit the terminalization transaction.

## Highlights

| Capability | Implementation |
| --- | --- |
| Agent orchestration | Explicit bounded model sampling, Tool execution, Observation and final-answer boundaries |
| Streaming | Abort-aware NDJSON responses with incremental assistant deltas |
| Tool calling | Typed definitions, registry lookup, validation, executor isolation, per-run allowlisting |
| Tool safety | Risk gates, Tool timeout, cancellation propagation, per-tool Observation budgets |
| Runtime policy | Typed sampling / Tool Call limits, history policy, Run deadline and fail-fast configuration |
| Database reliability | Remaining-budget DB boundary, PostgreSQL statement / lock timeout, late-result fencing |
| Persistence | Conversations, Messages, Agent Runs, and ordered Agent Steps in PostgreSQL |
| Model integration | OpenAI-compatible Chat Completions + DeepSeek thinking continuation |
| Runtime traces | Persisted input, output, status, timing, and error snapshots for every step |
| User interfaces | Vue chat client and a real-data operator console for Run / Step observability |

## Runtime lifecycle

```text
User Input
  -> Create Agent Run
  -> Load Conversation Context
  -> Model Sampling
       -> Final Answer --------------------> atomic terminal completion
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

### Deadline model

After `AgentRun` is created, one Run `deadlineAt` is shared by model sampling, Tool execution and Run-scoped database work.

For PostgreSQL business statements:

```text
remaining Run budget
  -> transaction-local statement_timeout / lock_timeout
  -> business statement
  -> ownership check
```

Pool acquisition is bounded by the current Prisma / `pg` capabilities but is not claimed to support per-operation physical cancellation. Late acquisition / late results are fenced from normal execution. `SET LOCAL` restores the pooled session baseline after commit / rollback; the runtime does not impose an application-wide statement timeout on non-Run queries.

If a completion COMMIT result is genuinely indeterminate, the runtime exposes that state instead of fabricating `COMPLETED` or `FAILED`. Durable recovery remains outside the current stage boundary.

## Design principles

- **Explicit control flow** — orchestration stays visible in TypeScript rather than behind a workflow engine.
- **Untrusted model output** — Tool names and arguments are validated before backend execution.
- **Separated message layers** — UI messages, model input items, runtime events, provider continuation data and durable traces have different contracts.
- **Bounded execution** — sampling, Tool Calls, Tool timeout and Run deadline are constrained by server-owned policy.
- **Terminal ownership** — late aborts, deadlines and database results cannot silently overwrite an established terminal state.
- **Evidence-driven evolution** — new Agent capabilities are planned after the current behavior is implemented and tested.

## Repository structure

```text
apps/
  api/        NestJS API, Agent Runtime, model adapters, Prisma boundary and tools
  web/        Vue chat application
  admin/      Operator console
packages/
  contracts/  Shared TypeScript contracts and product limits
prisma/       PostgreSQL schema and migrations
docs/         Roadmap, task state, workflow, research, completed archives and work log
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
| `AGENT_MAX_SAMPLING_ROUNDS` | No | `3` | Maximum model sampling requests per Run |
| `AGENT_MAX_TOOL_CALLS` | No | `2` | Maximum Tool Calls per Run; may be `0` and must remain below sampling limit |
| `AGENT_RUN_DEADLINE_MS` | No | `600000` | Agent Run execution deadline |
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
| `pnpm --filter @agent/api test:agent-recorder` | Run / Step persistence tests |
| `pnpm --filter @agent/api test:db-reliability` | Real PostgreSQL deadline / terminalization reliability tests |
| `pnpm --filter @agent/api test:seo-service` | SEO Service and prompt tests |

## Project status

Available now:

- Persistent Conversations and Messages;
- Streaming chat and stop-generation handling;
- AgentRun / AgentStep recording;
- policy-driven bounded sequential Agent Loop;
- `search_articles` and `get_article_detail` Tool Calling;
- Tool allowlisting, validation, timeout and Observation budgets;
- DeepSeek thinking continuation without reasoning leakage;
- Run-level deadline and database remaining-budget propagation;
- PostgreSQL statement / lock timeout and late-result ownership fencing;
- atomic normal completion / failure / Abort terminalization where commit succeeds;
- typed Provider profiles and runtime configuration;
- real Admin Run / Step query API and Run Trace UI observability baseline.

Current mainline status:

- **Phase 1-6 are Completed.**
- Phase 6 final archive is [`docs/tasks/completed/phase-06-bounded-agent-loop.md`](./docs/tasks/completed/phase-06-bounded-agent-loop.md).
- **Phase 7: Context Engineering is Next.** Task 0 is `Context Boundary & Snapshot`.
- **There is currently no Active Agent mainline Task** because Phase 7 Task 0 has not created a formal Issue or passed Clarification Gate yet.

See [`docs/roadmap.md`](./docs/roadmap.md), [`docs/tasks/README.md`](./docs/tasks/README.md), the [Phase 7 plan](./docs/tasks/phase-07-context-engineering/README.md), and the [Phase 6 archive](./docs/tasks/completed/phase-06-bounded-agent-loop.md).
