<div align="center">

# TypeScript Agent Runtime

**An observable TypeScript runtime for building streaming, tool-using AI agents.**

Explicit orchestration for model sampling, tool execution, context budgeting, state transitions, database deadlines, grounded retrieval indexing, and durable run traces.

</div>

## Overview

TypeScript Agent Runtime is a full-stack reference implementation of an explicit, inspectable Agent execution loop. It keeps model-visible context, user-visible messages, runtime events, provider continuation data, persisted execution records, and retrieval index data as separate concerns.

The runtime uses a policy-driven bounded sequential loop. A Run can directly answer or execute up to two validated Tool Calls across at most three model samplings by default. The current Run allowlist exposes the two read-only Article tools `search_articles` and `get_article_detail` without hard-coding their execution order.

DeepSeek thinking Tool Calls preserve required `reasoning_content` only as internal continuation data. Reasoning is not exposed as user-visible content.

Phase 6 reliability work binds Run remaining budget to database business statements, fences late database results, and atomically closes Message / AgentStep / AgentRun terminal state where the database can commit the terminalization transaction.

Phase 7 Context Engineering adds a per-Run `ModelContext`, model-aware input budgeting, a locally loaded DeepSeek V4 tokenizer, token-budget-driven Dynamic History Selection, per-sampling Tool Loop Context planning, Observation governance, and a safe Admin Context Inspector. The current User Message remains mandatory and causally bounds previous History by `(createdAt, id)`.

Phase 8 Task 0 establishes a retrieval boundary and deterministic lexical evaluation baseline. Task 1 adds deterministic HTML Chunking, a replaceable Embedding Provider, pgvector-backed active Article indexes, explicit incremental / full indexing commands, stale fencing, advisory locking, and atomic per-Article replacement. Task 2A has completed the Gemini Embedding migration, exact vector retrieval, Article aggregation, hybrid RRF, isolated full indexing, and production quality-v2 evaluation via Issue #54 / PR #55. Retrieval Tool / Agent integration is the next planned capability in Task 2B.

## Highlights

| Capability | Implementation |
| --- | --- |
| Agent orchestration | Explicit bounded model sampling, Tool execution, Observation and final-answer boundaries |
| Streaming | Abort-aware NDJSON responses with incremental assistant deltas |
| Tool calling | Typed definitions, registry lookup, validation, executor isolation, per-run allowlisting |
| Tool safety | Risk gates, Tool timeout, cancellation propagation, per-tool Observation budgets |
| Runtime policy | Typed sampling / Tool Call limits, History candidate policy, Run deadline and fail-fast configuration |
| Context boundary | Per-Run `ModelContext` with ordered Tool Exchange handling and safe structural Context Snapshot metadata |
| Context budget | Model-aware initial and per-sampling input budget with application cap, output reserve and safety margin |
| Dynamic History | `COMPLETED`-only causal keyset pagination, recency-first whole-message selection and candidate hard limit |
| Token estimation | Local DeepSeek V4 full-request estimation behind a replaceable `TokenEstimator` boundary |
| Context Inspector | Per-sampling Budget, Sources, History / Observation adjustments and outcome from durable safe metadata |
| Retrieval boundary | Replaceable `ArticleRetriever`, deterministic lexical corpus, Recall@K and MRR evaluation |
| Grounded indexing | Canonical HTML blocks, deterministic Chunk identity, Gemini Embedding boundary, pgvector active index and idempotent CLI |
| Vector retrieval | Exact cosine search, active-profile filtering, Chunk-to-Article aggregation and evidence identity |
| Hybrid retrieval | Versioned lexical candidates, RRF fusion and production quality-v2 comparison |
| Database reliability | Remaining-budget DB boundary, PostgreSQL statement / lock timeout, late-result fencing |
| Persistence | Conversations, Messages, Agent Runs, ordered Agent Steps, Article Chunks and Article Index State in PostgreSQL |
| Model integration | OpenAI-compatible Chat Completions + DeepSeek thinking continuation |
| Runtime traces | Persisted input, output, status, timing, error and safe Context decision metadata |
| User interfaces | Vue chat client and a real-data operator console for Run / Step observability |

## Runtime lifecycle

