import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AgentRunner, AgentRunResult } from "../core/sandbox/agent-runner.js";
import type { SSEConnectionManager } from "./sse-server.js";

const taskInputSchema = z.object({ input: z.string().min(1).max(100_000), threadId: z.string().min(1).optional() });

export interface TaskRecord {
  id: string;
  status: "completed" | "failed";
  threadId: string;
  result?: AgentRunResult;
  error?: string;
  createdAt: Date;
}

export function registerTaskRoutes(app: FastifyInstance, dependencies: {
  agentRunner?: AgentRunner;
  sseConnectionManager: SSEConnectionManager;
}): void {
  const tasks = new Map<string, TaskRecord>();

  app.post("/tasks", async (request, reply) => {
    const parsed = taskInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "任务输入无效", details: parsed.error.issues });
    if (!dependencies.agentRunner) return reply.code(503).send({ error: "Agent 不可用，请配置模型 API Key" });
    const id = randomUUID();
    try {
      const result = await dependencies.agentRunner.run(parsed.data.input, { threadId: parsed.data.threadId });
      const record: TaskRecord = { id, status: "completed", threadId: result.threadId, result, createdAt: new Date() };
      tasks.set(id, record);
      return reply.code(201).send(record);
    } catch (error) {
      const record: TaskRecord = {
        id,
        status: "failed",
        threadId: parsed.data.threadId ?? "",
        error: error instanceof Error ? error.message : String(error),
        createdAt: new Date(),
      };
      tasks.set(id, record);
      return reply.code(500).send(record);
    }
  });

  app.get("/tasks/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const task = tasks.get(id);
    if (!task) return reply.code(404).send({ error: "任务不存在" });
    return task;
  });

  app.post("/tasks/stream", async (request, reply) => {
    const parsed = taskInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "任务输入无效", details: parsed.error.issues });
    if (!dependencies.agentRunner) return reply.code(503).send({ error: "Agent 不可用，请配置模型 API Key" });
    reply.hijack();
    const controller = new AbortController();
    const onClose = () => controller.abort(new Error("客户端已断开连接"));
    reply.raw.once("close", onClose);
    const connectionId = dependencies.sseConnectionManager.connect(reply, { broadcast: false });
    try {
      for await (const event of dependencies.agentRunner.stream(parsed.data.input, {
        threadId: parsed.data.threadId,
        signal: controller.signal,
      })) {
        if (!dependencies.sseConnectionManager.send(connectionId, event)) break;
      }
    } finally {
      reply.raw.removeListener("close", onClose);
      dependencies.sseConnectionManager.disconnect(connectionId);
    }
  });
}
