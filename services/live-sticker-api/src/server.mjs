import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";

const host = process.env.CORE_HOST ?? "127.0.0.1";
const port = Number(process.env.CORE_PORT ?? 8787);
const allowedOrigins = (process.env.CORS_ORIGIN ?? "*").split(",").map((origin) => origin.trim()).filter(Boolean);
const adapterUrl = (process.env.OFOX_TYPOGRAPHY_ADAPTER_URL ?? process.env.TYPOGRAPHY_ADAPTER_URL)?.replace(/\/$/, "");
const adapterToken = process.env.OFOX_TYPOGRAPHY_ADAPTER_TOKEN ?? process.env.TYPOGRAPHY_ADAPTER_TOKEN;
const ofoxApiKey = process.env.OFOX_API_KEY;
const ofoxBaseUrl = (process.env.OFOX_BASE_URL ?? "https://api.ofox.ai/v1").replace(/\/$/, "");
const ofoxImageModel = process.env.OFOX_IMAGE_MODEL ?? "openai/gpt-image-2";
const ofoxImageQuality = process.env.OFOX_IMAGE_QUALITY ?? "low";
const textLayerSize = process.env.OFOX_TEXT_LAYER_SIZE ?? "1536x1024";
const jobs = new Map();
const typographyPresetKeys = new Set(["elegant-songti", "expressive-calligraphy", "rounded-cute", "custom-reference"]);
const stickerSpecs = {
  top: {
    label: "上贴", size: "1536x1024", direction: "top banner, landscape",
    instruction: "生成直播间顶部横向贴片。顶部 35% 和左右边缘可有装饰、材质和光效，必须保留参考图的主色、饱和度、线条对比和深浅层次，不能泛白、雾化或褪色；只有底边 25% 可以自然过渡到中性纯白或近白背景。若存在聚焦感，视觉轻微向下汇聚，但不要形成明确主体或海报中心。",
  },
  bottom: {
    label: "下贴", size: "1536x1024", direction: "bottom banner, landscape",
    instruction: "生成直播间底部横向贴片。下沿 35% 可承载主要装饰、材质和光效，必须保留参考图的主色、饱和度、线条对比和深浅关系，不能泛白、雾化或褪色；只有顶边 25% 可以自然过渡到中性纯白或近白背景。若存在聚焦感，视觉轻微向上汇聚，但不要形成明确主体或促销海报感。",
  },
  side: {
    label: "侧贴", size: "1024x1536", direction: "side banner, portrait",
    instruction: "生成直播间侧边竖向窄幅贴片。装饰只允许沿一侧外边缘单侧生长，可集中在左上角、上沿或外侧边缘；另一侧与大部分区域必须保持素净、透气。严禁左右对半、镜像对称、中央分割、双栏、门框式构图、两侧同时出现同等装饰。严禁密铺、平铺、网格式重复、连续小图案、壁纸纹样或满版装饰。不要强纵深、中心主体或密集信息排版。",
  },
};

const backgroundBasePrompt = `根据当前唯一参考图生成直播间贴片背景底图。
本次请求只允许使用当前上传的这一张参考图；不存在任何历史参考图、缓存图片或上一轮素材。
只继承当前参考图的构图气质、色彩关系、材质、光效、边缘装饰密度和留白方式，不复刻其主体、物件、文字或场景。
颜色锁定：装饰区域必须保持参考图主要颜色的饱和度、明度层次和深色线条对比，不能把彩色装饰整体洗成浅灰、浅粉、浅蓝或接近白色。
留白只发生在指定过渡边缘，不允许把整张贴片做成低饱和、雾化、褪色、奶白或半透明质感。
将参考图中的主体转译为抽象背景语言，使画面适合叠加直播间内容。
整体干净、透气，过渡边缘自然，不抢直播主体。`;

