import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MockLanguageModelV1 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assembleAgent } from "../../src/agent/builder.js";
import { loadConfig } from "../../src/agent/config-loader.js";
import { ToolResultCompressor } from "../../src/core/context/tool-result-compressor.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "agent-compressor-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tempDir, { recursive: true, force: true });
});

describe("每运行压缩器生命周期", () => {
  it("运行结束时释放 ToolResultCompressor", async () => {
    const dispose = vi.spyOn(ToolResultCompressor.prototype, "dispose");
    let calls = 0;
    const model = new MockLanguageModelV1({
      doGenerate: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: "tool-calls",
            usage: { promptTokens: 1, completionTokens: 1 }, text: "",
            toolCalls: [{ toolCallType: "function", toolCallId: "call-1", toolName: "list_directory", args: "{}" }],
          };
        }
        return {
          rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: "stop",
          usage: { promptTokens: 1, completionTokens: 1 }, text: "完成",
        };
      },
    });
    const config = loadConfig({
      llm: { provider: "openai", model: "gpt-4o", apiKey: "test" },
      orchestration: { maxSteps: 10, enablePlanning: false, enableReflection: false },
      memory: { dataDir: tempDir }, sandbox: { workDir: tempDir },
    }, {});
    const agent = await assembleAgent(config, { model, sandboxSession: null, checkpointPath: false });
    await agent.agentRunner.run("列出目录");
    expect(dispose).toHaveBeenCalledTimes(1);
    await agent.close();
  });
});
