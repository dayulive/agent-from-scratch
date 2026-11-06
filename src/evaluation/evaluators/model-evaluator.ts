import type { LLMClient } from "../../core/llm-client.js";
import type { EvaluationCase, EvaluationScore, Evaluator } from "../types.js";

export class ModelEvaluator implements Evaluator {
  constructor(private readonly llmClient: LLMClient) {}

  async evaluate(testCase: EvaluationCase, output: string, signal?: AbortSignal): Promise<EvaluationScore> {
    const response = await this.llmClient.chat([{
      role: "user",
      content: `问题：${testCase.input}\n参考答案：${testCase.expected ?? "无"}\n待评回答：${output}\n从正确性、完整性和相关性综合评分。只输出 JSON {"score":0.0,"reason":"..."}，score 为 0 到 1。`,
    }], { system: "你是严格的评测员，只输出 JSON。", maxTokens: 300, signal });
    try {
      const text = response.text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? response.text;
      const parsed = JSON.parse(text.trim()) as { score?: number; reason?: string };
      const score = Math.max(0, Math.min(1, Number(parsed.score) || 0));
      return { score, passed: score >= 0.8, reason: parsed.reason ?? "模型评分完成" };
    } catch {
      return { score: 0, passed: false, reason: "模型评分响应不是有效 JSON" };
    }
  }
}