const backgroundNegativePrompt = "禁止生成：参考图中的原始主体或物件、任何其他图片痕迹、文字、logo、二维码、人物、具体商品、价格、优惠券、促销标签、按钮、信息图、海报模板、广告版式、月亮、天体、球体、强中心主体、强边框、深色压迫背景、过密装饰、脏灰底色、整图泛白、整图雾化、低饱和褪色、彩色线条变浅、装饰区域接近白色、平铺纹样、重复贴图。";

function corsOrigin(request) {
  if (allowedOrigins.includes("*")) return "*";
  const origin = request.headers.origin;
  return origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? "null";
}

function sendJson(request, response, statusCode, body) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": corsOrigin(request),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Request-Id",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });
  response.end(JSON.stringify(body));
}

function sendOptions(request, response) {
  response.writeHead(204, {
    "Access-Control-Allow-Origin": corsOrigin(request),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Request-Id",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  });
  response.end();
}

async function readJson(request, maxBytes = 32_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid_json");
  }
}

function normalizeReference(value) {
  if (!value || typeof value !== "object") return undefined;
  const reference = {};
  if (typeof value.assetId === "string" && value.assetId.length <= 160) reference.assetId = value.assetId;
  if (typeof value.mimeType === "string" && value.mimeType.startsWith("image/")) reference.mimeType = value.mimeType;
  if (typeof value.dataUrl === "string" && value.dataUrl.startsWith("data:image/") && value.dataUrl.length <= 12_000_000) reference.dataUrl = value.dataUrl;
  return reference.dataUrl ? reference : undefined;
}

function validateTypographyRequest(payload) {
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const fontPresetKey = typeof payload.fontPresetKey === "string" ? payload.fontPresetKey : "elegant-songti";
  const mode = payload.mode === "refine" ? "refine" : "create";
  const matte = payload.matte === "black" ? "black" : "white";
  const instruction = typeof payload.instruction === "string" ? payload.instruction.trim() : "";
  const references = {
    color: normalizeReference(payload.references?.color),
    font: normalizeReference(payload.references?.font),
    layout: normalizeReference(payload.references?.layout),
    typography: normalizeReference(payload.references?.typography),
  };
  if (mode === "create" && !text && !references.layout) return { error: "请填写文本内容，或提供带布局的文本参考图。" };
  if (mode === "refine" && !text) return { error: "微调已有文字图层时请填写新的文本内容。" };
  if (mode === "refine" && !references.typography) return { error: "微调已有文字图层时请提供文字图层参考。" };
  if (text.length > 240) return { error: "文本内容不能超过 240 个字符。" };
  if (instruction.length > 480) return { error: "定制化要求不能超过 480 个字符。" };
  if (!typographyPresetKeys.has(fontPresetKey)) return { error: "fontPresetKey 无效。" };
  return { value: { text, fontPresetKey, mode, matte, instruction: instruction || undefined, references } };
}

function validateBackgroundRequest(payload) {
  const kind = typeof payload.kind === "string" ? payload.kind : "";
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  const reference = normalizeReference(payload.reference);
  if (!stickerSpecs[kind]) return { error: "kind 必须是 top、bottom 或 side。" };
  if (!reference) return { error: "请先上传直播间或色彩参考图。当前 OFOX 背景任务固定使用参考图编辑。" };
  if (prompt.length > 800) return { error: "背景生成要求不能超过 800 个字符。" };
  return { value: { kind, prompt, reference } };
}

function validateTypographyCutoutRequest(payload) {
  const image = normalizeReference(payload.image);
  if (!image) return { error: "请提供需要抠图的 PNG 文字实底稿。" };
  return { value: { image } };
}

function isRawOfoxUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.hostname.endsWith("ofox.ai") || url.hostname.endsWith("ofox.io");
  } catch {
    return false;
  }
}

const externalAdapterUrl = adapterUrl && !isRawOfoxUrl(adapterUrl) ? adapterUrl : undefined;

