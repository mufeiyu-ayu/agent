-- 思考协议改由服务商家族决定（deepseek 走 thinking / reasoning_content，其余不走），模型行不再单独配置。
ALTER TABLE "LlmModel" DROP COLUMN "reasoning";
