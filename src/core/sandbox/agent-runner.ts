import { randomUUID } from "node:crypto";
import type { CoreMessage } from "ai";
import type { SandboxFactory } from "./sandbox-factory.js";
import type { MemoryManager } from "../memory/memory-manager.js";
import type { AgentEvent } from "../streaming/event-emitter.js";
import { AgentEventEmitter } from "../streaming/event-emitter.js";
import { SafetySystem } from "../safety/safety-system.js";
import type { MetricsRegistry } from "../../observability/metrics.js";
import type { Tracer } from "../../observability/tracer.js";
import { messageContentToString } from "../context/types.js";
import type { Plan } from "../../graph/agent-state.js";

export interface AgentRunOptions {
  threadId?: string;
  recursionLimit?: number;
  signal?: AbortSignal;
}

export interface AgentRunResult {
  runId: string;
  threadId: string;
  finalAnswer: string;
  messages: CoreMessage[];
  step: number;
  plan: Plan | null;
}

interface GraphRuntime {
  graph: any;
  close?: () => Promise<void>;
}

interface RunRuntime {
  runId: string;
  taskText: string;
  graph: any;
  events: AgentEventEmitter;
  controller: AbortController;
  close: () => Promise<void>;
}

export class AgentRunner {
  readonly events: AgentEventEmitter;
  private readonly safetySystem: SafetySystem;
  private readonly activeRuns = new Map<string, AbortController>();
  private readonly operations = new Set<Promise<unknown>>();
  private closed = false;
  private closePromise?: Promise<void>;

  constructor(private readonly config: {
    sandboxManager?: SandboxFactory;
    compiledGraph?: any;
    graphFactory?: (context: {
      eventEmitter: AgentEventEmitter;
      runId: string;
      task: string;
      signal: AbortSignal;
    }) => Promise<GraphRuntime>;
    memoryManager?: MemoryManager | null;
    safetySystem?: SafetySystem;
    eventEmitter?: AgentEventEmitter;
    metrics?: MetricsRegistry;
    tracer?: Tracer;
  }) {
    this.events = config.eventEmitter ?? new AgentEventEmitter();
    this.safetySystem = config.safetySystem ?? new SafetySystem({ enableApproval: false });
  }

  async run(input: string | CoreMessage[], options: AgentRunOptions = {}): Promise<AgentRunResult> {
    this.assertOpen();
    const controller = new AbortController();
    return this.track((async () => {
      const runtime = await this.createRuntime(input, options, controller);
      return this.execute(runtime, input, options);
    })());
  }