function typographyPrompt(input) {
  const matte = input.matte === "black" ? "pure black (#000000)" : "pure white (#FFFFFF)";
  const preset = {
    "elegant-songti": "elegant Chinese Songti/Ming serif, sharp terminals and refined thick-thin contrast",
    "expressive-calligraphy": "expressive Chinese brush calligraphy, energetic pressure and sweeping strokes",
    "rounded-cute": "rounded playful Chinese display lettering, thick soft corners and compact rhythm",
    "custom-reference": "the custom glyph reference's letterform and stroke construction",
  }[input.fontPresetKey];
  const referenceRules = input.mode === "refine"
    ? [
        "The existing typography reference controls glyph silhouette, stroke structure, spacing and layout.",
        input.references.color
          ? "Reference 1 is the mandatory color/material authority and overrides the existing typography's color and texture. The existing typography remains shape-only."
          : "The existing typography controls glyph shape, color, material and local texture.",
      ]
    : [
        input.references.color ? "Reference 1 is the mandatory sole authority for lettering color, material, texture, glow, gradient direction and attached ornaments. Visibly sample its hue family and material treatment; do not invent an unrelated palette." : "Choose a harmonious high-contrast lettering color; dark lettering must never be pure black.",
        input.references.font ? "The font reference is pre-desaturated and shape-only: use glyph silhouette, stroke rhythm and local face texture, but never derive color from it." : `Typography route: ${preset}.`,
        input.references.layout ? "The layout reference controls line breaks, hierarchy and relative placement only. Do not copy its colors, background or unrelated words." : "",
      ];
  return [
    `Create a standalone Chinese livestream typography asset on a strict ${matte} solid background.`,
    "Generate typography only: no poster scene, product, person, logo, QR code, frame or unrelated decoration.",
    `Render exactly this text and preserve its line breaks:\n${input.text}`,
    ...referenceRules,
    input.references.color ? "When any glyph/reference conflict appears, prioritize Reference 1 for color and material, prioritize the font reference only for shape, and prioritize the written text for content." : "",
    input.instruction ? `Additional art direction: ${input.instruction}` : "",
    input.matte === "black"
      ? "Use light readable lettering. Pure white is allowed. Keep every dark detail attached to the glyphs so the black matte can be removed."
      : "Use dark readable lettering, but never pure black #000000. Keep every white highlight inside the glyphs so the white matte can be removed.",
    "Keep all lettering fully inside the canvas with generous margins. Do not add, translate or rewrite any supplied text.",
  ].filter(Boolean).join("\n\n");
}

function backgroundPrompt(input) {
  const spec = stickerSpecs[input.kind];
  return [
    backgroundBasePrompt,
    spec.instruction,
    input.prompt ? `本轮用户补充要求：${input.prompt}` : "",
    `输出尺寸与构图：${spec.direction}，${spec.size}。只输出可叠加的背景素材，三类贴片风格统一但构图不能完全重复。`,
    backgroundNegativePrompt,
  ].filter(Boolean).join("\n\n");
}

function parseDataUrl(dataUrl, index = 0) {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) throw new Error("参考图不是有效的 base64 data URL。");
  const extension = match[1] === "image/jpeg" ? "jpg" : match[1] === "image/webp" ? "webp" : "png";
  return { mimeType: match[1], bytes: Buffer.from(match[2], "base64"), fileName: `reference-${index + 1}.${extension}` };
}

