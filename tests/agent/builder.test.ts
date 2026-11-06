import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MockLanguageModelV1 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assembleAgent } from "../../src/agent/builder.js";
import { loadConfig } from "../../src/agent/config-loader.js";
import type { SandboxSession } from "../../src/core/sandbox/types.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "agent-builder-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function config() {
  return loadConfig({
    llm: { provider: "openai", model: "gpt-4o", apiKey: "test" },
    memory: { dataDir: tempDir },
    sandbox: { workDir: tempDir },
  }, {});
}

describe("assembleAgent", () => {
  it("组装工具并通过统一 close 释放资源", async () => {
    const destroy = vi.fn();
    const session: SandboxSession = {
      id: "fake", backend: "fake", destroy,
      execute: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false, duration: 0 }),
    };
    const model = new MockLanguageModelV1({
      doGenerate: async () => ({
        rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: "stop",
        usage: { promptTokens: 1, completionTokens: 1 }, text: "组装完成",
      }),
    });
    const agent = await assembleAgent(config(), { model, sandboxSession: session, checkpointPath: false });
    expect(agent.toolRegistry.getToolNames()).toEqual(expect.arrayContaining(["execute_command", "read_file", "write_file", "list_directory", "count_context_tokens"]));
    expect(agent.skillManager.list()).toHaveLength(3);
    await expect(agent.agentRunner.run("你好")).resolves.toMatchObject({ finalAnswer: "组装完成" });
    await agent.close();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("没有模型和 API Key 时给出明确错误", async () => {
    const invalid = config();
    invalid.llm.apiKey = "";
    await expect(assembleAgent(invalid, { sandboxSession: null, checkpointPath: false })).rejects.toThrow("OPENAI_API_KEY");
  });
});
