import type { EvaluationCase, EvaluationScore, Evaluator } from "../types.js";

export type HumanReview = (testCase: EvaluationCase, output: string) => Promise<{ score: number; reason?: string }>;

export class HumanEvaluator implements Evaluator {
  constructor(private readonly review: HumanReview) {}

  async evaluate(testCase: EvaluationCase, output: string): Promise<EvaluationScore> {
    const result = await this.review(testCase, output);
    const score = Math.max(0, Math.min(1, result.score));
    return { score, passed: score >= 0.8, reason: result.reason ?? "人工评分完成" };
  }
}
