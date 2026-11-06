export type AgentEventType =
  | "run_started" | "run_completed" | "run_error"
  | "thinking_start" | "thinking_end"
  | "planning_start" | "planning_complete"
  | "tool_start" | "tool_complete" | "tool_error"
  | "reflection" | "final_answer" | "node";

export interface AgentEvent<T = unknown> {
  type: AgentEventType;
  timestamp: Date;
  data: T;
  runId?: string;
}

export type AgentEventListener = (event: AgentEvent) => void;

export class AgentEventEmitter {
  private readonly listeners = new Set<AgentEventListener>();

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit<T>(type: AgentEventType, data: T): AgentEvent<T> {
    return this.publish({ type, timestamp: new Date(), data });
  }

  publish<T>(event: AgentEvent<T>): AgentEvent<T> {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 观察者失败不能中断 Agent 主流程。
      }
    }
    return event;
  }

  runStarted(input: string): void { this.emit("run_started", { input }); }
  runCompleted(answer: string, step: number): void { this.emit("run_completed", { answer, step }); }
  runError(error: unknown): void { this.emit("run_error", { error: error instanceof Error ? error.message : String(error) }); }
  thinkingStart(): void { this.emit("thinking_start", {}); }
  thinkingEnd(summary: string): void { this.emit("thinking_end", { summary }); }
  planningStart(): void { this.emit("planning_start", {}); }
  planningComplete(subTasks: unknown[]): void { this.emit("planning_complete", { subTasks }); }
  toolStart(name: string, args: Record<string, unknown>): void { this.emit("tool_start", { name, args }); }
  toolComplete(name: string, duration: number): void { this.emit("tool_complete", { name, duration }); }
  toolError(name: string, error: string): void { this.emit("tool_error", { name, error }); }
  reflection(content: string): void { this.emit("reflection", { content }); }
  finalAnswer(content: string): void { this.emit("final_answer", { content }); }
  node(name: string, state: unknown): void { this.emit("node", { name, state }); }

  clear(): void {
    this.listeners.clear();
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}
