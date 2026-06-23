import { createServer } from "node:http";

const host = process.env.CORE_HOST ?? "127.0.0.1";
const port = Number(process.env.CORE_PORT ?? 8787);
const allowedOrigin = process.env.CORS_ORIGIN ?? "*";

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      status: "ok",
      service: "live-sticker-api",
      mode: "foundation",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      providers: {
        imageGeneration: "not-configured",
        taskPlanning: "not-configured",
      },
    });
    return;
  }

  sendJson(response, 404, {
    error: "not_found",
    message: "The foundation API currently exposes only GET /health.",
  });
});

server.listen(port, host, () => {
  console.log(`live-sticker-api foundation listening at http://${host}:${port}`);
});