```text
User Input
  -> Create Agent Run
  -> Resolve Model / Output Budget
  -> Select Initial Context within Budget
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
applicationInputCapTokens       = 262144
contextSafetyMarginTokens       = 16384
historyCandidateBatchSize       = 50
historyCandidateHardLimit       = 1000
maxSamplingRounds               = 3
maxToolCalls                    = 2
runDeadlineMs                   = 600000
```

`AGENT_MAX_TOOL_CALLS=0` disables Tool exposure for that Run.

Initial selection governs reliable History within the resolved input budget. The same budget is enforced before every sampling while preserving Tool Exchange pairing and governing follow-up History and Observation growth.

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

### Article indexing lifecycle

```text
Article rich HTML
  -> canonical structural block stream
  -> deterministic cl100k chunks (600 / 800 / 80)
  -> GeminiEmbeddingProvider outside DB transaction
  -> FOR UPDATE + sourceHash fence
  -> atomic Chunk replacement + Index State upsert
```

The indexing command is explicit. It is not run during API startup, migrations, Article writes, cron, or queues. A PostgreSQL session advisory lock prevents concurrent indexing commands. Normal indexing reads only `DATABASE_URL`; isolated verification uses the dedicated `index:articles:integration` entry, which reads only `ARTICLE_INDEX_TEST_DATABASE_URL`, fails closed when it is missing, and rejects the same URL as `DATABASE_URL`.

### Retrieval lifecycle

```text
Normalized Query
  -> Gemini Query Embedding
  -> exact cosine Chunk candidates
  -> unique Article aggregation
  -> versioned lexical candidates
  -> RRF(k=60)
  -> article-level top-k + best evidence
```

Task 2A deliberately keeps Retrieval internal. Agent-visible Tool integration, Observation budgeting and grounded answer behavior remain Task 2B / Task 3 work.

## Design principles

- **Explicit control flow** — orchestration stays visible in TypeScript rather than behind a workflow engine.
- **Untrusted model output** — Tool names and arguments are validated before backend execution.
- **Separated message layers** — UI messages, model input items, runtime events, provider continuation data and durable traces have different contracts.
- **Budgeted model context** — Provider capacity is an upper bound; application policy decides what the model actually sees.
- **Causal History** — only previous reliable messages may enter the current Turn; the current User Message is mandatory and appears exactly once.
- **Versioned retrieval data** — Chunk identity, source hashes, embedding profile and active index state are explicit and reproducible.
- **Bounded execution** — sampling, Tool Calls, Tool timeout and Run deadline are constrained by server-owned policy.
- **Terminal ownership** — late aborts, deadlines and database results cannot silently overwrite an established terminal state.
- **Evidence-driven evolution** — new Agent capabilities are planned after the current behavior is implemented and tested.

## Repository structure

```text
apps/
  api/        NestJS API, Agent Runtime, model adapters, Prisma boundary, tools and Article indexing
  web/        Vue chat application
  admin/      Operator console
packages/
  contracts/  Shared TypeScript contracts and product limits
prisma/       PostgreSQL schema, pgvector migration, fixtures and seed
docs/         Roadmap, task state, workflow, research, completed archives and work log
```

## Getting started

Requirements:

- Node.js `^20.19.0` or `>=22.12.0`
- pnpm `10.32.1`
- PostgreSQL **with the pgvector extension**（`docker compose up -d postgres` 使用的镜像已内置；自装 PostgreSQL 时必须额外安装 pgvector，否则 Embedding Index migration 会失败）
- A DeepSeek or other OpenAI-compatible Chat Completions endpoint
- A Google AI Studio Gemini API Key when running explicit Embedding smoke, indexing, or real vector retrieval

```bash
corepack enable
pnpm install
cp .env.example .env                                    # 填入 LLM_API_KEY / GEMINI_API_KEY
docker compose up -d postgres                           # 启动含 pgvector 的主库
pnpm prisma:generate
pnpm prisma:migrate                                     # 应用全部 migration
node --env-file=.env --import tsx apps/api/scripts/seed.ts   # 灌入 Demo 文章（幂等）
pnpm --filter @agent/api index:articles -- --mode=incremental # 构建向量索引（调真实 Gemini）
pnpm dev
```

seed 与 index 两步是 Retrieval / Grounding 链路可用的前提：跳过它们时普通聊天仍可用，但 `retrieve_article_context` 会因缺少 active index 而 fail closed。

