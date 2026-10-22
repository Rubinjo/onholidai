// Local verification helper: the certificate/key live outside the repository.
// Production Secure/__Host- cookies remain unchanged, including in WebKit.
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { request } from "node:http";
if (!process.env.LOCAL_TLS_CERT || !process.env.LOCAL_TLS_KEY)
  throw new Error("Local TLS certificate and key paths are required");
const server = createServer(
  { cert: readFileSync(process.env.LOCAL_TLS_CERT), key: readFileSync(process.env.LOCAL_TLS_KEY) },
  (incoming, outgoing) => {
    const upstream = request(
      {
        hostname: "127.0.0.1",
        port: 3000,
        path: incoming.url,
        method: incoming.method,
        headers: { ...incoming.headers, "x-forwarded-proto": "https" },
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end("Local application unavailable");
    });
    incoming.on("aborted", () => upstream.destroy());
    incoming.pipe(upstream);
  },
);
server.listen(3443, "localhost", () =>
  process.stdout.write("Local HTTPS verification proxy ready on https://localhost:3443\n"),
);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close());
