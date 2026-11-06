import type { EvaluationCase, EvaluationScore, Evaluator } from "../types.js";

export class CodeEvaluator implements Evaluator {
  async evaluate(testCase: EvaluationCase, output: string): Promise<EvaluationScore> {
    const assertions = testCase.assertions ?? (testCase.expected !== undefined ? [{ type: "exact" as const, value: testCase.expected }] : []);
    if (assertions.length === 0) return { score: output.trim() ? 1 : 0, passed: Boolean(output.trim()), reason: output.trim() ? "回答非空" : "回答为空" };
    const checks = assertions.map(assertion => this.check(assertion.type, assertion.value, output));
    const passedCount = checks.filter(Boolean).length;
    const score = passedCount / checks.length;
    return {
      score,
      passed: score === 1,
      reason: checks.every(Boolean) ? "全部断言通过" : `通过 ${passedCount}/${checks.length} 个断言`,
    };
  }

  private check(type: string, expected: string, output: string): boolean {
    if (type === "exact") return output.trim() === expected.trim();
    if (type === "contains") return output.includes(expected);
    if (type === "regex") return new RegExp(expected, "ims").test(output);
    if (type === "json_equal") {
      try {
        return JSON.stringify(JSON.parse(output)) === JSON.stringify(JSON.parse(expected));
      } catch {
        return false;
      }
    }
    return false;
  }
}
