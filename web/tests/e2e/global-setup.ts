import { randomUUID } from "node:crypto";

import { expect, request, type FullConfig } from "@playwright/test";

export async function verifyE2EReadiness({
  baseURL,
  agentBaseURL,
  ignoreHTTPSErrors = false,
}: {
  baseURL: string;
  agentBaseURL: string;
  ignoreHTTPSErrors?: boolean;
}): Promise<void> {
  const client = await request.newContext({ baseURL, ignoreHTTPSErrors, timeout: 30_000 });
  try {
    const agent = await client.get(`${agentBaseURL}/health`, { timeout: 5_000 });
    await expect(agent, "E2E preflight: the planning agent must be healthy").toBeOK();
    expect(await agent.json(), "E2E preflight: live providers must not be used").toMatchObject({
      status: "ok",
      providerMode: "deterministic",
    });
    const headers = { origin: new URL(baseURL).origin };
    const session = await client.post("/api/v1/planning-session", {
      headers,
      data: { requestId: randomUUID() },
    });
    await expect(
      session,
      "E2E preflight: cannot create a guest session; check PostgreSQL, roles and migrations",
    ).toBeOK();
    const draft = await client.post("/api/v1/setup-drafts", {
      headers,
      data: { requestId: randomUUID() },
    });
    await expect(
      draft,
      "E2E preflight: cannot persist a draft; check database grants and migrations",
    ).toBeOK();
    const signIn = await client.get("/sign-in");
    await expect(signIn, "E2E preflight: the database-backed sign-in page must load").toBeOK();
  } finally {
    await client.dispose();
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const { baseURL, ignoreHTTPSErrors } = config.projects[0].use;
  if (!baseURL) throw new Error("E2E preflight requires a Playwright baseURL");
  await verifyE2EReadiness({
    baseURL,
    agentBaseURL: process.env.AGENT_BASE_URL ?? "http://127.0.0.1:8000",
    ignoreHTTPSErrors,
  });
}
