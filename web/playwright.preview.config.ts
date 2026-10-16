import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
// Static render + production CSS checks do not need an app/database server.
export default defineConfig({ ...base, webServer: undefined, testMatch: "chat-checkpoints-layout.spec.ts" });
