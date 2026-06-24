# AI 直播贴片工作台研发交接

本文是单位研发、部署和联调使用的单一交接入口。部署命令与 Adapter HTTP 契约见 [unit-rd-live-sticker-deployment.md](./unit-rd-live-sticker-deployment.md)。

## 1. 产品边界

- 冻结演示：`MYportfolio` 中的直播贴片 demo 不再改动。
- 正式前端：`Muyang-Tools-Frontend`，React/Vite 工作台。
- 正式 Core：`Muyang-Vibe-Core`，包含共享契约和 `services/live-sticker-api`。
- 单位正式直播贴片工具固定使用 **OFOX**。前端不显示 Provider 选择，也不保存 Provider Key。
- Task Map 是独立产品，固定使用 DeepSeek，不与本工具共用 Provider 选择逻辑。

## 2. 域名与部署角色

| 位置 | 当前角色 | 后续角色 |
| --- | --- | --- |
| `muyang23333.top` | 个人作品集和冻结 demo | 保持作品集职责 |
| `cmuyang23333.top` | 前端验收页 | Vibe Coding 产出集合页，可跳转正式工具 |
| 单位官方工具域名 | 可先不启用 | 正式 Web 工作台入口 |
| 单位 API 域名 | 预发布 / 联调 API | `live-sticker-api` 正式入口 |

正式前端可以部署在单位服务器，与 Core 同域由网关代理；也可以使用独立静态托管。验收页与正式页使用同一前端代码，但各自设置自己的 `VITE_CORE_API_BASE_URL`。

## 3. 前端配置与安全

前端构建仅允许以下公开配置：

```dotenv
VITE_CORE_API_BASE_URL=https://api.tool.company.example
```

- 该变量只能指向 Core API；不得写入 OFOX、OpenAI、DeepSeek 或单位网关的 URL、Key、模型名。
- Unit 网关可将 `/api` 代理到 Core，并将上面的值设为相对 `/api`。
- Core 的 CORS 必须同时包含验收页与正式单位页；正式稳定后可删除验收域名。

## 4. Core 与 OFOX 配置

服务目录：`services/live-sticker-api`。

```dotenv
CORE_HOST=0.0.0.0
CORE_PORT=8787
CORS_ORIGIN=https://cmuyang23333.top,https://tool.company.example
OFOX_TYPOGRAPHY_ADAPTER_URL=https://ofox-adapter.company.example/v1/typography/generate
OFOX_TYPOGRAPHY_ADAPTER_TOKEN=server-side-secret
```

- Key 只放在 Adapter 的受保护环境变量中，不进入浏览器、Git、Vercel 日志或 Core 响应。
- `OFOX_TYPOGRAPHY_ADAPTER_URL` 未配置时，Core 对文字任务返回 `503 provider_not_configured`，这是可读的预期状态。
- 旧的 `TYPOGRAPHY_ADAPTER_*` 仅保留本地迁移兼容，正式部署请只配置 `OFOX_TYPOGRAPHY_ADAPTER_*`。

## 5. 核心接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 检查 Core 与 OFOX Adapter 就绪状态 |
| `POST` | `/v1/live-sticker/typography/jobs` | 创建文字图层任务 |
| `GET` | `/v1/live-sticker/typography/jobs/:id` | 查询文字图层任务 |

### 文字图层：新建模式

```json
{
  "text": "NOBOOK · 618 狂欢季\n重走真理诞生路",
  "fontPresetKey": "expressive-calligraphy",
  "mode": "create",
  "matte": "white",
  "instruction": "突出 618，副标题更克制",
  "references": {
    "color": { "assetId": "top-sticker-or-colour-reference" },
    "font": { "assetId": "desaturated-glyph-reference" },
    "layout": { "assetId": "optional-layout-reference" }
  }
}
```

- `references.color` 优先决定颜色、质感和装饰；未提供时，前端默认使用本项目最新上贴。
- `references.font` 只学习字形、笔画与局部纹理，不能覆盖整体色彩。
- `references.layout` 仅参考排版、换行和层级。

