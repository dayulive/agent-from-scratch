import type { AgentStateType } from "./agent-state.js";
import { messageContentToString } from "../core/context/types.js";

export const ROUTES = { PLANNER: "planner", AGENT: "agent", TOOLS: "tools", REFLECT: "reflect", END: "END" } as const;
export type RouteValue = (typeof ROUTES)[keyof typeof ROUTES];

export function afterStart(state: AgentStateType, options: { enablePlanning?: boolean } = {}): RouteValue {
  if (state.plan || options.enablePlanning === false) return ROUTES.AGENT;
  const lastUser = [...state.messages].reverse().find(message => message.role === "user");
  if (!lastUser) return ROUTES.AGENT;
  const task = messageContentToString(lastUser);
  const complexKeywords = ["部署", "迁移", "搭建", "配置环境", "安装", "排查", "优化", "重构"];
  return task.length > 100 || complexKeywords.some(keyword => task.includes(keyword)) ? ROUTES.PLANNER : ROUTES.AGENT;
}

export function afterPlanner(): RouteValue {
  return ROUTES.AGENT;
}

export function afterAgent(state: AgentStateType, options: { enableReflection?: boolean } = {}): RouteValue {
  if (state.pendingToolCalls?.length > 0) return ROUTES.TOOLS;
  if (options.enableReflection && !state.reflectionDone && hasToolErrors(state)) return ROUTES.REFLECT;
  if (state.isDone) return ROUTES.END;
  return ROUTES.AGENT;
}

function hasToolErrors(state: AgentStateType): boolean {
  return state.messages.some(message => {
    if (message.role !== "tool") return false;
    const content = messageContentToString(message);
    return content.includes('"success":false') || content.includes("permission denied") || content.includes("执行异常");
  });
}
