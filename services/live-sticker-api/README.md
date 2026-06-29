# live-sticker-api

负责上贴、下贴、侧贴和透明文字图层生成。业务迁移源是冻结 demo 中较新的 `scripts/ai-workflow-server.mjs`。单位正式直播贴片路径固定使用 OFOX；浏览器侧不选择 Provider、也不保存任何 Key。

当前提供 `GET /health`、背景任务 `/v1/live-sticker/background/jobs` 和文字任务 `/v1/live-sticker/typography/jobs`。内置 OFOX Adapter 支持多参考图编辑、无参考图生成和文字实底自动抠透明；部署说明见 [../../docs/unit-rd-live-sticker-deployment.md](../../docs/unit-rd-live-sticker-deployment.md)。
