import type { AgentStateType, Plan, SubTask } from "../agent-state.js";
import type { LLMClient } from "../../core/llm-client.js";
import { messageContentToString } from "../../core/context/types.js";
import { extractJson } from "./planner-node.js";

export function createReplannerNode(config: { llmClient: LLMClient }) {
  return async function replannerNode(state: AgentStateType, runtimeConfig?: { signal?: AbortSignal }): Promise<Partial<AgentStateType>> {
    if (!state.plan) return {};
    const recent = state.messages.slice(-8).map(messageContentToString).join("\n");
    try {
      const response = await config.llmClient.chat([{
        role: "user",
        content: `原计划：${JSON.stringify(state.plan)}\n最近执行：${recent}\n根据执行情况更新未完成任务。只输出 {"subTasks":[{"id":"...","description":"...","expectedOutput":"...","dependencies":[],"status":"pending"}]}`,
      }], { system: "你是任务重规划器，只输出 JSON。", maxTokens: 1500, signal: runtimeConfig?.signal });
      const parsed = extractJson(response.text) as { subTasks?: SubTask[] };
      if (!parsed.subTasks?.length) return {};
      const plan: Plan = { ...state.plan, subTasks: parsed.subTasks };
      return { plan, currentSubTaskId: plan.subTasks.find(subTask => subTask.status === "pending")?.id ?? null };
    } catch {
      return {};
    }
  };
}
