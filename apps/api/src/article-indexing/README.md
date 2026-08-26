# Article Indexing

`article-chunking.ts` 是稳定 Facade，保留 Article Indexer、Repository、Retrieval 与测试使用的公开导出路径。

## Chunking 内部边界

```text
article-chunking.ts
  -> chunking/structural-blocks.ts
  -> chunking/deterministic-chunker.ts
       -> structural-blocks.ts
       -> token-counter.ts
  -> chunking/token-counter.ts
```

- `structural-blocks.ts`：HTML canonicalization、结构块提取与 `sourceHash`。
- `deterministic-chunker.ts`：Chunk unit、overlap、ordinal、内容哈希与稳定 ID。
- `token-counter.ts`：cl100k token 计数、缓存与长 BPE piece 的有界实现。

领域外代码只从 `article-chunking.ts` 导入；内部模块不反向依赖 Facade。
