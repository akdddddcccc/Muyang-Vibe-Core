# GitHub 库与产品架构总览

`MYportfolio` 是冻结的作品集与交互 demo；正式开发只发生在 `Muyang-Tools-Frontend` 与 `Muyang-Vibe-Core`。

## 横向：仓库职责

```mermaid
flowchart LR
  Portfolio["MYportfolio<br/>公开 · 作品集与冻结 demo"]
  Frontend["Muyang-Tools-Frontend<br/>公开 · 正式 Web 前端"]
  Core["Muyang-Vibe-Core<br/>公开 · API / Adapter / 桌面端基础"]
  Career["Muyang-Career<br/>私有 · 职业资料"]
  Legacy["历史原型库<br/>迁移参考后归档"]

  Portfolio --> P["项目叙事、Task Map demo、贴片 demo、正式版入口"]
  Frontend --> F["React 工作台、浏览器交互、下载入口"]
  Core --> C["共享契约、服务、Provider Adapter、Electron"]
  Career --> R["简历与职业事实库"]
  Legacy --> L["只读历史和迁移参考"]
```

## 纵向：产品与部署关系

```mermaid
flowchart TB
  Portfolio["muyang23333.top<br/>MYportfolio"]
  TaskDemo["Task Map demo"]
  StickerDemo["直播贴片 demo"]
  Acceptance["cmuyang23333.top<br/>验收页 / Vibe Coding 产出集合"]
  Tools["单位官方工具域名<br/>Muyang-Tools-Frontend"]
  TaskProduct["Task Map 正式版"]
  StickerProduct["直播贴片正式版"]
  Background["背景生成"]
  Typography["文字图层"]
  Composition["效果融合"]
  Export["导出资产"]
  Core["Muyang-Vibe-Core"]
  TaskApi["task-map-api<br/>DeepSeek"]
  StickerApi["live-sticker-api"]
  StickerAdapter["OFOX 贴片 Adapter"]
  TaskAdapter["DeepSeek Task Map Adapter"]
  Desktop["Electron 桌面端"]
  Api["单位官方 API / 预发布 API"]

  Portfolio --> TaskDemo
  Portfolio --> StickerDemo
  Portfolio --> Acceptance
  TaskDemo -. "需求与交互参考" .-> TaskProduct
  StickerDemo -. "需求与交互参考" .-> StickerProduct
  Acceptance -. "验收后跳转" .-> Tools
  Tools --> TaskProduct
  Tools --> StickerProduct
  StickerProduct --> Background
  StickerProduct --> Typography
  StickerProduct --> Composition
  StickerProduct --> Export
  TaskProduct --> TaskApi
  StickerProduct --> StickerApi
  TaskApi --> TaskAdapter
  StickerApi --> StickerAdapter
  Core --> TaskApi
  Core --> StickerApi
  Core --> Desktop
  Tools --> Api
  TaskApi --> Api
  StickerApi --> Api
```

## 关键边界

- `cmuyang23333.top` 当前用于验收，后续会成为 Vibe Coding 产出集合并跳转到单位正式工具页；同一前端构建可部署在单位官方服务器。
- Frontend 只通过 `VITE_CORE_API_BASE_URL` 访问 Core，浏览器不能保存 Provider key。
- 单位正式直播贴片工具固定使用 OFOX Adapter，不提供 Provider 选择器；Task Map 仍固定通过 DeepSeek Adapter。
- 背景生成、文字图层、效果融合和导出资产均可独立使用，也可复用同一项目资产。
- 项目配置 JSON、上下贴透明边缘纹理均为后期高级能力，第一期不开放。
