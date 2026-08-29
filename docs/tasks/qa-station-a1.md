# 翻译质检站 A-1：快照导入与术语库/文章列表模块

- Issue：#109（Closed）/ PR：#110（merge `d2a2ba9`）
- 实施状态：已实现
- 验收状态：已验收（Completed，2026-08-29 用户浏览器验收确认）

## 目标

建立翻译质检站（阶段 A）数据基座：导入 2026-08-29 生产快照，在 admin 交付「文章」「术语库」两个真数据只读模块，作为 A-2（译文对照详情 + mock 动作）的地基。

## 范围与事实

- 温层 schema 一次钉死：`ArticleTranslation`、`Glossary` / `GlossaryTerm` / `GlossaryTermTranslation`、`TranslationScore`（含 verdict 三档与审核状态，A-1 只建表不消费）；`Article` 增补 summary / isPublished / publishedAt / isQaCandidate / termHitCount。
- 幂等导入脚本 `apps/api/scripts/import-qa-snapshot.ts`：先清后导，可重复执行。
- NestJS 新模块 `admin-qa`（只读三接口：文章列表 / 术语库列表 / 词条列表），不触碰 agent-runtime / llm / seo。
- admin 新增「质检站」侧栏分组与三个页面：文章列表（标题 / slug / 语言完整度 / 术语命中 / 质检集标记 / 发布时间 + 筛选）、术语库列表、词条页（中文源文本 + 目标语言切换 + 搜索）。
- contracts 新增 `admin-qa.ts` 六个类型。

## 验证证据（2026-08-29）

- 导入统计：文章 1654（快照元数据 1728，74 篇无中文原文跳过）、质检集 150、译文 2638、术语库 8 / 8725 / 156758，与快照对账一致。
- 服务层对真库自检：列表 1654 条 / 552 页；`qaCandidateOnly` 过滤 150；标题搜索「原神」99 条；语言完整度 18/19 正确；术语库 8 本（原神 2022 词条 / 18 语种等）；词条页 zh→en 投影与语言切换正确。
- `pnpm typecheck`（web / admin / api 三 workspace）、admin 与 api eslint、`prisma validate` + migration 通过；`admin-qa.service.test.ts` 4/4 通过。
- UI 页面效果待用户在浏览器验收（Claude Code 按约定不启动 dev server）。

## 边界记录

- 快照中 74 篇文章元数据无对应中文原文（zh* 行缺失），按 Issue 边界跳过并在导入统计中报告。
- 生产 schema 与本地 vcode_api 迁移偏差已确认：`slug` 在 `articles` 表；`article_translations` 无 slug 列。
- 部分「中文原文」为繁体（原文语言不统一），已作为质检站后续的真实问题记录。
