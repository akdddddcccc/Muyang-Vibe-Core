# Provider Adapter 边界

## 贴片图像

- OFOX 与官方 OpenAI 是不同 Adapter，不能靠替换一个通用 Base URL 和 key 视为同一实现。
- 各 Adapter 分别处理模型名、请求字段、多参考图能力、超时、错误解析和重试。
- 业务层只调用图像生成/编辑契约，不读取 Provider key。
- 文字图层的 `text`、颜色质感参考、去色字体字形参考和布局参考由 Core 统一归一化后再交给 Adapter；Adapter 不得把字体参考当成整体色彩来源。
- 单位正式直播贴片工具固定走 OFOX Adapter，前端不提供 Provider 选择；OpenAI Adapter 只保留为隔离的实验或迁移能力。
- 微调已有文字层时，`references.typography` 提供字形、字体、颜色与纹理；存在 `references.color` 时，颜色质感参考优先。Adapter 必须生成 `matte` 指定的纯白或纯黑实底稿，供后续抠图。

## 任务规划

- Task Map 固定使用 DeepSeek，不经 OFOX。
- DeepSeek 的结构化拆分与图像生成服务保持隔离。

## 安全

- Provider key 只存在于部署环境或 `.env.local`。
- `Muyang-Tools-Frontend` 只读取 `VITE_CORE_API_BASE_URL`。`cmuyang23333.top` 当前是验收与作品集合入口；单位正式域名可直接部署同一前端构建。
