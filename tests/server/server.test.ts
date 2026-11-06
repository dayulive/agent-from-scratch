import { MockLanguageModelV1 } from "ai/test";
import { describe, expect, it } from "vitest";
import { LLMClient } from "../../src/core/llm-client.js";
import { PromptBuilder } from "../../src/core/prompt/prompt-builder.js";
import { AgentRunner } from "../../src/core/sandbox/agent-runner.js";
import { createReactAgent } from "../../src/graph/agent-graph.js";
import { createServer } from "../../src/server/index.js";
import { ToolRegistry } from "../../src/tools/registry.js";

function createRunner() {
  const graph = createReactAgent({
    llmClient: new LLMClient({
      model: new MockLanguageModelV1({
        doGenerate: async () => ({
          rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: "stop",
          usage: { promptTokens: 1, completionTokens: 1 }, text: "HTTP 完成",
        }),
      }),
    }),
    promptBuilder: new PromptBuilder(), toolRegistry: new ToolRegistry(), getSandboxSession: () => null,
    checkpointPath: false, enablePlanning: false, enableReflection: false,
  });
  return new AgentRunner({ compiledGraph: graph });
}

describe("HTTP 服务", () => {
  it("提供健康检查、任务执行和任务查询", async () => {
    const app = await createServer({ agentRunner: createRunner() });
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", agentAvailable: true });

    const response = await app.inject({ method: "POST", url: "/tasks", payload: { input: "你好", threadId: "http-thread" } });
    expect(response.statusCode).toBe(201);
    const task = response.json();
    expect(task).toMatchObject({ status: "completed", threadId: "http-thread", result: { finalAnswer: "HTTP 完成" } });

    const fetched = await app.inject({ method: "GET", url: `/tasks/${task.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().id).toBe(task.id);
    await app.close();
  });

  it("校验任务输入并处理缺失任务", async () => {
    const app = await createServer({ agentRunner: createRunner() });
    const invalid = await app.inject({ method: "POST", url: "/tasks", payload: { input: 42 } });
    expect(invalid.statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/tasks/missing" })).statusCode).toBe(404);
    await app.close();
  });

  it("无 Agent 时健康服务可用但任务返回 503", async () => {
    const app = await createServer();
    expect((await app.inject({ method: "GET", url: "/health" })).json()).toMatchObject({ status: "ok", agentAvailable: false });
    expect((await app.inject({ method: "POST", url: "/tasks", payload: { input: "你好" } })).statusCode).toBe(503);
    await app.close();
  });
});