function imageToDataUrl({ bytes, mimeType }) {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function desaturatePngReference(reference) {
  if (!reference?.dataUrl) return reference;
  const parsed = parseDataUrl(reference.dataUrl);
  if (sniffImageMime(parsed.bytes) !== "image/png") return reference;
  const png = PNG.sync.read(parsed.bytes);
  for (let index = 0; index < png.data.length; index += 4) {
    const luminance = Math.round(0.2126 * png.data[index] + 0.7152 * png.data[index + 1] + 0.0722 * png.data[index + 2]);
    png.data[index] = luminance;
    png.data[index + 1] = luminance;
    png.data[index + 2] = luminance;
  }
  const bytes = PNG.sync.write(png);
  return { ...reference, mimeType: "image/png", dataUrl: imageToDataUrl({ bytes, mimeType: "image/png" }) };
}

function sniffImageMime(bytes) {
  if (bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  if (bytes.subarray(0, 3).toString("hex") === "ffd8ff") return "image/jpeg";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "application/octet-stream";
}

async function parseImageResponse(response, requestedFormat) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || payload.message || `OFOX returned ${response.status}.`);
  const image = payload.data?.[0];
  if (!image?.b64_json && !image?.url) throw new Error("OFOX response did not include an image.");
  let bytes;
  if (image.b64_json) bytes = Buffer.from(image.b64_json, "base64");
  else {
    const fetched = await fetch(image.url, { signal: AbortSignal.timeout(60_000) });
    if (!fetched.ok) throw new Error(`无法读取 OFOX 图片地址：${fetched.status}。`);
    bytes = Buffer.from(await fetched.arrayBuffer());
  }
  const mimeType = sniffImageMime(bytes);
  return { bytes, mimeType: mimeType === "application/octet-stream" ? `image/${requestedFormat}` : mimeType };
}

async function requestOfoxImage({ jobId, prompt, size, outputFormat, references = [] }) {
  const headers = { Authorization: `Bearer ${ofoxApiKey}`, "X-Request-Id": jobId };
  let response;
  if (references.length) {
    const form = new FormData();
    form.append("model", ofoxImageModel);
    form.append("prompt", prompt);
    form.append("size", size);
    form.append("quality", ofoxImageQuality);
    form.append("output_format", outputFormat);
    references.forEach((reference, index) => {
      const image = parseDataUrl(reference.dataUrl, index);
      form.append("image", new Blob([image.bytes], { type: image.mimeType }), image.fileName);
    });
    response = await fetch(`${ofoxBaseUrl}/images/edits`, { method: "POST", headers, body: form, signal: AbortSignal.timeout(180_000) });
  } else {
    response = await fetch(`${ofoxBaseUrl}/images/generations`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ model: ofoxImageModel, prompt, size, quality: ofoxImageQuality, output_format: outputFormat }),
      signal: AbortSignal.timeout(180_000),
    });
  }
  return parseImageResponse(response, outputFormat);
}

function removeConnectedMatte(bytes, matteMode) {
  const png = PNG.sync.read(bytes);
  const { width, height, data } = png;
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Uint32Array(total);
  let head = 0;
  let tail = 0;
  const matches = (index) => {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    return matteMode === "black" ? max <= 30 && max - min <= 26 : min >= 230 && max - min <= 26;
  };
  const enqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixel = y * width + x;
    if (visited[pixel] || !matches(pixel * 4)) return;
    visited[pixel] = 1;
    queue[tail++] = pixel;
  };
  for (let x = 0; x < width; x += 1) { enqueue(x, 0); enqueue(x, height - 1); }
  for (let y = 0; y < height; y += 1) { enqueue(0, y); enqueue(width - 1, y); }
  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    enqueue(x + 1, y); enqueue(x - 1, y); enqueue(x, y + 1); enqueue(x, y - 1);
  }
  for (let pixel = 0; pixel < total; pixel += 1) {
    if (!visited[pixel]) continue;
    const index = pixel * 4;
    const channel = matteMode === "black"
      ? Math.max(data[index], data[index + 1], data[index + 2])
      : 255 - Math.min(data[index], data[index + 1], data[index + 2]);
    data[index + 3] = Math.max(0, Math.min(255, Math.round((channel - 5) * 12)));
  }
  return PNG.sync.write(png);
}

