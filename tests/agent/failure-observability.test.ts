import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MockLanguageModelV1 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assembleAgent } from "../../src/agent/builder.js";
import { loadConfig } from "../../src/agent/config-loader.js";
import { createServer } from "../../src/server/index.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "agent-observability-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("失败状态与可观测性", () => {
  it("成功和失败任务分别记录指标，模型失败不写成功记忆且 HTTP 返回失败", async () => {
    let calls = 0;
    const model = new MockLanguageModelV1({
      doGenerate: async () => {
        calls += 1;
        if (calls > 1) throw new Error("401 unauthorized");
        return {
          rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: "stop",
          usage: { promptTokens: 2, completionTokens: 3 }, text: "成功",
        };
      },
    });
    const config = loadConfig({
      llm: { provider: "openai", model: "gpt-4o", apiKey: "test" },
      orchestration: { maxSteps: 10, enablePlanning: false, enableReflection: false },
      memory: { dataDir: tempDir }, sandbox: { workDir: tempDir },
    }, {});
    const agent = await assembleAgent(config, { model, sandboxSession: null, checkpointPath: false });
    await expect(agent.agentRunner.run("第一次")).resolves.toMatchObject({ finalAnswer: "成功" });

    let snapshot = agent.dashboard.snapshot();
    expect(snapshot.metrics.counters.tasks_completed).toBe(1);
    expect(snapshot.metrics.tokens).toEqual({ promptTokens: 2, completionTokens: 3, totalTokens: 5 });
    expect(snapshot.traces).toHaveLength(1);

    await expect(agent.agentRunner.run("第二次")).rejects.toThrow("推理失败");
    snapshot = agent.dashboard.snapshot();
    expect(snapshot.metrics.counters.tasks_failed).toBe(1);
    expect(snapshot.traces).toHaveLength(2);
    expect(await agent.memoryManager!.getRecentEpisodes()).toHaveLength(1);

    const app = await createServer({ agentRunner: agent.agentRunner });
    const response = await app.inject({ method: "POST", url: "/tasks", payload: { input: "第三次" } });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ status: "failed" });
    await app.close();
    await agent.close();
  });
});
