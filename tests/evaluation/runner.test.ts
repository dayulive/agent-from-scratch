import { describe, expect, it } from "vitest";
import { CodeEvaluator } from "../../src/evaluation/evaluators/code-evaluator.js";
import { HumanEvaluator } from "../../src/evaluation/evaluators/human-evaluator.js";
import { ModelEvaluator } from "../../src/evaluation/evaluators/model-evaluator.js";
import { EvaluationRunner } from "../../src/evaluation/runner.js";
import { defaultTestCases } from "../../src/evaluation/test-cases.js";
import type { LLMClient } from "../../src/core/llm-client.js";

describe("EvaluationRunner", () => {
  it("统计多次尝试与 Pass@k", async () => {
    let attempt = 0;
    const runner = new EvaluationRunner(async () => ++attempt === 1 ? "5" : "4", new CodeEvaluator());
    const report = await runner.run([{ id: "math", input: "2+2", expected: "4", category: "reasoning" }], { k: 2 });
    expect(report.totalCases).toBe(1);
    expect(report.results).toHaveLength(2);
    expect(report.passAtK).toBe(1);
    expect(report.passRate).toBe(0.5);
  });

  it("隔离单次执行异常并继续其他用例", async () => {
    const runner = new EvaluationRunner(async input => {
      if (input === "bad") throw new Error("failed");
      return "ok";
    }, new CodeEvaluator());
    const report = await runner.run([
      { id: "bad", input: "bad", expected: "ok", category: "test" },
      { id: "good", input: "good", expected: "ok", category: "test" },
    ]);
    expect(report.results[0]).toMatchObject({ passed: false, error: "failed" });
    expect(report.results[1].passed).toBe(true);
  });

  it("超时返回结构化失败并取消底层执行", async () => {
    let signal: AbortSignal | undefined;
    const runner = new EvaluationRunner((_input, _testCase, signalInput) => {
      signal = signalInput;
      return new Promise(resolve => setTimeout(() => resolve("late"), 100));
    }, new CodeEvaluator());
    const report = await runner.run([{ id: "slow", input: "slow", expected: "ok", category: "test" }], { timeoutMs: 5 });
    expect(report.results[0]).toMatchObject({ passed: false });
    expect(report.results[0].error).toContain("超时");
    expect(signal?.aborted).toBe(true);
  });

  it("提供 30 个默认评测用例", () => {
    expect(defaultTestCases).toHaveLength(30);
    expect(new Set(defaultTestCases.map(testCase => testCase.id)).size).toBe(30);
  });
});

describe("其他评分器", () => {
  it("模型评分解析 JSON 并限制分数", async () => {
    const client = { chat: async () => ({ text: "```json\n{\"score\":1.8,\"reason\":\"很好\"}\n```" }) } as LLMClient;
    const result = await new ModelEvaluator(client).evaluate({ id: "1", input: "问", expected: "答", category: "test" }, "答");
    expect(result).toMatchObject({ score: 1, passed: true, reason: "很好" });
  });

  it("人工评分通过注入回调获取结果", async () => {
    const evaluator = new HumanEvaluator(async () => ({ score: 0.5, reason: "部分正确" }));
    const result = await evaluator.evaluate({ id: "1", input: "问", category: "test" }, "答");
    expect(result).toMatchObject({ score: 0.5, passed: false, reason: "部分正确" });
  });
});
