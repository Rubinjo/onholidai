// @vitest-environment node
import { createServer, type Server } from "node:http";

import { afterEach, beforeEach, expect, it } from "vitest";

import { verifyE2EReadiness } from "../e2e/global-setup";

let server: Server;
let baseURL: string;
let failedPath: string | undefined;
let providerMode: string;
let paths: string[];
let draftCookie: string | undefined;
let sessionOrigin: string | undefined;

beforeEach(async () => {
  failedPath = undefined;
  providerMode = "deterministic";
  paths = [];
  draftCookie = undefined;
  sessionOrigin = undefined;
  server = createServer((incoming, response) => {
    const path = incoming.url ?? "";
    paths.push(path);
    if (path === failedPath) {
      response.writeHead(503).end("Dependency unavailable");
      return;
    }
    response.setHeader("content-type", "application/json");
    if (path === "/health") {
      response.end(JSON.stringify({ status: "ok", providerMode }));
    } else if (path === "/api/v1/planning-session") {
      sessionOrigin = incoming.headers.origin;
      response.setHeader("set-cookie", "preflight=synthetic; Path=/; HttpOnly");
      response.end(JSON.stringify({ kind: "guest" }));
    } else if (path === "/api/v1/setup-drafts") {
      draftCookie = incoming.headers.cookie;
      response.writeHead(201).end(JSON.stringify({ draftId: crypto.randomUUID() }));
    } else if (path === "/sign-in") {
      response.setHeader("content-type", "text/html");
      response.end("<h1>Sign in</h1>");
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server port");
  baseURL = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

it("checks real guest persistence, cookies and the auth page after agent readiness", async () => {
  await verifyE2EReadiness({ baseURL, agentBaseURL: baseURL });
  expect(paths).toEqual([
    "/health",
    "/api/v1/planning-session",
    "/api/v1/setup-drafts",
    "/sign-in",
  ]);
  expect(sessionOrigin).toBe(baseURL);
  expect(draftCookie).toBe("preflight=synthetic");
});

it.each([
  ["/health", "the planning agent must be healthy"],
  ["/api/v1/planning-session", "check PostgreSQL, roles and migrations"],
  ["/api/v1/setup-drafts", "check database grants and migrations"],
  ["/sign-in", "the database-backed sign-in page must load"],
])("fails preflight explicitly when %s is unavailable", async (path, message) => {
  failedPath = path;
  await expect(verifyE2EReadiness({ baseURL, agentBaseURL: baseURL })).rejects.toThrow(message);
  expect(paths.at(-1)).toBe(path);
});

it("rejects live provider mode before creating any guest data", async () => {
  providerMode = "live";
  await expect(verifyE2EReadiness({ baseURL, agentBaseURL: baseURL })).rejects.toThrow(
    "live providers must not be used",
  );
  expect(paths).toEqual(["/health"]);
});