### 文字图层：微调已有文字层

```json
{
  "text": "替换后的新文本",
  "fontPresetKey": "elegant-songti",
  "mode": "refine",
  "matte": "black",
  "references": {
    "typography": { "assetId": "existing-text-layer" },
    "color": { "assetId": "optional-colour-material-override" }
  }
}
```

- `mode: refine` 必须同时有 `text` 和 `references.typography`。
- 已有文字层提供字形、字体、颜色、纹理；若提供 `references.color`，它覆盖已有文字层的颜色、质感和装饰。
- OFOX Adapter 必须输出指定 `matte` 的纯白或纯黑实底图片；后续抠图再生成透明 PNG。

## 6. 前端资产与画板约定

### 资产

- 所有上传区域支持点击选图和悬停后 `Ctrl/Cmd + V` 粘贴图片。
- 文字图层 PNG 在进入画板前按 alpha 有效像素预剪裁，避免大透明画布使文字显得过小。
- 背景、文字、融合均复用同一浏览器项目资产；每个工具下方都有“产出预览”，可单独验收最近结果。

### 融合输出

- 最终逻辑画布固定为 **1080 × 1920 px（9:16）**；浏览器显示的是等比例缩略预览。
- 上贴、下贴初始置入横向铺满 1080 宽度，再按原图比例计算高度。
- 侧贴初始宽度为画布约 20%，高度由原图比例确定，初始位于右侧中部。
- 文字图层保留透明边界并按其有效像素比例置入。

### 交互规则

- 选中图层后使用方向键移动 1% 画布坐标；按住 `Shift` 每次移动 5%。右侧面板显示对应的 1080×1920 像素坐标，但不提供位置鼠标滑条。
- 只有侧贴可用鼠标拖动改变位置；其他图层只能键盘定位。
- 缩放、透明度、默认羽化仍可在属性栏调整。
- 羽化语义是“边界渐隐”：上贴仅沿下边界渐隐，下贴仅沿上边界渐隐，不能影响外侧和左右边界。
- 手绘渐隐只作用于上贴和下贴；按住 `Shift` 可画水平线。

## 7. OFOX Adapter 责任

Adapter 负责单位网关与 OFOX 的实际请求，Core 只负责归一化业务参数和任务状态。

- 处理 OFOX 模型、图片格式、多参考图、超时、重试和错误信息。
- 背景生成的上贴、下贴、侧贴为独立任务；前端可先使用项目中已有素材进行融合。
- 文字层按第 5 节的参考图优先级执行。
- 输出贴片时：首轮背景优先 JPEG；需要透明底、透明遮罩或文字抠图时输出 PNG。
- 生产环境应将内存任务表替换为 Redis 或数据库，并把生成资产写入受控对象存储。

## 8. 联调验收

1. `GET /health` 返回 `status: ok`，并显示 `typographyProvider: ofox`。
2. 未配置 OFOX Adapter 时，创建文字任务返回可读的 `503`；配置后返回 `202` 或已完成任务。
3. 新建模式验证上贴色彩继承、字体参考不抢占色彩、可选布局参考。
4. 微调模式验证已有文字层继承；上传颜色质感覆盖参考后应覆盖其视觉颜色。
5. 融合画板验证 1080×1920 标记、上/下贴满宽初始状态、侧贴可拖动、方向键与 `Shift` 位置移动。
6. 验证默认羽化只影响上贴下沿或下贴上沿；手绘渐隐按 `Shift` 为水平线。
7. 验证中文 / English 切换覆盖导航、背景、文字、融合、导出与产出预览。
8. 在验收域名和单位正式域名分别验证 CORS；浏览器源码、网络请求与构建日志中不应出现 Provider Key。

## 9. 当前非目标

- 项目配置 JSON、透明边缘火焰/云层纹理是后期高级功能，当前不开放。
- 移动端 App、桌面端打包、导出 ZIP 与后台资产持久化不在本轮前端验收范围。
- `cmuyang23333.top` 不是单位正式工具的长期唯一域名。
