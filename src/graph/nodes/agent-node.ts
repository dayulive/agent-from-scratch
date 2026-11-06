import type { CoreMessage } from "ai";
import type { AgentStateType, PendingToolCall } from "../agent-state.js";
import type { LLMClient } from "../../core/llm-client.js";
import type { PromptBuilder } from "../../core/prompt/prompt-builder.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { MemoryManager } from "../../core/memory/memory-manager.js";
import type { ContextManager } from "../../core/context/context-manager.js";
import type { AgentEventEmitter } from "../../core/streaming/event-emitter.js";
import { messageContentToString } from "../../core/context/types.js";
import type { MetricsRegistry } from "../../observability/metrics.js";

export function createAgentNode(config: {
  llmClient: LLMClient;
  promptBuilder: PromptBuilder;
  toolRegistry: ToolRegistry;
  memoryManager?: MemoryManager;
  contextManager?: ContextManager;
  eventEmitter?: AgentEventEmitter;
  metrics?: MetricsRegistry;
}) {
  const { llmClient, promptBuilder, toolRegistry, memoryManager, contextManager, eventEmitter, metrics } = config;

  return async function agentNode(state: AgentStateType, runtimeConfig?: { signal?: AbortSignal }): Promise<Partial<AgentStateType>> {
    const currentStep = state.step + 1;
    promptBuilder.clearLayer("runtime");
    promptBuilder.addRuntime(`当前执行步数：${currentStep}`, `step-${currentStep}`);

    if (currentStep === 1 && memoryManager) {
      const lastUser = [...state.messages].reverse().find(message => message.role === "user");
      if (lastUser) {
        const memories = await memoryManager.retrieveRelevant(messageContentToString(lastUser), { limit: 5, minRelevance: 0.5 });
        promptBuilder.clearLayer("memory");
        for (const memory of memories) {
          promptBuilder.addMemory(
            `[相关记忆 ${(memory.relevance * 100).toFixed(0)}%] ${memory.entry.content}`,
            `mem-${memory.entry.id}`,
          );
        }
      }
    }

    eventEmitter?.thinkingStart();
    try {
      const messages = contextManager ? await contextManager.manage(state.messages) : state.messages;
      const response = await llmClient.chat(messages, {
        system: promptBuilder.build(),
        tools: toolRegistry.getToolSchemas(),
        signal: runtimeConfig?.signal,
      });
      metrics?.increment("llm_calls");
      metrics?.recordDuration("llm_duration", response.duration);
      metrics?.recordTokens(response.usage);
      eventEmitter?.thinkingEnd(response.text.slice(0, 200));
      const hasToolCalls = ["tool-calls", "tool_calls"].includes(response.finishReason) && (response.toolCalls?.length ?? 0) > 0;

      if (hasToolCalls) {
        const pendingToolCalls: PendingToolCall[] = response.toolCalls!.map((toolCall: any, index: number) => ({
          id: toolCall.toolCallId ?? toolCall.id ?? `call_${Date.now()}_${index}`,
          name: toolCall.toolName ?? toolCall.name,
          args: normalizeArgs(toolCall.args ?? toolCall.arguments),
        }));
        const content = [
          ...(response.text ? [{ type: "text" as const, text: response.text }] : []),
          ...pendingToolCalls.map(toolCall => ({
            type: "tool-call" as const,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args: toolCall.args,
          })),
        ];
        return {
          messages: [{ role: "assistant", content } as CoreMessage],
          pendingToolCalls,
          isDone: false,
          step: currentStep,
        };
      }

      const isDone = response.finishReason !== "error";
      return {
        messages: [{ role: "assistant", content: response.text }],
        pendingToolCalls: [],
        isDone,
        finalAnswer: isDone ? response.text : "",
        step: currentStep,
      };
    } catch (error) {
      const message = `推理失败：${error instanceof Error ? error.message : String(error)}`;
      eventEmitter?.thinkingEnd(message);
      return {
        messages: [{ role: "assistant", content: message }],
        pendingToolCalls: [],
        isDone: true,
        finalAnswer: "",
        error: message,
        step: currentStep,
      };
    }
  };
}

function normalizeArgs(args: unknown): Record<string, unknown> {
  if (typeof args === "string") {
    try {
      return JSON.parse(args) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return args && typeof args === "object" ? args as Record<string, unknown> : {};
}
