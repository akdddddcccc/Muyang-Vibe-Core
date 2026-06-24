import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const host = process.env.CORE_HOST ?? "127.0.0.1";
const port = Number(process.env.CORE_PORT ?? 8787);
const allowedOrigins = (process.env.CORS_ORIGIN ?? "*").split(",").map((origin) => origin.trim()).filter(Boolean);
const typographyAdapterUrl = process.env.TYPOGRAPHY_ADAPTER_URL?.replace(/\/$/, "");
const typographyAdapterToken = process.env.TYPOGRAPHY_ADAPTER_TOKEN;
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
  const references = {
    color: normalizeReference(payload.references?.color),
    font: normalizeReference(payload.references?.font),
    layout: normalizeReference(payload.references?.layout),
  };

  if (!text && !references.layout) return { error: "请填写文本内容，或提供带布局的文本参考图。" };
  if (text.length > 240) return { error: "文本内容不能超过 240 个字符。" };
  if (!typographyPresetKeys.has(fontPresetKey)) return { error: "fontPresetKey 无效。" };
  return { value: { text, fontPresetKey, references } };
}

async function createTypographyJob(input) {
  const job = { id: randomUUID(), status: "queued", createdAt: new Date().toISOString(), input };
  jobs.set(job.id, job);

  if (!typographyAdapterUrl) {
    job.status = "failed";
    job.error = {
      code: "provider_not_configured",
      message: "未配置文字图层 Provider Adapter。请在 Core 服务端设置 TYPOGRAPHY_ADAPTER_URL。",
    };
    return job;
  }

  job.status = "processing";
  try {
    const adapterResponse = await fetch(typographyAdapterUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(typographyAdapterToken ? { Authorization: `Bearer ${typographyAdapterToken}` } : {}),
      },
      body: JSON.stringify({ jobId: job.id, input }),
      signal: AbortSignal.timeout(90_000),
    });
    const adapterPayload = await adapterResponse.json().catch(() => ({}));
    if (!adapterResponse.ok) throw new Error(adapterPayload.message || `Adapter returned ${adapterResponse.status}.`);
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
      version: "0.2.0",
      timestamp: new Date().toISOString(),
      providers: {
        imageGeneration: "not-configured",
        taskPlanning: "not-configured",
        typographyGeneration: typographyAdapterUrl ? "ready" : "not-configured",
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
