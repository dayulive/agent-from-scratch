import { runAgentLoop, type AgentLoopResult } from "../agent-loop.js";
import type { LLMClient } from "../llm-client.js";
import type { ToolRegistry } from "../../tools/registry.js";

export function runACILoop(config: {
  llmClient: LLMClient;
  toolRegistry: ToolRegistry;
  maxSteps?: number;
}, goal: string): Promise<AgentLoopResult> {
  return runAgentLoop({
    ...config,
    systemPrompt: "你是 Agent-Computer Interface 执行器。观察工具结果，选择下一个最小动作；每个动作必须可验证，目标完成后报告结果。",
  }, goal);
}
