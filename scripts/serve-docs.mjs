#!/usr/bin/env node
// Serves ./docs with live reload. No dependencies. Usage: node scripts/serve-docs.mjs --help
import { execFile } from "node:child_process";
import { watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HELP = `Serve the docs site locally with live reload.

Usage: npm run docs -- [options]

  -p, --port <n>    Port to listen on (default 4173, or $PORT)
  -H, --host <h>    Host to bind (default 127.0.0.1). Use 0.0.0.0 to test on a phone.
  -o, --open        Open the site in your browser
  -h, --help        Show this help`;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

const RELOAD_SNIPPET = `<script>new EventSource("/__reload").onmessage = () => location.reload();</script>`;

function parseArgs(argv) {
  const options = { port: Number(process.env.PORT) || 4173, host: "127.0.0.1", open: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-p" || arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "-H" || arg === "--host") options.host = argv[++i];
    else if (arg === "-o" || arg === "--open") options.open = true;
    else if (arg === "-h" || arg === "--help") {
      console.log(HELP);
      process.exit(0);
    } else {
      console.error(`Unknown option: ${arg}\n\n${HELP}`);
      process.exit(1);
    }
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    console.error("Invalid --port");
    process.exit(1);
  }
  return options;
}

const root = resolve(fileURLToPath(new URL("../docs", import.meta.url)));
const clients = new Set();

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

async function handle(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  } catch {
    return send(res, 400, "Bad request");
  }

  if (pathname === "/__reload") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    res.write("retry: 1000\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  let file = normalize(join(root, pathname));
  if (file !== root && !file.startsWith(root + sep)) return send(res, 403, "Forbidden");

  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    const data = await readFile(file);
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    if (type.startsWith("text/html")) {
      const html = data.toString("utf8").replace("</body>", `${RELOAD_SNIPPET}</body>`);
      return send(res, 200, html, type);
    }
    return send(res, 200, data, type);
  } catch {
    return send(res, 404, `Not found: ${pathname}`);
  }
}

function watchDocs() {
  let timer;
  const onChange = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const client of clients) client.write("data: reload\n\n");
    }, 80);
  };
  try {
    watch(root, { recursive: true }, onChange);
  } catch {
    watch(root, onChange); // recursive watching is not available on every platform
  }
}

function lanUrls(port) {
  return Object.values(networkInterfaces())
    .flat()
    .filter((net) => net?.family === "IPv4" && !net.internal)
    .map((net) => `http://${net.address}:${port}`);
}

function openBrowser(url) {
  // No shell, so a hostile --host value cannot inject commands.
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  execFile(command, args, () => {});
}

function listen(options, attemptsLeft = 10) {
  const server = createServer((req, res) => {
    handle(req, res).catch(() => send(res, 500, "Server error"));
  });
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      console.log(`Port ${options.port} is busy, trying ${options.port + 1}...`);
      listen({ ...options, port: options.port + 1 }, attemptsLeft - 1);
    } else {
      console.error(error.message);
      process.exit(1);
    }
  });
  server.listen(options.port, options.host, () => {
    const local = `http://${options.host === "0.0.0.0" ? "localhost" : options.host}:${options.port}`;
    console.log(`Serving docs at ${local} (live reload on, Ctrl+C to stop)`);
    if (options.host === "0.0.0.0") {
      for (const url of lanUrls(options.port)) console.log(`  on your network: ${url}`);
    }
    if (options.open) openBrowser(local);
  });
}

watchDocs();
listen(parseArgs(process.argv.slice(2)));
