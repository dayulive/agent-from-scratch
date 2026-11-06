import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import type { AgentRunner } from "../core/sandbox/agent-runner.js";
import type { SandboxFactory } from "../core/sandbox/sandbox-factory.js";
import type { Dashboard } from "../observability/dashboard.js";
import { loadConfig } from "../agent/config-loader.js";
import { loadLocalEnv } from "../agent/env.js";
import type { AgentConfig } from "../agent/config.js";
import { SSEConnectionManager } from "./sse-server.js";
import { registerTaskRoutes } from "./task-api.js";

export interface ServerDependencies {
  agentRunner?: AgentRunner;
  sandboxFactory?: SandboxFactory;
  sseConnectionManager?: SSEConnectionManager;
  dashboard?: Dashboard;
  logger?: boolean;
}

export async function createServer(dependencies: ServerDependencies = {}) {
  const app = Fastify({ logger: dependencies.logger ?? false });
  const sseConnectionManager = dependencies.sseConnectionManager ?? new SSEConnectionManager();

  app.get("/health", async () => ({
    status: "ok",
    agentAvailable: Boolean(dependencies.agentRunner),
    timestamp: new Date(),
  }));
  app.get("/dashboard", async (_request, reply) => {
    if (!dependencies.dashboard) return reply.code(503).send({ error: "可观测性面板未配置" });
    return dependencies.dashboard.snapshot();
  });
  app.get("/events", async (_request, reply) => {
    reply.hijack();
    sseConnectionManager.connect(reply);
    return reply;
  });
  registerTaskRoutes(app, { agentRunner: dependencies.agentRunner, sseConnectionManager });
  app.addHook("onClose", async () => sseConnectionManager.close());
  return app;
}

export async function startServer(config?: AgentConfig) {
  loadLocalEnv();
  const resolvedConfig = config ?? loadConfig();
  let agent: Awaited<ReturnType<typeof import("../agent/builder.js").assembleAgent>> | undefined;
  if (resolvedConfig.llm.apiKey) {
    const { assembleAgent } = await import("../agent/builder.js");
    agent = await assembleAgent(resolvedConfig);
  }
  const app = await createServer({
    agentRunner: agent?.agentRunner,
    sandboxFactory: agent?.sandboxFactory,
    sseConnectionManager: agent?.sseConnectionManager,
    dashboard: agent?.dashboard,
    logger: true,
  });
  if (!agent) app.log.warn("未配置模型 API Key，服务以仅健康检查模式启动");
  const close = async () => {
    await agent?.agentRunner.close();
    await app.close();
    await agent?.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  await app.listen({ port: resolvedConfig.server?.port ?? 3000, host: resolvedConfig.server?.host ?? "0.0.0.0" });
  return { app, agent, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch(error => {
    console.error("服务启动失败：", error);
    process.exitCode = 1;
  });
}
