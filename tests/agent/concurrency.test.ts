import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MockLanguageModelV1 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assembleAgent } from "../../src/agent/builder.js";
import { loadConfig } from "../../src/agent/config-loader.js";
import type { SandboxSession } from "../../src/core/sandbox/types.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "agent-concurrency-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("组装后的并发运行", () => {
  it("每个任务只使用自己的 Skill 和记忆提示", async () => {
    const prompts: Array<{ task: string; system: string }> = [];
    const model = new MockLanguageModelV1({
      doGenerate: async options => {
        const system = String(options.prompt[0]?.content ?? "");
        const last = options.prompt.at(-1)?.content;
        const task = typeof last === "string" ? last : JSON.stringify(last);
        prompts.push({ task, system });
        if (task.includes("alpha")) await new Promise(resolve => setTimeout(resolve, 30));
        return {
          rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: "stop",
          usage: { promptTokens: 1, completionTokens: 1 }, text: `answer:${task}`,
        };
      },
    });
    const session: SandboxSession = {
      id: "fake", backend: "fake", destroy: async () => undefined,
      execute: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false, duration: 0 }),
    };
    const config = loadConfig({
      llm: { provider: "openai", model: "gpt-4o", apiKey: "test" },
      memory: { dataDir: tempDir }, sandbox: { workDir: tempDir },
    }, {});
    const agent = await assembleAgent(config, { model, sandboxSession: session, checkpointPath: false });
    await agent.memoryManager!.learn("alpha unique memory", ["alpha"], 0.9);

    await Promise.all([
      agent.agentRunner.run("部署服务 alpha"),
      agent.agentRunner.run("zzzz unrelated beta"),
    ]);
    const alphaPrompts = prompts.filter(prompt => prompt.task.includes("alpha"));
    const beta = prompts.find(prompt => prompt.task.includes("beta"));
    expect(alphaPrompts.length).toBeGreaterThan(0);
    expect(alphaPrompts.every(prompt => prompt.system.includes("部署前检查"))).toBe(true);
    expect(alphaPrompts.some(prompt => prompt.system.includes("alpha unique memory"))).toBe(true);
    expect(beta?.system).not.toContain("部署前检查");
    expect(beta?.system).not.toContain("alpha unique memory");
    await agent.close();
  });
});
