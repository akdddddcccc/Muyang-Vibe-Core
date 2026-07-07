# task-map-api

未来可以拆成独立的 DeepSeek 任务规划服务。

当前第一期为了减少部署面，Task Map 接口先挂在现有 `live-sticker-api` Core 进程中：

- `POST /v1/task-map/breakdown`：只对当前节点向下拆一层，返回 3-6 个子任务。
- `POST /v1/task-map/schedule`：在父任务相对时间范围内，为直接子任务做初步甘特排期、轨道和顺承关系。

环境变量：

- `DEEPSEEK_API_KEY`：配置后优先调用 DeepSeek。
- `DEEPSEEK_BASE_URL`：可选，默认 `https://api.deepseek.com`。
- `DEEPSEEK_MODEL`：可选，默认 `deepseek-chat`。

如果未配置 `DEEPSEEK_API_KEY`，接口会返回本地兜底建议，前端仍可验收交互。
