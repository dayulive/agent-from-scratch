import { mkdirSync } from "node:fs";
import path from "node:path";
import { StateGraph, START, END } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { AgentState } from "./agent-state.js";
import { createAgentNode } from "./nodes/agent-node.js";
import { createToolNode } from "./nodes/tool-node.js";
import { createPlannerNode } from "./nodes/planner-node.js";
import { createReflectNode } from "./nodes/reflect-node.js";
import { afterAgent, afterStart } from "./routing.js";
import type { LLMClient } from "../core/llm-client.js";
import type { PromptBuilder } from "../core/prompt/prompt-builder.js";
import type { ContextManager } from "../core/context/context-manager.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { MemoryManager } from "../core/memory/memory-manager.js";
import type { SandboxSession } from "../core/sandbox/types.js";
import type { SafetySystem } from "../core/safety/safety-system.js";
import type { AgentEventEmitter } from "../core/streaming/event-emitter.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { ToolResultCompressor } from "../core/context/tool-result-compressor.js";

export interface AgentGraphConfig {
  llmClient: LLMClient;
  promptBuilder: PromptBuilder;
  toolRegistry: ToolRegistry;
  memoryManager?: MemoryManager;
  contextManager?: ContextManager;
  safetySystem?: SafetySystem;
  getSandboxSession: () => SandboxSession | null;
  eventEmitter?: AgentEventEmitter;
  recursionLimit?: number;
  enablePlanning?: boolean;
  enableReflection?: boolean;
  checkpointPath?: string | false;
  checkpointer?: SqliteSaver;
  metrics?: MetricsRegistry;
  toolResultCompressor?: ToolResultCompressor;
}

export function createReactAgent(config: AgentGraphConfig): any {
  const {
    llmClient, promptBuilder, toolRegistry, memoryManager, contextManager,
    safetySystem, eventEmitter, metrics,
    recursionLimit = 15, enablePlanning = true, enableReflection = true,
  } = config;

  const agentNode = createAgentNode({ llmClient, promptBuilder, toolRegistry, memoryManager, contextManager, eventEmitter, metrics });
  const toolNode = createToolNode({ toolRegistry, safetySystem, eventEmitter, metrics, toolResultCompressor: config.toolResultCompressor });
  const agentRoutes: Record<string, string> = { agent: "agent", tools: "tools", END };
  if (enableReflection) agentRoutes.reflect = "reflect";

  let graph: any = new StateGraph(AgentState)
    .addNode("agent", agentNode)
    .addNode("tools", toolNode)
    .addConditionalEdges(START, (state: any) => afterStart(state, { enablePlanning }), {
      agent: "agent",
      ...(enablePlanning ? { planner: "planner" } : {}),
    } as any)
    .addConditionalEdges("agent", (state: any) => afterAgent(state, { enableReflection }), agentRoutes as any)
    .addEdge("tools", "agent");

  if (enablePlanning) {
    const plannerNode = createPlannerNode({ llmClient, promptBuilder, eventEmitter });
    graph = graph.addNode("planner", plannerNode).addEdge("planner", "agent");
  }
  if (enableReflection) {
    const reflectNode = createReflectNode({ llmClient, memoryManager, eventEmitter });
    graph = graph.addNode("reflect", reflectNode).addEdge("reflect", "agent");
  }

  const checkpointer = config.checkpointer ?? (config.checkpointPath === false
    ? undefined
    : createSqliteCheckpointer(config.checkpointPath ?? "./checkpoints/agent-state.db"));
  const compiledGraph = graph.compile({ checkpointer });
  compiledGraph.defaultRecursionLimit = recursionLimit;
  return compiledGraph;
}

export function createSqliteCheckpointer(checkpointPath: string): SqliteSaver {
  mkdirSync(path.dirname(checkpointPath), { recursive: true });
  return SqliteSaver.fromConnString(checkpointPath);
}
