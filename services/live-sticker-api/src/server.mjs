import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const host = process.env.CORE_HOST ?? "127.0.0.1";
const port = Number(process.env.CORE_PORT ?? 8787);
const allowedOrigins = (process.env.CORS_ORIGIN ?? "*").split(",").map((origin) => origin.trim()).filter(Boolean);
const typographyAdapterUrl = (process.env.OFOX_TYPOGRAPHY_ADAPTER_URL ?? process.env.TYPOGRAPHY_ADAPTER_URL)?.replace(/\/$/, "");
const typographyAdapterToken = process.env.OFOX_TYPOGRAPHY_ADAPTER_TOKEN ?? process.env.TYPOGRAPHY_ADAPTER_TOKEN;
const ofoxApiKey = process.env.OFOX_API_KEY;
const ofoxBaseUrl = (process.env.OFOX_BASE_URL ?? "https://api.ofox.ai/v1").replace(/\/$/, "");
const ofoxImageModel = process.env.OFOX_IMAGE_MODEL ?? "openai/gpt-image-2";
const ofoxImageQuality = process.env.OFOX_IMAGE_QUALITY ?? "low";
const ofoxTextLayerSize = process.env.OFOX_TEXT_LAYER_SIZE ?? "1536x1024";
const jobs = new Map();
const typographyPresetKeys = new Set(["elegant-songti", "expressive-calligraphy", "rounded-cute", "custom-reference"]);

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

async function readJson(request, maxBytes = 1_500_000) {
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
  if (typeof value.dataUrl === "string" && value.dataUrl.startsWith("data:image/") && value.dataUrl.length <= 1_000_000) reference.dataUrl = value.dataUrl;
  return Object.keys(reference).length ? reference : undefined;
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

function isRawOfoxUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.hostname.endsWith("ofox.ai") || url.hostname.endsWith("ofox.io");
  } catch {
    return false;
  }
}

const externalTypographyAdapterUrl = typographyAdapterUrl && !isRawOfoxUrl(typographyAdapterUrl)
  ? typographyAdapterUrl
  : undefined;

function typographyPrompt(input) {
  const matte = input.matte === "black" ? "pure black (#000000)" : "pure white (#FFFFFF)";
  return [
    "Create a clean Chinese display typography layer for a livestream sticker design.",
    `Render exactly this text, preserving line breaks:\n${input.text}`,
    input.instruction ? `Additional art direction: ${input.instruction}` : "",
    `Use a ${matte} solid background with no gradients, shadows, photographs, mockups or unrelated objects.`,
    "Keep all lettering fully inside the canvas with generous margins. Do not add any words that are not in the supplied text.",
  ].filter(Boolean).join("\n\n");
}

async function requestBuiltInOfoxTypography(jobId, input) {
  const response = await fetch(`${ofoxBaseUrl}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ofoxApiKey}`,
      "Content-Type": "application/json",
      "X-Request-Id": jobId,
    },
    body: JSON.stringify({
      model: ofoxImageModel,
      prompt: typographyPrompt(input),
      size: ofoxTextLayerSize,
      quality: ofoxImageQuality,
      output_format: "png",
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || payload.message || `OFOX returned ${response.status}.`);
  const image = payload.data?.[0];
  if (!image?.b64_json && !image?.url) throw new Error("OFOX response did not include an image.");
  const bytes = image.b64_json ? Buffer.from(image.b64_json, "base64") : undefined;
  return {
    status: "completed",
    result: {
      id: randomUUID(),
      kind: "typography",
      format: "png",
      source: "generated",
      fileName: `typography-${jobId.slice(0, 8)}.png`,
      mimeType: "image/png",
      sizeBytes: bytes?.length ?? 0,
      url: image.b64_json ? `data:image/png;base64,${image.b64_json}` : image.url,
      createdAt: new Date().toISOString(),
    },
  };
}

async function requestExternalTypographyAdapter(jobId, input) {
  const response = await fetch(externalTypographyAdapterUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(typographyAdapterToken ? { Authorization: `Bearer ${typographyAdapterToken}` } : {}),
    },
    body: JSON.stringify({ jobId, input }),
    signal: AbortSignal.timeout(90_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Adapter returned ${response.status}.`);
  return payload;
}

async function createTypographyJob(input) {
  const job = { id: randomUUID(), status: "queued", createdAt: new Date().toISOString(), input };
  jobs.set(job.id, job);

  if (!externalTypographyAdapterUrl && !ofoxApiKey) {
    job.status = "failed";
    job.error = {
      code: "provider_not_configured",
      message: "未配置 OFOX。请设置 OFOX_API_KEY，或配置独立的 OFOX_TYPOGRAPHY_ADAPTER_URL。",
    };
    return job;
  }

  job.status = "processing";
  try {
    const adapterPayload = externalTypographyAdapterUrl
      ? await requestExternalTypographyAdapter(job.id, input)
      : await requestBuiltInOfoxTypography(job.id, input);
    job.status = adapterPayload.status === "queued" ? "queued" : "completed";
    job.result = adapterPayload.result;
  } catch (error) {
    job.status = "failed";
    job.error = { code: "provider_request_failed", message: error instanceof Error ? error.message : "文字图层 Provider 请求失败。" };
  }
  return job;
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") return sendOptions(request, response);

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
  if (request.method === "GET" && url.pathname === "/health") {
    return sendJson(request, response, 200, {
      status: "ok",
      service: "live-sticker-api",
      mode: "staging",
      version: "0.3.0",
      timestamp: new Date().toISOString(),
      providers: {
        imageGeneration: ofoxApiKey ? "ready" : "not-configured",
        taskPlanning: "not-configured",
        typographyGeneration: externalTypographyAdapterUrl || ofoxApiKey ? "ready" : "not-configured",
        typographyProvider: "ofox",
        typographyMode: externalTypographyAdapterUrl ? "external-adapter" : ofoxApiKey ? "built-in" : "not-configured",
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
      const message = error instanceof Error && error.message === "request_too_large" ? "请求体超过 1.5MB。大图请先上传到资产服务后传 assetId。" : "请求不是有效的 JSON。";
      return sendJson(request, response, 400, { error: "invalid_request", message });
    }
  }

  const jobMatch = url.pathname.match(/^\/v1\/live-sticker\/typography\/jobs\/([\w-]+)$/);
  if (request.method === "GET" && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    return job ? sendJson(request, response, 200, job) : sendJson(request, response, 404, { error: "job_not_found", message: "未找到该文字图层任务。" });
  }

  return sendJson(request, response, 404, { error: "not_found", message: "Available endpoints: GET /health, POST /v1/live-sticker/typography/jobs, GET /v1/live-sticker/typography/jobs/:id." });
});

server.listen(port, host, () => {
  console.log(`live-sticker-api listening at http://${host}:${port}`);
});
