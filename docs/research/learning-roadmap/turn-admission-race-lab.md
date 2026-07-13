# Turn Admission Race 学习实验

这个实验把 Codex `turn/start`、`turn/steer`、`turn/interrupt` 的竞态压缩成一个纯 TypeScript reducer。目标不是复刻 Codex，而是亲手证明三个容易混淆的事实：

1. 请求被接收，不等于 Run 已启动。
2. 新输入必须明确属于新 Run 还是 active Run。
3. Cancel 请求成功，不等于最终状态一定是 Interrupted。

它属于 Advanced 并发学习，不是当前项目实施任务。

源码对照见 [Turn Input Admission 专题](../codex/turn-input-admission-and-cancellation.md)。

## 1. 前端类比

点击“开始分析”后，HTTP 立即返回一个 ID，worker 稍后才真正开始：

```text
POST /runs -> 202 Accepted
queue delay
RunStarted event
streaming
RunCompleted event
```

如果 UI 收到 202 就显示“模型正在运行”，而 worker 最终 admission 失败，页面会永久卡住。Agent Run 需要区分 `accepted` 与 `running`，就像前端要区分 mutation submitted 与 server state committed。

## 2. 先写出错误模型

下面的 reducer 把所有成功都当成 Running，并把 cancel response 当成 Interrupted：

```ts
type BadRun = {
  id: string
  status: 'running' | 'completed' | 'interrupted'
}

function badReducer(run: BadRun, event: string): BadRun {
  if (event === 'startAccepted') return { ...run, status: 'running' }
  if (event === 'cancelResponded') return { ...run, status: 'interrupted' }
  if (event === 'completed') return { ...run, status: 'completed' }
  return run
}
```

它无法表达：

- accepted 后异步拒绝。
- cancel 与 natural completion 竞争。
- 一条 steer input 尚未被模型消费。
- 两次 start 谁拥有真实 lifecycle。

## 3. 最小正确状态

```ts
type RunStatus =
  | 'accepted'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'interrupted'
  | 'failed'
  | 'rejected'

type InputStatus = 'queued' | 'recorded' | 'consumed' | 'discarded'

type RunState = {
  runId: string
  operationId: string
  status: RunStatus
  generation: number
  inputs: Record<string, InputStatus>
}
```

为什么 input 要有独立状态？因为 steer response 只证明进入 pending queue；它可能稍后写入 history、进入 model request，也可能随 abort 被丢弃或只留下持久记录。

## 4. Event 要携带 owner

```ts
type RunEvent =
  | { type: 'runAccepted'; runId: string; operationId: string; generation: number }
  | { type: 'runStarted'; runId: string; generation: number }
  | { type: 'runRejected'; runId: string; generation: number }
  | { type: 'inputQueued'; runId: string; generation: number; inputId: string }
  | { type: 'inputRecorded'; runId: string; generation: number; inputId: string }
  | { type: 'inputConsumed'; runId: string; generation: number; inputId: string }
  | { type: 'cancelRequested'; runId: string; generation: number }
  | {
      type: 'runTerminal'
      runId: string
      generation: number
      status: 'completed' | 'interrupted' | 'failed'
    }
```

每个迟到事件都携带 `runId + generation`。只比较 ID仍可能遇到测试 fixture 重用 ID、恢复投影替换或 UI ABA；generation 是运行快照身份。

## 5. Reducer

```ts
function accepts(state: RunState, event: { runId: string; generation: number }) {
  return state.runId === event.runId && state.generation === event.generation
}

function reduceRun(state: RunState, event: RunEvent): RunState {
  if (!accepts(state, event)) return state

  switch (event.type) {
    case 'runAccepted':
      return state

    case 'runStarted':
      if (state.status !== 'accepted') return state
      return { ...state, status: 'running' }

    case 'runRejected':
      if (state.status !== 'accepted') return state
      return { ...state, status: 'rejected' }

    case 'inputQueued':
      if (state.status !== 'running') return state
      return {
        ...state,
        inputs: { ...state.inputs, [event.inputId]: 'queued' },
      }

    case 'inputRecorded':
      if (state.inputs[event.inputId] !== 'queued') return state
      return {
        ...state,
        inputs: { ...state.inputs, [event.inputId]: 'recorded' },
      }

    case 'inputConsumed':
      if (state.inputs[event.inputId] !== 'recorded') return state
      return {
        ...state,
        inputs: { ...state.inputs, [event.inputId]: 'consumed' },
      }

    case 'cancelRequested':
      if (state.status !== 'running') return state
      return { ...state, status: 'cancelling' }

    case 'runTerminal':
      if (!['running', 'cancelling'].includes(state.status)) return state
      return { ...state, status: event.status }
  }
}
```

这个 reducer 仍是学习用最小模型。生产实现还要记录 terminal reason、timestamps、attempt、durable ordinal 与 optimistic concurrency version。

## 6. 实验 A：Accepted 不是 Running

事件序列：

