import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const contractTests = "agent/tests/contract";

if (!existsSync(contractTests)) {
  console.log(`Skipping agent contract tests: ${contractTests} is not implemented yet.`);
  process.exit(0);
}

const uv = process.platform === "win32" ? "uv.exe" : "uv";
const result = spawnSync(uv, ["run", "--project", "agent", "pytest", contractTests], {
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
