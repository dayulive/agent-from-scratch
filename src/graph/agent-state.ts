import { Annotation } from "@langchain/langgraph";
import type { CoreMessage } from "ai";

export interface SubTask {
  id: string;
  description: string;
  expectedOutput: string;
  dependencies: string[];
  status: "pending" | "in_progress" | "done" | "failed";
  assignedTool?: string;
  result?: string;
}

export interface Plan {
  originalTask: string;
  analysis: string;
  subTasks: SubTask[];
  createdAt: Date;
}

export interface PendingToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export const AgentState = Annotation.Root({
  messages: Annotation<CoreMessage[]>({
    reducer: (existing, update) => [...existing, ...update],
    default: () => [],
  }),
  step: Annotation<number>({ reducer: (_, update) => update, default: () => 0 }),
  isDone: Annotation<boolean>({ reducer: (_, update) => update, default: () => false }),
  finalAnswer: Annotation<string>({ reducer: (_, update) => update, default: () => "" }),
  pendingToolCalls: Annotation<PendingToolCall[]>({ reducer: (_, update) => update, default: () => [] }),
  plan: Annotation<Plan | null>({ reducer: (_, update) => update, default: () => null }),
  currentSubTaskId: Annotation<string | null>({ reducer: (_, update) => update, default: () => null }),
  reflectionDone: Annotation<boolean>({ reducer: (_, update) => update, default: () => false }),
  error: Annotation<string | null>({ reducer: (_, update) => update, default: () => null }),
});

export type AgentStateType = typeof AgentState.State;
