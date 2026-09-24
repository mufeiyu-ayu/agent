-- 服务商是否经 OUTBOUND_PROXY_URL 访问；只加列，已有的行都是 false（直连）。
ALTER TABLE "LlmProvider" ADD COLUMN "useProxy" BOOLEAN NOT NULL DEFAULT false;
