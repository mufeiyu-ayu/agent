# Retrieval

Retrieval 以 Contract 与 Runtime Composition 为根入口，策略、持久化和评估分别放在同领域子目录。

```text
article-retrieval.ts                  # 公共 Contract、输入规范化
hybrid-article-retrieval.runtime.ts   # 正式 hybrid_rrf@1 运行时组装
retrievers/                           # lexical / Prisma / vector / hybrid 策略
persistence/                          # PostgreSQL lexical / pgvector SQL 与连接生命周期
evaluation/                           # quality-v2 评估与 CLI（`eval:retrieval-quality`；v1 baseline 已于 #135 删除）
```

依赖方向：Runtime / Evaluation -> Retrievers -> Contract / Persistence；Persistence -> Contract。目录内不提供 barrel，也不保留旧路径转发文件。

测试与实现放在同一目录；`persistence/retrieval.db.test.ts` 是 PostgreSQL / pgvector 集成测试。
