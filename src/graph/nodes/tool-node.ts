import type { CoreMessage } from "ai";
import type { AgentStateType, PendingToolCall } from "../agent-state.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { SafetySystem } from "../../core/safety/safety-system.js";
import type { AgentEventEmitter } from "../../core/streaming/event-emitter.js";
import { ToolResultCompressor } from "../../core/context/tool-result-compressor.js";
import type { MetricsRegistry } from "../../observability/metrics.js";

export function createToolNode(config: {
  toolRegistry: ToolRegistry;
  safetySystem?: SafetySystem;
  eventEmitter?: AgentEventEmitter;
  metrics?: MetricsRegistry;
  toolResultCompressor?: ToolResultCompressor;
}) {
  const { toolRegistry, safetySystem, eventEmitter, metrics } = config;
  const compressor = config.toolResultCompressor ?? new ToolResultCompressor();

  return async function toolNode(state: AgentStateType, runtimeConfig?: { signal?: AbortSignal }): Promise<Partial<AgentStateType>> {
    const calls = state.pendingToolCalls ?? [];
    if (calls.length === 0) return { pendingToolCalls: [] };

    const results = await Promise.allSettled(calls.map(async call => {
      const start = Date.now();
      metrics?.increment("tool_calls");
      eventEmitter?.toolStart(call.name, call.args);
      const tool = toolRegistry.get(call.name);
      if (!tool) {
        metrics?.increment("tool_errors");
        metrics?.recordDuration("tool_duration", Date.now() - start);
        eventEmitter?.toolError(call.name, "工具不存在");
        return createToolMessage(call, { success: false, error: { error: `未知工具：${call.name}`, isRetryable: false } });
      }
      try {
        const output = await tool.execute(call.args, { signal: runtimeConfig?.signal });
        const compressed = compressor.compress(output, 1000);
        const result = parseToolOutput(safetySystem?.filterOutput(compressed) ?? compressed);
        metrics?.recordDuration("tool_duration", Date.now() - start);
        if (isFailure(result)) {
          metrics?.increment("tool_errors");
          eventEmitter?.toolError(call.name, errorMessage(result));
        } else {
          eventEmitter?.toolComplete(call.name, Date.now() - start);
        }
        return createToolMessage(call, result);
      } catch (error) {
        metrics?.increment("tool_errors");
        metrics?.recordDuration("tool_duration", Date.now() - start);
        eventEmitter?.toolError(call.name, String(error));
        return createToolMessage(call, { success: false, error: { error: String(error), isRetryable: false } });
      }
    }));

    const messages = results.map((result, index) => result.status === "fulfilled"
      ? result.value
      : createToolMessage(calls[index], { success: false, error: { error: String(result.reason), isRetryable: false } }));
    return { messages, pendingToolCalls: [] };
  };
}

function createToolMessage(call: PendingToolCall, result: unknown): CoreMessage {
  return {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: call.id, toolName: call.name, result }],
  };
}

function parseToolOutput(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return { success: true, output: output.slice(0, 8000) };
  }
}

function isFailure(result: unknown): boolean {
  return Boolean(result && typeof result === "object" && (result as { success?: boolean }).success === false);
}

function errorMessage(result: unknown): string {
  if (result && typeof result === "object") {
    const error = (result as { error?: { error?: string } }).error;
    if (error?.error) return error.error;
  }
  return "工具执行失败";
}
