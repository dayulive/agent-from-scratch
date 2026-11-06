import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadLocalEnv } from "../../src/agent/env.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "agent-env-"));
  delete process.env.AGENT_TEST_ENV;
});

afterEach(async () => {
  delete process.env.AGENT_TEST_ENV;
  await rm(tempDir, { recursive: true, force: true });
});

describe("loadLocalEnv", () => {
  it("加载存在的 .env 并跳过不存在的文件", async () => {
    const filePath = path.join(tempDir, ".env");
    await writeFile(filePath, "AGENT_TEST_ENV=loaded\n");
    expect(loadLocalEnv(filePath)).toBe(true);
    expect(process.env.AGENT_TEST_ENV).toBe("loaded");
    expect(loadLocalEnv(path.join(tempDir, "missing.env"))).toBe(false);
  });
});
