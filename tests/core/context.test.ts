import type { CoreMessage } from "ai";
import { describe, expect, it } from "vitest";
import { ContextAssembler } from "../../src/core/context/context-assembler.js";
import { ContextManager } from "../../src/core/context/context-manager.js";
import { DialogueCompressor } from "../../src/core/context/dialogue-compressor.js";
import { ToolResultCompressor } from "../../src/core/context/tool-result-compressor.js";
import { PromptBuilder } from "../../src/core/prompt/prompt-builder.js";
import { createContextTools } from "../../src/tools/context-tools.js";

describe("ContextManager", () => {
  it("未超预算时保留原始消息", async () => {
    const manager = new ContextManager({ maxTokens: 1000 });
    const messages: CoreMessage[] = [{ role: "user", content: "短消息" }];
    expect(await manager.manage(messages)).toEqual(messages);
  });

  it("超预算时保留系统消息与最近对话并生成摘要", async () => {
    const manager = new ContextManager({ maxTokens: 80, reserveTokens: 20 });
    const result = await manager.manage([
      { role: "system", content: "规则" },
      ...Array.from({ length: 12 }, (_, index) => ({ role: "user" as const, content: `消息 ${index} ${"长".repeat(40)}` })),
    ]);

    expect(result[0]).toMatchObject({ role: "system", content: "规则" });
    expect(result.at(-1)?.content).toContain("消息 11");
    expect(result.length).toBeLessThan(13);
    expect(result.some(message => typeof message.content === "string" && message.content.includes("早期对话摘要"))).toBe(true);
  });
});

describe("压缩器", () => {
  it("工具结果压缩保留结构化错误", () => {
    const compressor = new ToolResultCompressor();
    const error = JSON.stringify({ success: false, error: { error: "permission denied", isRetryable: false } });
    expect(compressor.compress(error, 20)).toContain("permission denied");

    const repeated = Array.from({ length: 100 }, () => "same output").join("\n");
    const compressed = compressor.compress(repeated, 30);
    expect(compressed.length).toBeLessThan(repeated.length);
    expect(compressed).toContain("压缩");
  });

  it("无模型时生成确定性对话摘要", async () => {
    const compressor = new DialogueCompressor();
    const summary = await compressor.compress([
      { role: "user", content: "部署服务" },
      { role: "assistant", content: "先检查端口" },
    ]);
    expect(summary).toContain("部署服务");
    expect(summary).toContain("先检查端口");
  });
});

describe("ContextAssembler 与上下文工具", () => {
  it("组合系统提示和受预算约束的消息", async () => {
    const promptBuilder = new PromptBuilder({ maxTokens: 1000 });
    promptBuilder.addResident("核心身份", "identity");
    const manager = new ContextManager({ maxTokens: 1000 });
    const assembler = new ContextAssembler({ promptBuilder, contextManager: manager });
    const assembled = await assembler.assemble({ messages: [{ role: "user", content: "你好" }] });

    expect(assembled.systemPrompt).toContain("核心身份");
    expect(assembled.messages).toHaveLength(1);
    expect(assembled.totalTokens).toBeGreaterThan(0);
  });

  it("提供 Token 计数工具", async () => {
    const [countTool] = createContextTools(new ContextManager());
    const result = JSON.parse(await countTool.execute({ messages: [{ role: "user", content: "hello" }] }));
    expect(JSON.parse(result.output)).toMatchObject({ tokens: expect.any(Number), messageCount: 1 });
  });
});
