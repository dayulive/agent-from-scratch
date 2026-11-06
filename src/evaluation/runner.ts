import { CodeEvaluator } from "./evaluators/code-evaluator.js";
import type { AgentExecutor, EvaluationCase, EvaluationReport, EvaluationResult, Evaluator } from "./types.js";

export class EvaluationRunner {
  constructor(private readonly executor: AgentExecutor, private readonly evaluator: Evaluator = new CodeEvaluator()) {}

  async run(cases: EvaluationCase[], options: { k?: number; concurrency?: number; timeoutMs?: number } = {}): Promise<EvaluationReport> {
    const startedAt = Date.now();
    const attempts = Math.max(1, options.k ?? 1);
    const timeoutMs = options.timeoutMs ?? 30_000;
    const tasks = cases.flatMap(testCase => Array.from({ length: attempts }, (_, index) => ({ testCase, attempt: index + 1 })));
    const results = new Array<EvaluationResult>(tasks.length);
    let cursor = 0;
    const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, tasks.length || 1));

    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (cursor < tasks.length) {
        const index = cursor++;
        const task = tasks[index];
        results[index] = await this.runOne(task.testCase, task.attempt, timeoutMs);
      }
    }));

    const passAtKValues = cases.map(testCase => estimatePassAtK(results.filter(result => result.caseId === testCase.id), attempts));
    const passedCases = cases.filter(testCase => results.some(result => result.caseId === testCase.id && result.passed)).length;
    return {
      totalCases: cases.length,
      totalAttempts: results.length,
      passedCases,
      passRate: results.length === 0 ? 0 : results.filter(result => result.passed).length / results.length,
      passAtK: passAtKValues.length === 0 ? 0 : passAtKValues.reduce((sum, value) => sum + value, 0) / passAtKValues.length,
      duration: Date.now() - startedAt,
      results,
    };
  }

  private async runOne(testCase: EvaluationCase, attempt: number, timeoutMs: number): Promise<EvaluationResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      const execution = async () => {
        const output = await this.executor(testCase.input, testCase, controller.signal);
        const score = await this.evaluator.evaluate(testCase, output, controller.signal);
        return { caseId: testCase.id, attempt, output, ...score, duration: Date.now() - startedAt };
      };
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort(new Error(`评测超时（${timeoutMs}ms）`));
          reject(controller.signal.reason);
        }, timeoutMs);
      });
      return await Promise.race([execution(), timeout]);
    } catch (error) {
      return {
        caseId: testCase.id,
        attempt,
        output: "",
        score: 0,
        passed: false,
        reason: "执行、评分异常或超时",
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startedAt,
      };
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort(new Error("评测尝试已结束"));
    }
  }
}

function estimatePassAtK(results: EvaluationResult[], k: number): number {
  const n = results.length;
  const c = results.filter(result => result.passed).length;
  const samples = Math.min(k, n);
  if (n === 0 || samples === 0 || c === 0) return 0;
  if (n - c < samples) return 1;
  return 1 - combination(n - c, samples) / combination(n, samples);
}

function combination(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let index = 1; index <= k; index++) result = result * (n - k + index) / index;
  return result;
}
