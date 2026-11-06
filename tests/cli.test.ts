import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

function runCli(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", cli, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "" },
  });
}

describe("CLI", () => {
  it("显示帮助和主要命令", () => {
    const result = runCli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ask");
    expect(result.stdout).toContain("serve");
    expect(result.stdout).toContain("evaluate");
  });

  it("无 API Key 也能列出内置 Skills", () => {
    const result = runCli(["skills"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("devops-deploy");
    expect(result.stdout).toContain("data-analysis");
    expect(result.stdout).toContain("log-diagnostics");
  });
});
