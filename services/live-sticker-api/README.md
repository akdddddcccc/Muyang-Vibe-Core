# live-sticker-api

未来负责贴片资产、生成任务、文字层、融合项目和导出任务。业务迁移源是冻结 demo 中较新的 `scripts/ai-workflow-server.mjs`，但本阶段不复制或执行该实现。

当前只提供 `GET /health`，用于 Frontend 验证 Core 连接；不会读取 Provider key 或调用模型。
