# 直播贴片 Core 部署与单位研发对接

## 交付范围

服务目录：`services/live-sticker-api`

- `GET /health`：前端连通性与 Provider 就绪状态。
- `POST /v1/live-sticker/typography/jobs`：创建文字图层任务。
- `GET /v1/live-sticker/typography/jobs/:id`：查询文字图层任务。

前端固定部署在 `https://cmuyang23333.top`，浏览器只读取 `VITE_CORE_API_BASE_URL`。任何 OpenAI、OFOX、DeepSeek 或单位网关 Key 都不得写入前端或 Vercel 环境变量。

## 文字图层职责划分

- `text`：用户直接输入的文案；可为空，但此时必须给 `references.layout`。
- `references.layout`：带完整排版的文本图片，只作为排版、分行、视觉层级参考。
- `references.font`：去色字体图，只约束字形、笔画节奏与局部纹理，不控制整体色彩。
- `references.color`：上贴或用户色彩质感参考，控制整体色彩、材质和小装饰。
- `fontPresetKey`：内置字体预设键，仅在无自定义字体图时补充字形参考。

Core 不直接假定 OFOX 与官方 OpenAI 的图像编辑 API 兼容。单位研发应部署一个 Provider Adapter，由 Adapter 处理模型、请求字段、多参考图、超时、重试和错误解析。

## 环境变量

复制 `services/live-sticker-api/.env.example` 到服务器上的 `/etc/muyang/live-sticker-api.env`：

```dotenv
CORE_HOST=0.0.0.0
CORE_PORT=8787
CORS_ORIGIN=https://cmuyang23333.top
TYPOGRAPHY_ADAPTER_URL=https://adapter.company.example/v1/typography/generate
TYPOGRAPHY_ADAPTER_TOKEN=replace-with-server-side-secret
```

`TYPOGRAPHY_ADAPTER_URL` 未设置时，Core 返回 `503 provider_not_configured`。这是预期的安全行为，不是前端故障。

## Provider Adapter 契约

Core 会向 `TYPOGRAPHY_ADAPTER_URL` 发 `POST`：

```json
{
  "jobId": "uuid",
  "input": {
    "text": "NOBOOK · 618 狂欢季",
    "fontPresetKey": "expressive-calligraphy",
    "references": {
      "color": { "assetId": "...", "mimeType": "image/jpeg" },
      "font": { "assetId": "...", "mimeType": "image/png" },
      "layout": { "assetId": "...", "mimeType": "image/png" }
    }
  }
}
```

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

Nginx 或单位网关将 `https://api.cmuyang23333.top` 反向代理到 `127.0.0.1:8787`，必须启用 HTTPS。

## systemd 部署

1. 将仓库部署到 `/opt/muyang-vibe-core`。
2. 创建运行用户：`sudo useradd --system --home /opt/muyang-vibe-core --shell /usr/sbin/nologin muyang`。
3. 写入 `/etc/muyang/live-sticker-api.env` 并设置 `chmod 600`。
4. 复制 `services/live-sticker-api/deploy/live-sticker-api.service` 到 `/etc/systemd/system/`。
5. 执行 `sudo systemctl daemon-reload && sudo systemctl enable --now live-sticker-api`。

## 验收清单

```bash
curl -fsS https://api.cmuyang23333.top/health
curl -fsS -X POST https://api.cmuyang23333.top/v1/live-sticker/typography/jobs \
  -H 'Content-Type: application/json' \
  --data '{"text":"NOBOOK · 618 狂欢季","fontPresetKey":"expressive-calligraphy"}'
```

- `/health` 返回 `status: ok`。
- Adapter 配置前，创建任务返回可读的 `503 provider_not_configured`。
- Adapter 配置后，创建任务返回 `202` 或 Adapter 同步完成结果；轮询接口能查询同一任务。
- 浏览器只允许 `https://cmuyang23333.top` 跨域访问。
- Provider Key 不出现在浏览器、Git 提交、Vercel 日志或接口响应中。