function detectMatteMode(bytes) {
  const png = PNG.sync.read(bytes);
  const samples = [];
  const push = (x, y) => {
    const index = (y * png.width + x) * 4;
    samples.push(0.2126 * png.data[index] + 0.7152 * png.data[index + 1] + 0.0722 * png.data[index + 2]);
  };
  const stepX = Math.max(1, Math.floor(png.width / 48));
  const stepY = Math.max(1, Math.floor(png.height / 48));
  for (let x = 0; x < png.width; x += stepX) { push(x, 0); push(x, png.height - 1); }
  for (let y = 0; y < png.height; y += stepY) { push(0, y); push(png.width - 1, y); }
  const average = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
  return average < 128 ? "black" : "white";
}

function cutoutTypography(input) {
  const parsed = parseDataUrl(input.image.dataUrl);
  if (sniffImageMime(parsed.bytes) !== "image/png") throw new Error("文字抠图只支持 PNG 实底稿。");
  const matte = detectMatteMode(parsed.bytes);
  const bytes = removeConnectedMatte(parsed.bytes, matte);
  return { matte, result: makeAsset(randomUUID(), "typography", { bytes, mimeType: "image/png" }) };
}

function makeAsset(jobId, kind, image, source = "generated") {
  const extension = image.mimeType === "image/jpeg" ? "jpg" : image.mimeType === "image/webp" ? "webp" : "png";
  return {
    id: randomUUID(), kind, format: extension === "jpg" ? "jpeg" : extension, source,
    fileName: `${kind}-${jobId.slice(0, 8)}.${extension}`,
    mimeType: image.mimeType, sizeBytes: image.bytes.length,
    url: `data:${image.mimeType};base64,${image.bytes.toString("base64")}`,
    createdAt: new Date().toISOString(),
  };
}

async function requestExternalAdapter(jobId, input) {
  const response = await fetch(externalAdapterUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(adapterToken ? { Authorization: `Bearer ${adapterToken}` } : {}) },
    body: JSON.stringify({ jobId, input }),
    signal: AbortSignal.timeout(180_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Adapter returned ${response.status}.`);
  return payload;
}

async function createTypographyJob(input) {
  const job = { id: randomUUID(), type: "typography", status: "queued", createdAt: new Date().toISOString(), input };
  jobs.set(job.id, job);
  if (!externalAdapterUrl && !ofoxApiKey) {
    job.status = "failed";
    job.error = { code: "provider_not_configured", message: "未配置 OFOX_API_KEY。" };
    return job;
  }
  job.status = "processing";
  try {
    if (externalAdapterUrl) {
      const payload = await requestExternalAdapter(job.id, input);
      job.status = payload.status === "queued" ? "queued" : "completed";
      job.result = payload.result;
      return job;
    }
    const glyphFont = input.references.font ? desaturatePngReference(input.references.font) : undefined;
    const shapeOnlyTypography = input.references.color && input.references.typography ? desaturatePngReference(input.references.typography) : input.references.typography;
    const orderedReferences = input.mode === "refine"
      ? [input.references.color, shapeOnlyTypography].filter(Boolean)
      : [input.references.color, glyphFont, input.references.layout].filter(Boolean);
    let image;
    try {
      image = await requestOfoxImage({ jobId: job.id, prompt: typographyPrompt(input), size: textLayerSize, outputFormat: "png", references: orderedReferences });
    } catch (error) {
      if (orderedReferences.length <= 1) throw error;
      image = await requestOfoxImage({ jobId: job.id, prompt: `${typographyPrompt(input)}\n\nCompatibility retry: preserve the first reference's authority and follow the written typography route.`, size: textLayerSize, outputFormat: "png", references: orderedReferences.slice(0, 1) });
    }
    if (image.mimeType !== "image/png") throw new Error("OFOX 文字图层未返回 PNG 实底稿。");
    job.result = makeAsset(job.id, "typography-draft", image);
    job.status = "completed";
  } catch (error) {
    job.status = "failed";
    job.error = { code: "provider_request_failed", message: error instanceof Error ? error.message : "文字图层 Provider 请求失败。" };
  }
  return job;
}

