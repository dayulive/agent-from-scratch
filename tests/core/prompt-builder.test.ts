import { describe, expect, it } from "vitest";
import { PromptBuilder } from "../../src/core/prompt/prompt-builder.js";

describe("PromptBuilder", () => {
  it("按层和优先级构建提示并支持清理", () => {
    const builder = new PromptBuilder({ maxTokens: 1000 });
    builder.addRuntime("第二步", "step", 20);
    builder.addResident("安全", "safety", 2);
    builder.addResident("身份", "identity", 1);

    const prompt = builder.build();
    expect(prompt).toContain("<system-core>");
    expect(prompt.indexOf("身份")).toBeLessThan(prompt.indexOf("安全"));
    expect(prompt.indexOf("安全")).toBeLessThan(prompt.indexOf("第二步"));

    builder.clearLayer("runtime");
    expect(builder.build()).not.toContain("第二步");
  });

  it("按来源删除并统计分层 Token", () => {
    const builder = new PromptBuilder({ maxTokens: 1 });
    builder.addMemory("remember this", "mem-1");
    builder.addOnDemand("skill body", "skill-1");
    builder.removeBySource("skill-1");

    expect(builder.build()).not.toContain("skill body");
    expect(builder.getTokenStats().memory.sectionCount).toBe(1);
    expect(builder.isOverBudget()).toBe(true);
    expect(builder.getTotalTokens()).toBeGreaterThan(1);
  });

  it("可以只构建指定层", () => {
    const builder = new PromptBuilder();
    builder.addResident("核心", "core");
    builder.addMemory("历史", "memory");
    expect(builder.build({ activeLayers: ["resident"] })).not.toContain("历史");
  });
});
