# packages/skills 导图

`@agent/skills` 只依赖 Node 标准库与已锁定的 YAML 解析器。唯一导出面 `src/index.ts`：标准 SKILL.md 元数据解析、完整包验证、相对路径边界、内容指纹和紧凑模型目录。

- 不依赖 Nest、Prisma、OSS 或其他 app；云端授权、草稿与发布留在 API。
- 文件对象只接受 path/content/encoding，拒绝符号链接、越界与不支持的类型；指纹按排序后规范化文件计算。
- `pnpm --filter @agent/skills test` / `typecheck` / `build`。消费方运行时读 dist，测试与 types 读 src。