```text
runAccepted(A)
runRejected(A)
```

断言：

- UI 先显示“排队中”，不显示 streaming。
- Rejected 是 terminal state。
- 不能等待永远不会出现的 RunStarted。

再测试：`runStarted(A)` 到达后，迟到的 `runRejected(A)` 不得把 Running 覆盖成 Rejected。

## 7. 实验 B：两个 Start 不得产生 orphan owner

模拟：

```text
start operation A -> accepted run A
start operation B while A active
```

分别实现三个产品策略并写测试：

### 策略 1：Conflict

B 返回 `409 active_run_exists`，不创建 Run ID。

### 策略 2：Queue next Run

B 返回 `accepted run B`，只有 A terminal 后 B 才能 `runStarted`。

### 策略 3：显式转 Steer

B 不返回新 Run，而是：

```ts
{ disposition: 'steered-active', runId: 'A', inputId: 'input-B' }
```

三个策略都可以成立；禁止的是返回 `runId=B`，实际却把输入并入 A，又不给 B terminal lifecycle。

## 8. 实验 C：Override 与 Input 必须同代

准备两个 RunContext：

```ts
const contextA = { runId: 'A', model: 'm1', schema: 'schema-v1' }
const contextB = { runId: 'B', model: 'm2', schema: 'schema-v2' }
```

若 B 被转成 A 的 steer，断言 input-B 只能：

- 按 A context执行，并明确告诉客户端 override 被拒绝/忽略；或
- 不被 steer，等待 B 真正启动后按 B context执行。

不能把 model m2 持久为未来默认，却让 input-B 当下由 m1执行，还声称本次请求使用了 m2。

## 9. 实验 D：Queued、Recorded、Consumed 分开

事件序列：

```text
inputQueued(I)
cancelRequested
runTerminal(interrupted)
```

根据产品规则选择并断言：

- `I -> discarded`：取消时清空未记录输入；或
- `I -> recorded`：保留为未来 Run history，但明确未 consumed。

不要在 queue admission 时直接把 UI 标成“模型已收到”。

## 10. 实验 E：Cancel 与 Complete 竞争

序列一：

```text
cancelRequested(A)
runTerminal(A, interrupted)
```

序列二：

```text
cancelRequested(A)
runTerminal(A, completed)
```

两者的 cancel transport 都可能成功，但业务 outcome 不同。断言 Cancel API response 或随后可查询的 receipt 能返回 terminal status。

这就是 Codex pending interrupt 在 `TurnAborted` 和 `TurnComplete` 都回复的设计动机，也是空 `{}` 无法表达的差异。

## 11. 实验 F：Stale Steer

```text
UI reads active Run A
A completes
Run B starts
UI sends steer(expectedRunId=A)
```

断言服务端返回 expected/current mismatch，不能把输入静默送给 B。

然后测试 A→B→A 的 ABA：如果 Run ID可复用或 fixture 固定，只有 `runId + generation` 能拒绝旧请求。

## 12. Vitest 用例骨架

```ts
import { describe, expect, it } from 'vitest'

describe('run admission', () => {
  it('does not treat accepted as running', () => {
    const state: RunState = {
      runId: 'run-a',
      operationId: 'op-a',
      status: 'accepted',
      generation: 1,
      inputs: {},
    }

    const rejected = reduceRun(state, {
      type: 'runRejected',
      runId: 'run-a',
      generation: 1,
    })

    expect(rejected.status).toBe('rejected')
  })

  it('lets natural completion win a cancel race', () => {
    const running: RunState = {
      runId: 'run-a',
      operationId: 'op-a',
      status: 'running',
      generation: 1,
      inputs: {},
    }

    const cancelling = reduceRun(running, {
      type: 'cancelRequested',
      runId: 'run-a',
      generation: 1,
    })
    const completed = reduceRun(cancelling, {
      type: 'runTerminal',
      runId: 'run-a',
      generation: 1,
      status: 'completed',
    })

    expect(completed.status).toBe('completed')
  })
})
```

练习时再补非法 transition 表驱动测试，不要先搭数据库或消息队列。

## 13. 验收问题

不看文档回答：

1. 为什么 start HTTP/RPC success 不能直接令 Run 进入 Running？
2. 为什么 `clientUserMessageId` 不能自动充当 idempotency key？
3. Start 在 active Run期间到达时，有哪三种合理策略？
4. Steer response 能证明 queue、history、model consumption 中的哪一层？
5. Cancel 为什么需要 terminal outcome，而不只是 `{ success: true }`？
6. setting override 为什么必须与消费 input 的 RunContext同代？

## 14. 何时迁移到当前项目

只有开始实现以下任一能力时，才把实验结论转为正式 task：

- 同一 Conversation 的并发 Run准入。
- streaming 期间继续输入。
- cancel / interrupt。
- worker queue 与 WebSocket重连。
- per-Run model/output schema/permission override。

当前阶段先保留为可复用状态机知识，不创建 speculative queue framework。
