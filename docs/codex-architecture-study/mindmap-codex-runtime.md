# Codex Runtime 架构思维导图

```mermaid
mindmap
  root((Codex Agent Runtime))
    Entrypoints
      CLI
        MultitoolCli
        exec
        app-server
      TUI
        TopCli
        run_main
      SDK
        Python JSON-RPC app-server client
        TypeScript codex exec JSONL client
      app-server-client
        InProcessAppServerClient
        typed channels
    Protocol Facade
      app-server
        JSON-RPC
        initialize
        thread/start
        thread/resume
        thread/fork
        turn/start
        turn/interrupt
      MessageProcessor
        ThreadRequestProcessor
        TurnRequestProcessor
        Plugin/MCP/Config processors
      ThreadState
        listener
        rejoin
        notification projection
    Core Runtime
      Codex
        submission queue
        event queue
      Session
        config
        active turn
        input queue
        services
        approvals
      Task
        RegularTask
        CompactTask
        cancellation
      Turn
        TurnContext
        StepContext
        run_turn
    Model Streaming
      ModelClient
      ModelClientSession
      Prompt
        input
        tools
        instructions
        output schema
      ResponseEvent
        OutputTextDelta
        OutputItemDone
        Completed
    Tools
      ToolSpec
        model visible contract
      ToolRouter
        build_tool_call
      ToolRegistry
        dispatch
        hooks
        telemetry
      ToolRuntime
        shell
        exec_command
        apply_patch
        MCP
        dynamic tools
      Observation
        ResponseInputItem output
        follow-up sampling
    Safety
      Approval
        ExecApprovalRequest
        PatchApprovalRequest
        ReviewDecision
      ExecPolicy
        Allow
        Prompt
        Forbidden
      Permissions
        PermissionProfile
        FileSystemSandboxPolicy
        NetworkSandboxPolicy
      Sandbox
        SandboxManager
        macOS Seatbelt
        Linux sandbox
        Windows restricted token
      Execution
        execute_env
        exec-server
        spawn
    History and Persistence
      UI transcript
        ThreadHistoryBuilder
        ThreadItem
      Model history
        ContextManager
        ResponseItem
        normalize_history
      Runtime event
        EventMsg
        deltas
        approvals
        tool progress
      Rollout
        RolloutRecorder
        RolloutItem
        policy filtering
      ThreadStore
        LiveThread
        JSONL rollout
        SQLite metadata
      Compaction
        context_window_token_status
        run_auto_compact
        replacement_history
    Extensibility
      Skills
        SKILL.md
        SkillsService
        context budget
      Plugins
        manifest
        skills
        mcp_servers
        apps
        hooks
      MCP
        codex-mcp client
        mcp-server exposes codex tools
```

## 阅读提示

这张图的重点不是模块数量，而是几个关键分界：

- Entrypoints 只负责输入和展示，不跑 Agent loop。
- app-server 是协议门面，不是第二套 runtime。
- core runtime 通过 queue/event 处理异步 turn。
- tool spec、router、registry、runtime 是四层，不应该混成一个函数。
- UI transcript、model history、runtime event、rollout 是四种不同数据。
- permission approval 与 sandbox 解决的是不同风险。
