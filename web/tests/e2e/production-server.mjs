import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";

import next from "next";

const baseURL = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "https://localhost:3000");
const certificate = process.env.PLAYWRIGHT_TLS_CERTIFICATE;
if (baseURL.protocol !== "https:" || !certificate) {
  throw new Error("The production E2E server requires HTTPS and PLAYWRIGHT_TLS_CERTIFICATE");
}
const port = Number(baseURL.port || "443");
const application = next({ dev: false, hostname: baseURL.hostname, port });
await application.prepare();
const handler = application.getRequestHandler();
const https = createHttpsServer({ pfx: readFileSync(certificate) }, handler);
const http = createHttpServer(handler);

https.on("error", (error) => {
  console.error("E2E HTTPS server failed", error);
  process.exit(1);
});
http.on("error", (error) => {
  console.error("E2E agent callback server failed", error);
  process.exit(1);
});
https.listen(port);
http.listen(port + 1, "127.0.0.1");
