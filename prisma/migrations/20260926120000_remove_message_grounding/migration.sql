-- 删除 Phase 8 的 Grounding 持久化（Issue #185）：MessageGrounding 表连同它指向 Message 的级联外键。
-- 旧迁移 20260815160000_add_message_grounding 保留作历史，本迁移在其之后顺序执行；老数据不迁移。

-- DropTable
DROP TABLE IF EXISTS "MessageGrounding";