> **从旧版 `postgres:16-alpine` 升级的开发机注意**：alpine（musl）初始化的数据卷在新镜像（glibc）下会有 collation 版本告警，文本索引可能失序。开发数据都可重建，建议直接重置主库卷后重走 migrate / seed / index：`docker compose rm -sf postgres && docker volume rm <项目前缀>_postgres-data && docker compose up -d postgres`。

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
| `LLM_DEFAULT_MAX_OUTPUT_TOKENS` | No | `65536` | Default output reserve |
| `LLM_APPLICATION_MAX_OUTPUT_TOKENS` | No | `131072` | Application output hard limit |
| `GEMINI_API_KEY` | For Embedding runtime | — | Google AI Studio API Key; normal API startup does not require it and Embedding does not fall back to `LLM_*` |
| `EMBEDDING_BATCH_SIZE` | No | `64` | Embedding batch size; valid range `1-375` |
| `EMBEDDING_REQUEST_TIMEOUT_MS` | No | `60000` | Per-request Embedding timeout |
| `EMBEDDING_MAX_RETRIES` | No | `2` | Project-owned retries; valid range `0-2` |
| `SEO_CHAT_HISTORY_CANDIDATE_BATCH_SIZE` | No | `50` | Number of reliable History candidates read per keyset page; valid range `50-1000` |
| `SEO_CHAT_HISTORY_CANDIDATE_HARD_LIMIT` | No | `1000` | Maximum candidates scanned per Run; valid range `50-1000` and not below batch size |
| `AGENT_MAX_SAMPLING_ROUNDS` | No | `3` | Maximum model sampling requests per Run |
| `AGENT_MAX_TOOL_CALLS` | No | `2` | Maximum Tool Calls per Run; may be `0` and must remain below sampling limit |
| `AGENT_RUN_DEADLINE_MS` | No | `600000` | Agent Run execution deadline |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `ARTICLE_INDEX_TEST_DATABASE_URL` | Integration only | — | Dedicated pgvector PostgreSQL used only by explicit integration entries; required there, never falls back to `DATABASE_URL`, and must differ from it |
| `PORT` | No | `3000` | API port |

The active Embedding profile is fixed as `google:gemini-embedding-2:1536:search-result-v1`; model and dimensions are not runtime overrides. The `openai` SDK remains only for the DeepSeek / OpenAI-compatible Chat client. It is not an Embedding provider or fallback.

The initial Context policy currently uses an application input cap of `262144` tokens and a fixed safety margin of `16384` tokens. These are typed application policy constants rather than environment variables.

## Development commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Start API, Web and Admin |
| `pnpm typecheck` | Type-check all workspaces |
| `pnpm lint` | Lint workspaces |
| `pnpm --filter @agent/api test:context` | DeepSeek V4 full-request estimator and Context planning tests |
| `pnpm --filter @agent/api test:llm-config` | LLM profile/config tests |
| `pnpm --filter @agent/api test:model-stream` | Model stream and continuation tests |
| `pnpm --filter @agent/api test:tools` | Tool contract/execution tests |
| `pnpm --filter @agent/api test:tool-loop` | Agent Loop, Context, budget, deadline and Abort tests |
| `pnpm --filter @agent/api test:agent-recorder` | Run / Step persistence tests |
| `pnpm --filter @agent/api test:db-reliability` | Real PostgreSQL deadline / terminalization reliability tests |
| `pnpm --filter @agent/api test:seo-service` | SEO Service and prompt tests |
| `pnpm --filter @agent/api test:retrieval` | Retrieval contract, lexical adapter and evaluation tests |
| `pnpm --filter @agent/api test:retrieval-db` | Real PostgreSQL / pgvector retrieval, filtering, cancellation and deadline tests |
| `pnpm --filter @agent/api eval:retrieval-baseline` | Deterministic offline lexical baseline report |
| `pnpm --filter @agent/api eval:retrieval-quality` | Production quality-v2 lexical / vector / hybrid report against the isolated index |
| `pnpm --filter @agent/api test:article-indexing` | Chunking, Embedding Provider, Indexer and CLI unit tests |
| `pnpm --filter @agent/api test:article-indexing-db` | Real PostgreSQL / pgvector migration, transaction, stale and lock tests |
| `pnpm --filter @agent/api smoke:embedding` | Safe real Gemini Embedding smoke |
| `pnpm --filter @agent/api index:articles -- --mode=incremental` | Build or repair changed Article active indexes |
| `pnpm --filter @agent/api index:articles -- --mode=full` | Rebuild all active Article indexes using only `DATABASE_URL` |
| `pnpm --filter @agent/api index:articles:integration -- --mode=full` | Rebuild in the isolated verification database using only `ARTICLE_INDEX_TEST_DATABASE_URL` |

