import { loadLocalEnv } from "../agent/env.js";
import { CodeEvaluator } from "./evaluators/code-evaluator.js";
import { EvaluationRunner } from "./runner.js";
import { baselineExecutor, defaultTestCases } from "./test-cases.js";
import type { AgentExecutor } from "./types.js";

async function main(): Promise<void> {
  loadLocalEnv();
  const hasCredentials = Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
  let executor: AgentExecutor = baselineExecutor;
  let close: (() => Promise<void>) | undefined;
  let mode = "offline-baseline";

  if (hasCredentials && !process.argv.includes("--offline")) {
    const [{ loadConfig }, { assembleAgent }] = await Promise.all([
      import("../agent/config-loader.js"),
      import("../agent/builder.js"),
    ]);
    const agent = await assembleAgent(loadConfig());
    close = agent.close;
    executor = async (input, _testCase, signal) => (await agent.agentRunner.run(input, { signal })).finalAnswer;
    mode = "live-agent";
  }

  try {
    const runner = new EvaluationRunner(executor, new CodeEvaluator());
    const report = await runner.run(defaultTestCases, { k: 1, concurrency: 3 });
    console.log(JSON.stringify({ mode, ...report }, null, 2));
    if (report.passedCases !== report.totalCases) process.exitCode = 1;
  } finally {
    await close?.();
  }
}

main().catch(error => {
  console.error("评测失败：", error);
  process.exitCode = 1;
});
