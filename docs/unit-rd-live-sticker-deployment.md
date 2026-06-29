# 直播贴片 Core 部署与单位研发对接

完整产品、交互与联调边界见 [unit-rd-live-sticker-handoff.md](./unit-rd-live-sticker-handoff.md)。本文聚焦部署命令与 Adapter HTTP 契约。

## 交付范围

服务目录：`services/live-sticker-api`

- `GET /health`：前端连通性与 Provider 就绪状态。
- `POST /v1/live-sticker/typography/jobs`：创建文字图层任务。
- `GET /v1/live-sticker/typography/jobs/:id`：查询文字图层任务。

当前 `https://cmuyang23333.top` 上的前端仅用于验收与 Vibe Coding 作品展示；未来它会回到“产出集合页”，再跳转到单位正式工具页面。正式版前端可以与 Core 一起部署到单位官方服务器和官方域名，或保留单独静态托管。两种部署形态均只让浏览器读取 `VITE_CORE_API_BASE_URL`，任何 OFOX、OpenAI、DeepSeek 或单位网关 Key 都不得写入前端、Vercel 环境变量或静态构建产物。

正式部署建议：单位网关将正式前端与 `live-sticker-api` 置于同一官方站点，前端以相对 `/api` 或正式 Core 地址访问；验收站点则单独把 `VITE_CORE_API_BASE_URL` 指向允许跨域的预发布 Core。

## 文字图层职责划分

- `mode: create`：新建文字图层，`text` 可为空，但此时必须给 `references.layout`。
- `mode: refine`：微调已有文字层，必须提供新 `text` 和 `references.typography`。
- `instruction`：非必填的定制化说明，例如指定某段文字的强调色、层级或视觉取向。
- `matte`：微调模式的实底输出，固定为 `white` 或 `black`，供后续透明抠图使用。
- `references.layout`：带完整排版的文本图片，只作为排版、分行、视觉层级参考。
- `references.font`：去色字体图，只约束字形、笔画节奏与局部纹理，不控制整体色彩。
- `references.color`：上贴或用户色彩质感参考，控制整体色彩、材质和小装饰。
- `references.typography`：已有文字图层。在微调模式中，它提供字形、字体、颜色和纹理；若同时存在 `references.color`，颜色与质感以 `references.color` 为准。
- `fontPresetKey`：内置字体预设键，仅在无自定义字体图时补充字形参考。

单位设计工具默认且仅使用 OFOX。前端没有 Provider 选择器；Core 将规范化请求交给 OFOX Adapter。官方 OpenAI Adapter 可作为独立实验或迁移组件保留，但不参与本工具的默认生产路径。Adapter 负责 OFOX 的模型、请求字段、多参考图、超时、重试、错误解析，以及输出纯白/纯黑底稿。

## 环境变量

复制 `services/live-sticker-api/.env.example` 到服务器上的 `/etc/muyang/live-sticker-api.env`：

```dotenv
CORE_HOST=0.0.0.0
CORE_PORT=8787
CORS_ORIGIN=https://cmuyang23333.top,https://tool.company.example
OFOX_API_KEY=replace-with-server-side-secret
OFOX_BASE_URL=https://api.ofox.ai/v1
OFOX_IMAGE_MODEL=openai/gpt-image-2
OFOX_IMAGE_QUALITY=low
OFOX_TEXT_LAYER_SIZE=1536x1024

# Optional external normalized Adapter:
OFOX_TYPOGRAPHY_ADAPTER_URL=
OFOX_TYPOGRAPHY_ADAPTER_TOKEN=
```

最小部署可不设外部 Adapter，改为设置 `OFOX_API_KEY`、`OFOX_BASE_URL=https://api.ofox.ai/v1`、`OFOX_IMAGE_MODEL=openai/gpt-image-2` 与 `OFOX_TEXT_LAYER_SIZE=1536x1024`，由 Core 内置 Adapter 直接生成文字层。只有单位独立部署了归一化 Adapter 时才设置 `OFOX_TYPOGRAPHY_ADAPTER_URL`；不得把 OFOX 原始 Base URL 填入该变量。两种路径都未配置时，Core 返回 `503 provider_not_configured`。

