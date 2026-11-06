import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MockLanguageModelV1 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContextManager } from "../../src/core/context/context-manager.js";
import { LLMClient } from "../../src/core/llm-client.js";
import { PromptBuilder } from "../../src/core/prompt/prompt-builder.js";
import { AgentRunner } from "../../src/core/sandbox/agent-runner.js";
import { createReactAgent } from "../../src/graph/agent-graph.js";
import { ToolRegistry } from "../../src/tools/registry.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "agent-state-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("任务状态隔离", () => {
  it("同一 checkpoint 线程的新任务重置计划和步数", async () => {
    const model = new MockLanguageModelV1({
      doGenerate: async options => {
        const text = JSON.stringify(options.prompt);
        const taskName = text.includes("新系统") ? "new-plan" : "old-plan";
        if (text.includes("任务规划专家")) {
          return {
            rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1 },
            text: JSON.stringify({ analysis: taskName, subTasks: [{ id: taskName, description: taskName, expectedOutput: "", dependencies: [] }] }),
          };
        }
        return {
          rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: "stop",
          usage: { promptTokens: 1, completionTokens: 1 }, text: `done:${taskName}`,
        };
      },
    });
    const graph = createReactAgent({
      llmClient: new LLMClient({ model }), promptBuilder: new PromptBuilder(), toolRegistry: new ToolRegistry(),
      getSandboxSession: () => null, checkpointPath: path.join(tempDir, "state.db"), enableReflection: false,
    });
    const runner = new AgentRunner({ compiledGraph: graph });
    const first = await runner.run("部署旧系统", { threadId: "same" });
    const second = await runner.run("部署新系统", { threadId: "same" });

    expect(first.plan?.subTasks[0].id).toBe("old-plan");
    expect(second.plan?.subTasks[0].id).toBe("new-plan");
    expect(second.step).toBe(1);
    graph.checkpointer.db.close();
  });

  it("Agent 节点在调用模型前压缩上下文", async () => {
    const promptLengths: number[] = [];
    const model = new MockLanguageModelV1({
      doGenerate: async options => {
        promptLengths.push(options.prompt.length);
        return {
          rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: "stop",
          usage: { promptTokens: 1, completionTokens: 1 }, text: "compressed",
        };
      },
    });
    const graph = createReactAgent({
      llmClient: new LLMClient({ model }), promptBuilder: new PromptBuilder(), toolRegistry: new ToolRegistry(),
      getSandboxSession: () => null, checkpointPath: false, enablePlanning: false, enableReflection: false,
      contextManager: new ContextManager({ maxTokens: 80, reserveTokens: 20 }),
    });
    const messages = Array.from({ length: 20 }, (_, index) => ({ role: "user" as const, content: `消息 ${index} ${"长".repeat(50)}` }));
    await graph.invoke({ messages });
    expect(promptLengths[0]).toBeLessThan(21);
  });
});
