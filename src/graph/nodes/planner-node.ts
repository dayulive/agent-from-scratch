import type { AgentStateType, Plan } from "../agent-state.js";
import type { LLMClient } from "../../core/llm-client.js";
import type { PromptBuilder } from "../../core/prompt/prompt-builder.js";
import type { AgentEventEmitter } from "../../core/streaming/event-emitter.js";
import { messageContentToString } from "../../core/context/types.js";

export function createPlannerNode(config: {
  llmClient: LLMClient;
  promptBuilder: PromptBuilder;
  eventEmitter?: AgentEventEmitter;
}) {
  const { llmClient, promptBuilder, eventEmitter } = config;

  return async function plannerNode(state: AgentStateType, runtimeConfig?: { signal?: AbortSignal }): Promise<Partial<AgentStateType>> {
    const lastUser = [...state.messages].reverse().find(message => message.role === "user");
    if (!lastUser) return { plan: null };
    eventEmitter?.planningStart();

    try {
      const response = await llmClient.chat([{ role: "user", content: messageContentToString(lastUser) }], {
        system: `${promptBuilder.build({ activeLayers: ["resident", "on_demand"] })}\n你是任务规划专家。将复杂任务拆解为可执行的子任务。只输出 JSON：{"analysis":"简要分析","subTasks":[{"id":"step-1","description":"...","expectedOutput":"...","dependencies":[],"assignedTool":null}]}。每个子任务应是可独立验证的操作，依赖最小化。`,
        maxTokens: 2000,
        signal: runtimeConfig?.signal,
      });
      const parsed = extractJson(response.text) as { analysis?: string; subTasks?: any[] };
      const plan: Plan = {
        originalTask: messageContentToString(lastUser),
        analysis: parsed.analysis ?? "",
        subTasks: (parsed.subTasks ?? []).map((subTask, index) => ({
          id: subTask.id ?? `step-${index + 1}`,
          description: subTask.description ?? "",
          expectedOutput: subTask.expectedOutput ?? "",
          dependencies: subTask.dependencies ?? [],
          status: "pending" as const,
          assignedTool: subTask.assignedTool ?? undefined,
        })),
        createdAt: new Date(),
      };
      eventEmitter?.planningComplete(plan.subTasks);
      promptBuilder.clearLayer("runtime");
      promptBuilder.addRuntime(`当前计划：\n${formatPlan(plan)}`, "active-plan", 0);
      return {
        plan,
        currentSubTaskId: plan.subTasks.find(subTask => subTask.status === "pending")?.id ?? null,
        messages: [{ role: "assistant", content: formatPlan(plan) }],
      };
    } catch {
      eventEmitter?.planningComplete([]);
      return { plan: null };
    }
  };
}

export function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1]?.trim() ?? text.trim();
  return JSON.parse(candidate);
}

function formatPlan(plan: Plan): string {
  return [
    "任务规划",
    `分析：${plan.analysis}`,
    `执行计划（共 ${plan.subTasks.length} 步）：`,
    ...plan.subTasks.map(subTask => `${subTask.id}: ${subTask.description}`),
  ].join("\n");
}
