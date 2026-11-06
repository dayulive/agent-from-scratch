import type { AgentStateType } from "../agent-state.js";
import type { LLMClient } from "../../core/llm-client.js";
import type { MemoryManager } from "../../core/memory/memory-manager.js";
import type { AgentEventEmitter } from "../../core/streaming/event-emitter.js";
import { messageContentToString } from "../../core/context/types.js";
import { extractJson } from "./planner-node.js";

export function createReflectNode(config: {
  llmClient: LLMClient;
  memoryManager?: MemoryManager;
  eventEmitter?: AgentEventEmitter;
}) {
  const { llmClient, memoryManager, eventEmitter } = config;

  return async function reflectNode(state: AgentStateType, runtimeConfig?: { signal?: AbortSignal }): Promise<Partial<AgentStateType>> {
    const task = [...state.messages].reverse().find(message => message.role === "user");
    const errors = state.messages
      .filter(message => message.role === "tool")
      .map(messageContentToString)
      .filter(content => content.includes('"success":false') || content.includes("permission denied"))
      .slice(-5);
    if (errors.length === 0) return { reflectionDone: true };

    try {
      const response = await llmClient.chat([{
        role: "user",
        content: `任务：${task ? messageContentToString(task) : "未知任务"}\n错误：\n${errors.join("\n")}\n请输出 JSON {"whatHappened":"...","rootCause":"...","improvement":"...","reusableLesson":"[场景]→[错误]→[正确]","tags":[]}`,
      }], { system: "你是 Agent 执行分析专家。只输出 JSON。", maxTokens: 600, signal: runtimeConfig?.signal });
      const reflection = extractJson(response.text) as { rootCause?: string; improvement?: string; reusableLesson?: string; tags?: string[] };
      if (memoryManager && reflection.reusableLesson) {
        await memoryManager.learn(reflection.reusableLesson, reflection.tags ?? ["reflection"], 0.8);
      }
      const content = `反思\n根因：${reflection.rootCause ?? "未知"}\n改进：${reflection.improvement ?? "重新检查错误"}\n经验：${reflection.reusableLesson ?? "无"}`;
      eventEmitter?.reflection(content);
      return { messages: [{ role: "assistant", content }], reflectionDone: true };
    } catch {
      return { reflectionDone: true };
    }
  };
}
