import { MockLanguageModelV1 } from "ai/test";
import { describe, expect, it } from "vitest";
import { runAgentLoop } from "../../src/core/agent-loop.js";
import { runACILoop } from "../../src/core/aci/aci-loop.js";
import { LLMClient } from "../../src/core/llm-client.js";
import { ToolRegistry } from "../../src/tools/registry.js";

function createClient(answer: string) {
  return new LLMClient({
    model: new MockLanguageModelV1({
      doGenerate: async () => ({
        rawCall: { rawPrompt: null, rawSettings: {} },
        finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1 }, text: answer,
      }),
    }),
  });
}

describe("教学循环", () => {
  it("AgentLoop 在模型结束时返回答案", async () => {
    const result = await runAgentLoop({ llmClient: createClient("基础循环完成"), toolRegistry: new ToolRegistry() }, "你好");
    expect(result).toMatchObject({ answer: "基础循环完成", steps: 1 });
    expect(result.messages.at(-1)).toMatchObject({ role: "assistant", content: "基础循环完成" });
  });

  it("ACILoop 使用相同契约返回最终动作", async () => {
    const result = await runACILoop({ llmClient: createClient("ACI 完成"), toolRegistry: new ToolRegistry() }, "检查状态");
    expect(result).toMatchObject({ answer: "ACI 完成", steps: 1 });
  });
});
