import type { CoreMessage } from "ai";
import type { LLMClient } from "./llm-client.js";
import type { ToolRegistry } from "../tools/registry.js";

export interface AgentLoopResult {
  answer: string;
  messages: CoreMessage[];
  steps: number;
}

export async function runAgentLoop(config: {
  llmClient: LLMClient;
  toolRegistry: ToolRegistry;
  maxSteps?: number;
  systemPrompt?: string;
}, input: string): Promise<AgentLoopResult> {
  const messages: CoreMessage[] = [{ role: "user", content: input }];
  const maxSteps = config.maxSteps ?? 10;

  for (let step = 1; step <= maxSteps; step++) {
    const response = await config.llmClient.chat(messages, {
      system: config.systemPrompt ?? "你是任务执行 Agent。使用可用工具完成任务，完成后直接给出结论。",
      tools: config.toolRegistry.getToolSchemas(),
    });
    const calls = response.toolCalls ?? [];
    if (["tool-calls", "tool_calls"].includes(response.finishReason) && calls.length > 0) {
      messages.push({
        role: "assistant",
        content: [
          ...(response.text ? [{ type: "text" as const, text: response.text }] : []),
          ...calls.map(call => ({ type: "tool-call" as const, toolCallId: call.toolCallId, toolName: call.toolName, args: call.args })),
        ],
      });
      for (const call of calls) {
        const tool = config.toolRegistry.get(call.toolName);
        const result = tool
          ? parseResult(await tool.execute(call.args))
          : { success: false, error: { error: `未知工具：${call.toolName}`, isRetryable: false } };
        messages.push({ role: "tool", content: [{ type: "tool-result", toolCallId: call.toolCallId, toolName: call.toolName, result }] });
      }
      continue;
    }
    messages.push({ role: "assistant", content: response.text });
    return { answer: response.text, messages, steps: step };
  }
  const answer = "达到最大执行步数，任务未完成";
  messages.push({ role: "assistant", content: answer });
  return { answer, messages, steps: maxSteps };
}

function parseResult(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return { success: true, output };
  }
}