async function createBackgroundJob(input) {
  const job = { id: randomUUID(), type: "background", status: "queued", createdAt: new Date().toISOString(), input };
  jobs.set(job.id, job);
  if (!ofoxApiKey) {
    job.status = "failed";
    job.error = { code: "provider_not_configured", message: "未配置 OFOX_API_KEY。" };
    return job;
  }
  job.status = "processing";
  try {
    const image = await requestOfoxImage({ jobId: job.id, prompt: backgroundPrompt(input), size: stickerSpecs[input.kind].size, outputFormat: "jpeg", references: [input.reference] });
    job.result = makeAsset(job.id, input.kind, image);
    job.status = "completed";
  } catch (error) {
    job.status = "failed";
    job.error = { code: "provider_request_failed", message: error instanceof Error ? error.message : "背景 Provider 请求失败。" };
  }
  return job;
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") return sendOptions(request, response);
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
  if (request.method === "GET" && url.pathname === "/health") {
    return sendJson(request, response, 200, {
      status: "ok", service: "live-sticker-api", mode: "production", version: "0.5.0", timestamp: new Date().toISOString(),
      providers: {
        imageGeneration: ofoxApiKey ? "ready" : "not-configured",
        taskPlanning: "not-configured",
        typographyGeneration: externalAdapterUrl || ofoxApiKey ? "ready" : "not-configured",
        typographyProvider: "ofox",
        typographyMode: externalAdapterUrl ? "external-adapter" : ofoxApiKey ? "built-in" : "not-configured",
      },
    });
  }
  if (request.method === "POST" && url.pathname === "/v1/live-sticker/typography/jobs") {
    try {
      const validation = validateTypographyRequest(await readJson(request));
      if (validation.error) return sendJson(request, response, 400, { error: "invalid_typography_request", message: validation.error });
      const job = await createTypographyJob(validation.value);
      return sendJson(request, response, job.status === "failed" ? 503 : 202, job);
    } catch (error) {
      return sendJson(request, response, 400, { error: "invalid_request", message: error instanceof Error && error.message === "request_too_large" ? "请求体超过 32MB，请压缩参考图片。" : "请求不是有效的 JSON。" });
    }
  }
  if (request.method === "POST" && url.pathname === "/v1/live-sticker/typography/cutout") {
    try {
      const validation = validateTypographyCutoutRequest(await readJson(request));
      if (validation.error) return sendJson(request, response, 400, { error: "invalid_cutout_request", message: validation.error });
      return sendJson(request, response, 200, cutoutTypography(validation.value));
    } catch (error) {
      return sendJson(request, response, 400, { error: "cutout_failed", message: error instanceof Error ? error.message : "文字抠图失败。" });
    }
  }
  if (request.method === "POST" && url.pathname === "/v1/live-sticker/background/jobs") {
    try {
      const validation = validateBackgroundRequest(await readJson(request));
      if (validation.error) return sendJson(request, response, 400, { error: "invalid_background_request", message: validation.error });
      const job = await createBackgroundJob(validation.value);
      return sendJson(request, response, job.status === "failed" ? 503 : 202, job);
    } catch (error) {
      return sendJson(request, response, 400, { error: "invalid_request", message: error instanceof Error && error.message === "request_too_large" ? "请求体超过 32MB，请压缩参考图片。" : "请求不是有效的 JSON。" });
    }
  }
  const jobMatch = url.pathname.match(/^\/v1\/live-sticker\/(?:typography|background)\/jobs\/([\w-]+)$/);
  if (request.method === "GET" && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    return job ? sendJson(request, response, 200, job) : sendJson(request, response, 404, { error: "job_not_found", message: "未找到该生成任务。" });
  }
  return sendJson(request, response, 404, { error: "not_found", message: "Available endpoints: GET /health, POST /v1/live-sticker/background/jobs, POST /v1/live-sticker/typography/jobs, POST /v1/live-sticker/typography/cutout." });
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(port, host, () => console.log(`live-sticker-api listening at http://${host}:${port}`));
}

export { cutoutTypography, detectMatteMode, removeConnectedMatte };