## Provider Adapter 契约

Core 会向 `OFOX_TYPOGRAPHY_ADAPTER_URL` 发 `POST`：

```json
{
  "jobId": "uuid",
  "input": {
    "text": "NOBOOK · 618 狂欢季",
    "fontPresetKey": "expressive-calligraphy",
    "mode": "create",
    "matte": "white",
    "instruction": "突出 618，副标题较克制",
    "references": {
      "color": { "assetId": "...", "mimeType": "image/jpeg" },
      "font": { "assetId": "...", "mimeType": "image/png" },
      "layout": { "assetId": "...", "mimeType": "image/png" },
      "typography": { "assetId": "...", "mimeType": "image/png" }
    }
  }
}
```

微调模式下，Adapter 必须将 `references.typography` 作为字形来源；若有 `references.color`，以它覆盖前者的颜色、质感与装饰。Adapter 输出应是指定 `matte` 的纯色实底图，再由后续抠图流程转为透明 PNG。

Adapter 需要返回：

```json
{
  "status": "completed",
  "result": {
    "id": "asset-uuid",
    "kind": "typography",
    "format": "png",
    "source": "generated",
    "fileName": "typography.png",
    "mimeType": "image/png",
    "sizeBytes": 12345,
    "url": "https://asset-host.example/typography.png",
    "createdAt": "2026-06-24T00:00:00.000Z"
  }
}
```

如需异步队列，Adapter 可先返回 `{ "status": "queued" }`；正式版应将任务状态写入 Redis 或数据库，替换当前 Core 的内存任务表。

## Docker 部署

在仓库根目录执行：

```bash
docker build -f services/live-sticker-api/Dockerfile -t muyang/live-sticker-api:0.2.0 .
docker run -d --name live-sticker-api --restart unless-stopped \
  --env-file /etc/muyang/live-sticker-api.env \
  -p 127.0.0.1:8787:8787 \
  muyang/live-sticker-api:0.2.0
```

Nginx 或单位网关将正式 API 域名（例如 `https://api.tool.company.example`）反向代理到 `127.0.0.1:8787`，必须启用 HTTPS。验收期间可另设预发布 API 地址供 `cmuyang23333.top` 使用；不要将验收域名写成正式产品的唯一前提。

## systemd 部署

1. 将仓库部署到 `/opt/muyang-vibe-core`。
2. 创建运行用户：`sudo useradd --system --home /opt/muyang-vibe-core --shell /usr/sbin/nologin muyang`。
3. 写入 `/etc/muyang/live-sticker-api.env` 并设置 `chmod 600`。
4. 复制 `services/live-sticker-api/deploy/live-sticker-api.service` 到 `/etc/systemd/system/`。
5. 执行 `sudo systemctl daemon-reload && sudo systemctl enable --now live-sticker-api`。

## 验收清单

```bash
curl -fsS https://api.tool.company.example/health
curl -fsS -X POST https://api.tool.company.example/v1/live-sticker/typography/jobs \
  -H 'Content-Type: application/json' \
  --data '{"text":"NOBOOK · 618 狂欢季","fontPresetKey":"expressive-calligraphy","mode":"create","matte":"white"}'
```

- `/health` 返回 `status: ok`。
- Adapter 配置前，创建任务返回可读的 `503 provider_not_configured`。
- Adapter 配置后，创建任务返回 `202` 或 Adapter 同步完成结果；轮询接口能查询同一任务。
- CORS 同时列出验收域名和单位正式前端域名；正式稳定后可移除验收域名。
- Provider Key 不出现在浏览器、Git 提交、Vercel 日志或接口响应中。
