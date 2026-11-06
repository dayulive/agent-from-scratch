#!/usr/bin/env node
import { createInterface, type Interface as ReadlineInterface } from "node:readline/promises";
import { loadLocalEnv } from "./agent/env.js";
import chalk from "chalk";
import { Command } from "commander";
import { loadConfig } from "./agent/config-loader.js";
import { assembleAgent, createSandboxFactory } from "./agent/builder.js";
import type { AgentConfig } from "./agent/config.js";
import type { ApprovalRequest } from "./core/safety/approval-gate.js";
import { startServer } from "./server/index.js";
import { dataAnalysisSkill, devopsDeploySkill, logDiagnosticsSkill } from "./skills/builtin/index.js";

type AssembledAgent = Awaited<ReturnType<typeof assembleAgent>>;
interface GlobalOptions {
  model?: string;
  provider?: "openai" | "anthropic";
}

const program = new Command();
program
  .name("agent")
  .description("从零构建的命令行 AI Agent")
  .version("1.0.0")
  .option("-m, --model <model>", "覆盖 LLM 模型")
  .option("-p, --provider <provider>", "模型提供商：openai 或 anthropic")
  .showHelpAfterError();

program.command("ask <input>").description("执行单次任务").action(async (input: string) => {
  await withAgent(async (agent, readline) => {
    
    const result = await agent.agentRunner.run(input);
    console.log(result.finalAnswer);
    if (!readline && result.plan) console.error(`已完成计划：${result.plan.subTasks.length} 个子任务`);
  });
});

program.command("serve").description("启动 HTTP/SSE 服务").action(async () => {
  const { app } = await startServer(currentConfig());
  const address = app.server.address();
  console.log(`服务地址：${typeof address === "string" ? address : `${address?.address}:${address?.port}`}`);
});

program.command("skills").description("列出内置 Skills").action(() => {
  for (const skill of [devopsDeploySkill, dataAnalysisSkill, logDiagnosticsSkill]) {
    console.log(`${skill.name}\t${skill.description}`);
  }
});

program.command("sandbox").description("检查沙箱后端可用性").action(async () => {
  const factory = createSandboxFactory(currentConfig());
  console.log(JSON.stringify(await factory.analyze(), null, 2));
});

program.command("evaluate").description("运行评测；无 API Key 时使用离线基线").action(async () => {
  await import("./evaluation/run-suite.js");
});

program.action(async () => {
  if (!process.stdin.isTTY) {
    program.outputHelp();
    return;
  }
  await withAgent(async (agent, readline) => {
    console.log("Agent 已启动。输入任务，/skills 查看 Skills，/exit 退出。");
    while (true) {
      const input = (await readline!.question(chalk.cyan("agent> "))).trim();
      if (!input) continue;
      if (["/exit", "/quit"].includes(input)) break;
      if (input === "/skills") {
        console.log(agent.skillManager.list().map(skill => `${skill.name}: ${skill.description}`).join("\n"));
        continue;
      }
      
      const result = await agent.agentRunner.run(input);
      console.log(result.finalAnswer);
    }
  });
});

async function withAgent(action: (agent: AssembledAgent, readline?: ReadlineInterface) => Promise<void>): Promise<void> {
  const config = currentConfig();
  if (!config.llm.apiKey) throw new Error("请先配置 OPENAI_API_KEY 或 ANTHROPIC_API_KEY");
  const readline = process.stdin.isTTY
    ? createInterface({ input: process.stdin, output: process.stdout })
    : undefined;
  let agent: AssembledAgent;
  const approvalHandler = (request: ApprovalRequest) => {
    console.warn(`\n审批请求 ${request.id}\n${request.commands.join("\n")}`);
    if (!readline) {
      setImmediate(() => agent.safetySystem.approvalGate.reject(request.id, "non-interactive", "非交互环境自动拒绝"));
      return;
    }
    void readline.question("允许执行上述命令吗？[y/N] ").then(answer => {
      if (["y", "yes"].includes(answer.trim().toLowerCase())) agent.safetySystem.approvalGate.approve(request.id, "cli");
      else agent.safetySystem.approvalGate.reject(request.id, "cli");
    });
  };
  try {
    agent = await assembleAgent(config, { approvalHandler });
  } catch (error) {
    readline?.close();
    throw error;
  }
  const unsubscribe = agent.agentRunner.events.subscribe(event => {
    if (event.type === "tool_start") console.error(chalk.gray(`执行工具：${JSON.stringify(event.data)}`));
    if (event.type === "tool_error") console.error(chalk.yellow(`工具错误：${JSON.stringify(event.data)}`));
  });
  try {
    await action(agent, readline);
  } finally {
    unsubscribe();
    readline?.close();
    await agent.close();
  }
}

function currentConfig(): AgentConfig {
  const options = program.opts<GlobalOptions>();
  const config = loadConfig();
  if (options.model) config.llm.model = options.model;
  if (options.provider) {
    if (!["openai", "anthropic"].includes(options.provider)) throw new Error(`未知提供商：${options.provider}`);
    config.llm.provider = options.provider;
    config.llm.apiKey = options.provider === "openai" ? process.env.OPENAI_API_KEY ?? "" : process.env.ANTHROPIC_API_KEY ?? "";
  }
  return config;
}

async function main(): Promise<void> {
  loadLocalEnv();
  await program.parseAsync(process.argv);
}

main().catch(error => {
  console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
