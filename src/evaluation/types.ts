export interface CodeAssertion {
  type: "exact" | "contains" | "regex" | "json_equal";
  value: string;
}

export interface EvaluationCase {
  id: string;
  input: string;
  expected?: string;
  category: string;
  assertions?: CodeAssertion[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface EvaluationScore {
  score: number;
  passed: boolean;
  reason: string;
}

export interface Evaluator {
  evaluate(testCase: EvaluationCase, output: string, signal?: AbortSignal): Promise<EvaluationScore>;
}

export interface EvaluationResult {
  caseId: string;
  attempt: number;
  output: string;
  score: number;
  passed: boolean;
  reason: string;
  duration: number;
  error?: string;
}

export interface EvaluationReport {
  totalCases: number;
  totalAttempts: number;
  passedCases: number;
  passRate: number;
  passAtK: number;
  duration: number;
  results: EvaluationResult[];
}

export type AgentExecutor = (input: string, testCase: EvaluationCase, signal?: AbortSignal) => Promise<string>;
