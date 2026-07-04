# Codex Runtime 架构图

```mermaid
mindmap
  root((Codex Agent Runtime))
    Entrypoints
      TUI
      exec
      SDK
      app-server
    Protocol
      thread/start
      thread/resume
      thread/fork
      turn/start
      turn/interrupt
    Core Runtime
      Session
      Submission Queue
      Task
      Turn
      Event Queue
    Model Streaming
      Prompt
      ModelClientSession
      ResponseEvent
      Delta
      Completed
    Tools
      ToolSpec
      ToolRouter
      ToolRegistry
      ToolRuntime
      Observation
    Safety
      Approval
      ExecPolicy
      PermissionProfile
      Sandbox
    Context
      UI Transcript
      Model History
      Runtime Event
      Rollout
      Compaction
    Extensibility
      Skills
      Plugins
      MCP
```

## 关键分界

- Entrypoints 只负责输入和展示。
- Protocol 负责稳定契约。
- Core Runtime 才执行 Agent loop。
- ToolSpec 和 ToolRuntime 必须分开。
- UI transcript、model history、runtime event、persistent log 是四种数据。