  async *stream(input: string | CoreMessage[], options: AgentRunOptions = {}): AsyncGenerator<AgentEvent> {
    this.assertOpen();
    const controller = new AbortController();
    const runtimePromise = this.createRuntime(input, options, controller);
    const queue: AgentEvent[] = [];
    let done = false;
    let failure: unknown;
    let notify = () => {};
    let unsubscribe = () => {};
    const running = this.track((async () => {
      const runtime = await runtimePromise;
      unsubscribe = runtime.events.subscribe(event => {
        queue.push(this.sanitizeEvent(event, runtime.runId));
        notify();
      });
      return this.execute(runtime, input, options);
    })());
    const settled = running.catch(error => { failure = error; }).finally(() => {
      done = true;
      notify();
    });

    try {
      await runtimePromise;
      while (!done || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift()!;
          continue;
        }
        await new Promise<void>(resolve => { notify = resolve; });
      }
      await settled;
      if (failure) throw failure;
    } finally {
      unsubscribe();
      controller.abort(new Error("事件流已关闭"));
      notify();
      await settled;
    }
  }

  get activeRunCount(): number {
    return this.activeRuns.size;
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = (async () => {
      for (const controller of this.activeRuns.values()) controller.abort(new Error("AgentRunner 已关闭"));
      while (this.operations.size > 0) await Promise.allSettled([...this.operations]);
    })();
    return this.closePromise;
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    const tracked = operation.finally(() => this.operations.delete(tracked));
    this.operations.add(tracked);
    return tracked;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("AgentRunner 已关闭，拒绝新任务");
  }

  private async createRuntime(input: string | CoreMessage[], options: AgentRunOptions, controller: AbortController): Promise<RunRuntime> {
    const runId = randomUUID();
    const task = typeof input === "string" ? input : [...input].reverse().find(message => message.role === "user")?.content;
    const taskText = typeof task === "string" ? task : task ? JSON.stringify(task) : "";
    const events = new AgentEventEmitter();
    const onExternalAbort = () => controller.abort(options.signal?.reason ?? new Error("运行已取消"));
    if (options.signal?.aborted) onExternalAbort();
    options.signal?.addEventListener("abort", onExternalAbort, { once: true });
    this.activeRuns.set(runId, controller);

    let graphRuntime: GraphRuntime;
    try {
      graphRuntime = this.config.graphFactory
        ? await this.config.graphFactory({ eventEmitter: events, runId, task: taskText, signal: controller.signal })
        : { graph: this.config.compiledGraph };
    } catch (error) {
      this.activeRuns.delete(runId);
      options.signal?.removeEventListener("abort", onExternalAbort);
      throw error;
    }
    if (!graphRuntime.graph) {
      this.activeRuns.delete(runId);
      options.signal?.removeEventListener("abort", onExternalAbort);
      events.clear();
      await graphRuntime.close?.();
      throw new Error("未配置 Agent 执行图");
    }

    return {
      runId,
      taskText,
      graph: graphRuntime.graph,
      events,
      controller,
      close: async () => {
        this.activeRuns.delete(runId);
        options.signal?.removeEventListener("abort", onExternalAbort);
        events.clear();
        await graphRuntime.close?.();
      },
    };
  }

  private async execute(runtime: RunRuntime, input: string | CoreMessage[], options: AgentRunOptions): Promise<AgentRunResult> {
    const threadId = options.threadId ?? randomUUID();
    const startedAt = Date.now();
    const forward = runtime.events.subscribe(event => this.events.publish(this.sanitizeEvent(event, runtime.runId)));
    this.config.metrics?.increment("tasks_started");
    const trace = this.config.tracer?.startTrace("agent-run", { runId: runtime.runId, threadId });
    const span = trace ? this.config.tracer?.startSpan(trace.id, "graph.invoke", this.safetySystem.filterOutput(runtime.taskText)) : undefined;
    try {
      runtime.events.runStarted(runtime.taskText);
      const inputCheck = await this.safetySystem.checkInput(runtime.taskText);
      if (!inputCheck.allowed) throw new Error(`输入被安全策略拒绝：${inputCheck.reason ?? "未知原因"}`);
      if (runtime.controller.signal.aborted) throw runtime.controller.signal.reason ?? new Error("运行已取消");
      const messages: CoreMessage[] = typeof input === "string" ? [{ role: "user", content: input }] : input;
      const state = await runtime.graph.invoke({
        messages,
        step: 0,
        isDone: false,
        finalAnswer: "",
        pendingToolCalls: [],
        plan: null,
        currentSubTaskId: null,
        reflectionDone: false,
        error: null,
      }, {
        configurable: { thread_id: threadId },
        recursionLimit: options.recursionLimit ?? runtime.graph.defaultRecursionLimit ?? 25,
        signal: runtime.controller.signal,
      });
      if (state.error) throw new Error(String(state.error));
      const finalAnswer = this.safetySystem.filterOutput(state.finalAnswer ?? "");
      const result: AgentRunResult = {
        runId: runtime.runId,
        threadId,
        finalAnswer,
        messages: this.sanitizeValue(state.messages ?? []),
        step: state.step ?? 0,
        plan: this.sanitizeValue(state.plan ?? null),
      };
      if (this.config.memoryManager && finalAnswer) {
        await this.config.memoryManager.recordEpisode({
          task: runtime.taskText,
          success: true,
          steps: result.messages.filter(message => message.role === "tool").map(messageContentToString),
          outcome: finalAnswer.slice(0, 2000),
        });
      }
      this.config.metrics?.increment("tasks_completed");
      runtime.events.finalAnswer(finalAnswer);
      runtime.events.runCompleted(finalAnswer, result.step);
      span?.end({ status: "completed", answer: finalAnswer });
      trace?.end({ status: "completed", answer: finalAnswer });
      return result;
    } catch (error) {
      this.config.metrics?.increment("tasks_failed");
      const message = error instanceof Error ? error.message : String(error);
      runtime.events.runError(error);
      span?.end({ status: "failed", error: message });
      trace?.end({ status: "failed", error: message });
      throw error;
    } finally {
      this.config.metrics?.recordDuration("task_duration", Date.now() - startedAt);
      forward();
      await runtime.close();
    }
  }

  private sanitizeEvent(event: AgentEvent, runId: string): AgentEvent {
    return { ...event, runId, data: this.sanitizeValue(event.data) };
  }

  private sanitizeValue<T>(value: T): T {
    if (typeof value === "string") return this.safetySystem.filterOutput(value) as T;
    if (Array.isArray(value)) return value.map(item => this.sanitizeValue(item)) as T;
    if (value && typeof value === "object") {
      if (value instanceof Date) return value;
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.sanitizeValue(item)])) as T;
    }
    return value;
  }
}
