import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createBoxClient } from "../dist/box.js";
import { reviewContract } from "../dist/tools.js";

const __dirname = resolve(fileURLToPath(new URL(".", import.meta.url)));
const rootDir = resolve(__dirname, "..");
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT ?? 4173);

const envPath = process.env.BOX_ENV_PATH ?? join(rootDir, ".env");
if (existsSync(envPath)) {
  config({ path: envPath, quiet: true });
}

let client;
function getClient() {
  client ??= createBoxClient();
  return client;
}

function parseReviewRequest(text) {
  const standpoint =
    /委託者|甲側|発注者|依頼者/.test(text)
      ? "委託者"
      : /受託者|乙側|ベンダー|委託先/.test(text)
        ? "受託者"
        : "受託者";
  const boxUrl = text.match(/https?:\/\/\S*box\S*/i)?.[0]?.replace(/[)、）\].。]+$/, "");
  const fileName = text.match(/[^\s"'`「」]+\.pdf/i)?.[0];
  return { standpoint, boxUrl, fileName };
}

function readRequestBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        rejectBody(new Error("Request body is too large."));
      }
    });
    req.on("end", () => resolveBody(body));
    req.on("error", rejectBody);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function serveStatic(res, pathname) {
  const filePath = pathname === "/" ? join(publicDir, "index.html") : join(publicDir, pathname);
  const resolvedPath = resolve(filePath);
  if (!resolvedPath.startsWith(publicDir) || !existsSync(resolvedPath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
  };
  res.writeHead(200, { "content-type": contentTypes[extname(resolvedPath)] ?? "application/octet-stream" });
  res.end(readFileSync(resolvedPath));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (req.method === "POST" && url.pathname === "/api/review") {
    try {
      const body = JSON.parse((await readRequestBody(req)) || "{}");
      const message = String(body.message ?? "");
      const parsed = parseReviewRequest(message);
      const result = await reviewContract(getClient(), {
        fileName: parsed.fileName,
        boxUrl: parsed.boxUrl,
        standpoint: parsed.standpoint,
      });
      sendJson(res, 200, { message, parsed, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { error: message });
    }
    return;
  }

  if (req.method === "GET") {
    serveStatic(res, url.pathname);
    return;
  }

  res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
  res.end("Method not allowed");
});

server.listen(port, () => {
  console.log(`Slack-style demo running at http://localhost:${port}`);
  console.log("Set BOX_ENV_PATH=/path/to/.env if credentials are not in this repository.");
});
