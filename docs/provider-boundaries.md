# Provider Adapter 边界

## 贴片图像

- OFOX 与官方 OpenAI 是不同 Adapter，不能靠替换一个通用 Base URL 和 key 视为同一实现。
- 各 Adapter 分别处理模型名、请求字段、多参考图能力、超时、错误解析和重试。
- 业务层只调用图像生成/编辑契约，不读取 Provider key。
- 文字图层的 `text`、颜色质感参考、去色字体字形参考和布局参考由 Core 统一归一化后再交给 Adapter；Adapter 不得把字体参考当成整体色彩来源。

## 任务规划

- Task Map 固定使用 DeepSeek，不经 OFOX。
- DeepSeek 的结构化拆分与图像生成服务保持隔离。

## 安全

- Provider key 只存在于部署环境或 `.env.local`。
- `Muyang-Tools-Frontend` 只读取 `CORE_API_BASE_URL`。
