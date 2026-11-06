import { MockLanguageModelV1 } from "ai/test";
import { describe, expect, it } from "vitest";
import { LLMClient } from "../../src/core/llm-client.js";
import { PromptBuilder } from "../../src/core/prompt/prompt-builder.js";
import { AgentRunner } from "../../src/core/sandbox/agent-runner.js";
import { createReactAgent } from "../../src/graph/agent-graph.js";
import { ToolRegistry } from "../../src/tools/registry.js";

function createRunner(text = "done", delayMs = 0) {
  const model = new MockLanguageModelV1({
    doGenerate: async () => {
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      return {
        rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: "stop",
        usage: { promptTokens: 1, completionTokens: 1 }, text,
      };
    },
  });
  const llmClient = new LLMClient({ model });
  return new AgentRunner({
    graphFactory: async ({ eventEmitter }) => ({
      graph: createReactAgent({
        llmClient, promptBuilder: new PromptBuilder(), toolRegistry: new ToolRegistry(),
        getSandboxSession: () => null, eventEmitter, checkpointPath: false,
        enablePlanning: false, enableReflection: false,
      }),
    }),
  });
}

describe("AgentRunner 运行隔离", () => {
  it("并发流只收到本任务事件", async () => {
    const runner = createRunner();
    const collect = async (input: string) => {
      const events = [];
      for await (const event of runner.stream(input)) events.push(event);
      return events;
    };
    const [eventsA, eventsB] = await Promise.all([collect("task-A"), collect("task-B")]);
    const startsA = eventsA.filter(event => event.type === "run_started").map(event => JSON.stringify(event.data));
    const startsB = eventsB.filter(event => event.type === "run_started").map(event => JSON.stringify(event.data));
    expect(startsA).toHaveLength(1);
    expect(startsA[0]).toContain("task-A");
    expect(startsA.join()).not.toContain("task-B");
    expect(startsB.join()).toContain("task-B");
    expect(eventsA.every(event => event.runId === eventsA[0].runId)).toBe(true);
    expect(eventsA[0].runId).not.toBe(eventsB[0].runId);
  });

  it("提前退出流会清理监听器并取消运行", async () => {
    const runner = createRunner("late", 100);
    const stream = runner.stream("cancel-me");
    await stream.next();
    await stream.return(undefined);
    expect(runner.activeRunCount).toBe(0);
    expect(runner.events.listenerCount).toBe(0);
  });

  it("过滤返回消息和所有事件中的密钥", async () => {
    const runner = createRunner("sk-secret-value");
    const events: unknown[] = [];
    runner.events.subscribe(event => events.push(event));
    const result = await runner.run("secret-task");

    expect(result.finalAnswer).not.toContain("sk-secret-value");
    expect(JSON.stringify(result.messages)).not.toContain("sk-secret-value");
    expect(JSON.stringify(events)).not.toContain("sk-secret-value");
    expect(events.some(event => (event as any).type === "final_answer")).toBe(true);
  });
});
