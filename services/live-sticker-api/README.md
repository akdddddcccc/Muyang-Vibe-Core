# live-sticker-api

负责贴片资产、生成任务、文字层、融合项目和导出任务。业务迁移源是冻结 demo 中较新的 `scripts/ai-workflow-server.mjs`；OFOX 与官方 OpenAI 的差异由独立 Provider Adapter 处理。

当前提供 `GET /health`、`POST /v1/live-sticker/typography/jobs` 与 `GET /v1/live-sticker/typography/jobs/:id`。部署与 Adapter 契约见 [../../docs/unit-rd-live-sticker-deployment.md](../../docs/unit-rd-live-sticker-deployment.md)。