## Project status

Available now:

- Persistent Conversations and Messages;
- Streaming chat and stop-generation handling;
- AgentRun / AgentStep recording;
- policy-driven bounded sequential Agent Loop;
- `search_articles` and `get_article_detail` Tool Calling;
- Tool allowlisting, validation, timeout and Observation budgets;
- DeepSeek thinking continuation without reasoning leakage;
- per-Run `ModelContext` boundary and safe Context Snapshot baseline;
- model-aware initial Context Budget with mandatory-context fail-closed behavior;
- local DeepSeek V4 tokenizer-based pre-request estimation;
- causal, `COMPLETED`-only, token-budget-driven Dynamic History Selection;
- per-sampling Context planning with deterministic History exclusion and Observation governance;
- per-sampling Admin Context Inspector with legacy / partial fallback and no raw Context exposure;
- Run-level deadline and database remaining-budget propagation;
- PostgreSQL statement / lock timeout and late-result ownership fencing;
- atomic normal completion / failure / Abort terminalization where commit succeeds;
- typed Provider profiles and runtime configuration;
- real Admin Run / Step query API and Run Trace UI observability baseline;
- replaceable Article Retrieval boundary and deterministic lexical evaluation baseline;
- deterministic Article Chunking, Gemini Embedding Provider, pgvector active index and explicit idempotent indexing CLI;
- exact cosine Retrieval, Chunk-to-Article aggregation, hybrid RRF and quality-v2 evaluation.

Current mainline status:

- **Phase 1-7 are Completed.**
- Phase 6 final archive is [`docs/tasks/completed/phase-06-bounded-agent-loop.md`](./docs/tasks/completed/phase-06-bounded-agent-loop.md).
- Phase 7 final archive is [`docs/tasks/completed/phase-07-context-engineering.md`](./docs/tasks/completed/phase-07-context-engineering.md).
- Phase 7 Task 0 `Context Boundary & Snapshot` is Completed via Issue #40 / PR #41, merge `415e866a`.
- Phase 7 Task 1 `Model-aware Budget & Dynamic History` is Completed via Issue #42 / PR #43, merge `6df72f0`.
- Phase 7 Task 2 `Loop-aware Context & Observation Governance` is Completed via Issue #44 / PR #45, merge `2f06355c`.
- Phase 7 Task 3 `Context Inspector & Phase Baseline` is Completed via Issue #46 / PR #47, merge `caf3d25b`.
- Phase 8 Task 0 `Retrieval Boundary & Offline Evaluation Baseline` is Completed via Issue #48 / PR #49, merge `4c2f7950`.
- Phase 8 Task 1 `Article Chunking & Embedding Index` is Completed via Issue #50 / PR #52, merge `76d66abf`.
- Phase 8 Task 2A `Vector / Hybrid Retrieval & Evaluation` is Completed via Issue #54 / PR #55, merge `3abdcb8a`.
- Task 2A's isolated full indexing completed 68 Articles and 2044 Gemini Chunks with no failed or stale records. production quality-v2 completed lexical / vector / hybrid comparison. Vector / Hybrid improve answerable-query recall but return nearest candidates for no-answer queries; positive and negative distance distributions overlap, so the similarity threshold remains `null`.
- Phase 8 remains Active. Task 2B is Next but has no Issue or active implementation. Task 3 remains Planned. There is currently no Active Agent Task.
- Minimal Compaction remains Gated.

See [`docs/roadmap.md`](./docs/roadmap.md), [`docs/tasks/README.md`](./docs/tasks/README.md), the [Phase 8 overview](./docs/tasks/phase-08-grounded-retrieval/README.md), the [Phase 7 archive](./docs/tasks/completed/phase-07-context-engineering.md), and the [Phase 6 archive](./docs/tasks/completed/phase-06-bounded-agent-loop.md).
