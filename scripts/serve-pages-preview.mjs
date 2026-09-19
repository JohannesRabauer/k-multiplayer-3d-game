import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const port = Number(process.argv[2] ?? "4173");
const basePath = "/k-multiplayer-3d-game/";
const root = resolve("apps", "client", "dist");

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"]
]);

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8"
  });
  response.end(body);
}

createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  if (!requestUrl.pathname.startsWith(basePath)) {
    sendText(response, 404, "Not found");
    return;
  }

  const relativePath =
    requestUrl.pathname === basePath
      ? "index.html"
      : decodeURIComponent(requestUrl.pathname.slice(basePath.length));
  const filePath = resolve(root, relativePath);
  if (!filePath.startsWith(`${root}${sep}`) && filePath !== root) {
    sendText(response, 400, "Invalid path");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      sendText(response, 404, "Not found");
      return;
    }

    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type":
        contentTypes.get(extname(filePath)) ?? "application/octet-stream"
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      sendText(response, 404, "Not found");
      return;
    }
    sendText(response, 500, "Internal server error");
  }
}).listen(port, "127.0.0.1", () => {
  console.info(
    `Serving the Pages artifact at http://127.0.0.1:${String(port)}${basePath}`
  );
});
