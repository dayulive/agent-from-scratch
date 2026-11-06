# Agent From Scratch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在空目录中交付用户指定结构的完整 TypeScript Agent，并通过单元测试、构建、静态检查和本地端到端验证。

**Architecture:** CLI 与 Fastify 服务共用组装器和 LangGraph 运行器；模型、工具、上下文、记忆、安全和沙箱通过接口解耦。外部能力按运行环境启用，测试使用内存模型与临时目录。

**Tech Stack:** Node.js 22+、TypeScript 5.6+、Vercel AI SDK、LangGraph、Zod、Fastify、Vitest、官方 MCP SDK。

## Global Constraints

- 使用 ESM、`NodeNext` 模块解析和显式 `.js` 相对导入。
- 保留用户给出的目录与主要公开类型，补齐所有省略文件，不留空实现。
- 不读取或写入真实 `.env` 密钥；测试不依赖真实 API Key、Docker、ChromaDB 或桌面会话。
- 本地沙箱仅作最后降级，必须明确提示无隔离；启用安全控制时禁止绕过沙箱直接执行宿主机命令。
- 不执行 Git 初始化、提交、推送或 GitHub 远程操作。
- 每个功能任务先写失败测试，再实现，再运行该任务测试；后续任务必须保持既有测试通过。

## 文件责任图

- `src/agent/`：默认配置、环境加载和依赖组装。
- `src/core/`：模型调用、Token、提示、上下文、记忆、沙箱、安全、事件、运行器与教学循环。
- `src/tools/`：工具契约、注册表、Shell/文件工具、视觉和 MCP 适配。
- `src/graph/`：状态、节点、路由和图编译。
- `src/skills/`：Skill 契约、管理器与三个内置 Skill。
- `src/evaluation/`：用例、执行器及代码/模型/人工评分器。
- `src/observability/`：追踪、指标、告警和聚合面板。
- `src/server/`：Fastify、SSE 和任务 API。
- `tests/`：Vitest 单元与集成测试。
- 根目录与 `.github/`：包配置、容器、CI 和使用文档。

---

### Task 1: 工程骨架、Token、提示与模型客户端

**Files:**
- Create: `package.json`, `tsconfig.json`, `eslint.config.js`, `.gitignore`, `.env.example`
- Create: `src/core/token-counter.ts`, `src/core/llm-client.ts`, `src/core/prompt/prompt-builder.ts`
- Test: `tests/core/prompt-builder.test.ts`, `tests/core/llm-client.test.ts`

**Interfaces:**
- Produces: `TokenCounter.count(text): number`, `PromptBuilder.build(options?): string`, `LLMClient.chat(messages, options?): Promise<LLMResponse>`, `LLMClient.streamChat(...): AsyncGenerator<StreamEvent>`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { PromptBuilder } from "../../src/core/prompt/prompt-builder.js";

describe("PromptBuilder", () => {
  it("按层和优先级构建提示并支持清理", () => {
    const builder = new PromptBuilder({ maxTokens: 100 });
    builder.addRuntime("第二步", "step", 20);
    builder.addResident("身份", "identity", 0);
    expect(builder.build()).toContain("<system-core>");
    expect(builder.build().indexOf("身份")).toBeLessThan(builder.build().indexOf("第二步"));
    builder.clearLayer("runtime");
    expect(builder.build()).not.toContain("第二步");
  });
});
```

模型测试从 `ai/test` 导入 `MockLanguageModelV1`，在 `doGenerate` 中返回 `{rawCall:{rawPrompt:null,rawSettings:{}}, finishReason:"stop", usage:{promptTokens:1,completionTokens:1}, text:"done"}`，断言直接回答、工具调用、401 不重试和 429 指数退避；用 fake timers 避免真实等待。

- [ ] **Step 2: 运行并确认失败**

Run: `npm test -- tests/core/prompt-builder.test.ts tests/core/llm-client.test.ts`
Expected: 因配置文件或目标模块不存在而 FAIL。

- [ ] **Step 3: 实现最小代码**

安装用户清单中的依赖，并补充与 ESLint 9 匹配的 `typescript-eslint`、`@eslint/js`、`@ai-sdk/anthropic`、`@ai-sdk/provider`。`LLMClient` 将注册表工具定义转换为 AI SDK `tool({description,inputSchema,execute})` 所需的 JSON Schema 格式，使用 `AbortSignal.timeout` 控制超时，记录真实 usage；重试规则与公开错误类型保持原稿语义。`TokenCounter` 延迟创建编码器并在 `dispose` 后拒绝继续计数，防止原生资源泄漏。

- [ ] **Step 4: 运行并确认通过**

Run: `npm test -- tests/core/prompt-builder.test.ts tests/core/llm-client.test.ts`
Expected: 两个测试文件全部 PASS。

---

### Task 2: 工具、沙箱与安全

**Files:**
- Create: `src/tools/types.ts`, `src/tools/create-tool.ts`, `src/tools/registry.ts`, `src/tools/shell-tools.ts`, `src/tools/context-tools.ts`
- Create: `src/core/sandbox/types.ts`, `sandbox-factory.ts`, `local-sandbox.ts`, `docker-sandbox.ts`, `nsjail-sandbox.ts`, `seccomp-sandbox.ts`
- Create: `src/core/safety/input-guard.ts`, `command-analyzer.ts`, `approval-gate.ts`, `output-guard.ts`, `safety-system.ts`
- Test: `tests/tools/tools.test.ts`, `tests/core/sandbox.test.ts`, `tests/core/safety.test.ts`

**Interfaces:**
- Produces: `createTool<T>(config): ToolInstance<T>`, `ToolRegistry`, `SandboxFactory.createSession(): Promise<SandboxSession>`, `SafetySystem.requestApprovalIfNeeded(commands, context)`。
- Consumes: Task 1 的 `LLMClient`，仅用于可选输入守卫模型检测。

- [ ] **Step 1: 写失败测试**

```ts
it("拒绝非法工具参数且不执行副作用", async () => {
  let called = false;
  const tool = createTool({
    name: "echo", description: "echo", schema: z.object({ value: z.string() }),
    execute: async ({ value }) => { called = true; return value; },
  });
  const result = JSON.parse(await tool.execute({ value: 42 } as never));
  expect(result.success).toBe(false);
  expect(result.error.isRetryable).toBe(true);
  expect(called).toBe(false);
});

it("阻断高危命令并遮蔽输出密钥", async () => {
  const safety = new SafetySystem({}, undefined);
  expect(safety.analyzeCommand("rm -rf /").level).toBe(SecurityLevel.BLOCKED);
  expect(safety.filterOutput("OPENAI_API_KEY=sk-secret-value")).not.toContain("sk-secret-value");
});
```

另测临时目录读写/覆盖保护、注册表重名、LocalSandbox 非零退出码和超时、后端不可用降级、审批批准/拒绝/超时。

- [ ] **Step 2: 运行并确认失败**

Run: `npm test -- tests/tools/tools.test.ts tests/core/sandbox.test.ts tests/core/safety.test.ts`
Expected: 目标导出不存在，FAIL。

- [ ] **Step 3: 实现最小代码**

`createTool` 返回 `{success,output}` 或结构化错误；注册表同时输出 AI SDK 工具映射。Docker 使用 dockerode 创建带资源限制的会话并执行 `sh -lc`，NSJAIL/Seccomp 先检查二进制，Local 使用 `execFile("/bin/sh", ["-lc", command])` 并处理超时。命令分析先识别阻断模式，再识别写入和提权；审批门使用 Promise、Map 和计时器，所有等待路径都清理计时器。输出守卫覆盖常见 API Key、Bearer Token 和私钥块。

- [ ] **Step 4: 运行并确认通过**

Run: `npm test -- tests/tools/tools.test.ts tests/core/sandbox.test.ts tests/core/safety.test.ts`
Expected: 全部 PASS，无真实 Docker/NSJAIL 调用。

---

### Task 3: 上下文与记忆

**Files:**
- Create: `src/core/context/types.ts`, `context-manager.ts`, `context-assembler.ts`, `tool-result-compressor.ts`, `dialogue-compressor.ts`
- Create: `src/core/memory/types.ts`, `episodic-store.ts`, `semantic-store.ts`, `memory-manager.ts`
- Test: `tests/core/context.test.ts`, `tests/core/memory.test.ts`

**Interfaces:**
- Produces: `ContextManager.manage(messages): Promise<CoreMessage[]>`, `ContextAssembler.assemble(input): Promise<AssembledContext>`, `MemoryManager.retrieveRelevant(query, options)`、`recordEpisode()`、`learn()`、`initialize()`、`close()`。

- [ ] **Step 1: 写失败测试**

```ts
it("超预算时保留系统消息与最近对话", async () => {
  const manager = new ContextManager({ maxTokens: 80, reserveTokens: 20 });
  const result = await manager.manage([
    { role: "system", content: "规则" },
    ...Array.from({ length: 12 }, (_, i) => ({ role: "user" as const, content: `消息 ${i} ${"长".repeat(40)}` })),
  ]);
  expect(result[0]).toMatchObject({ role: "system", content: "规则" });
  expect(result.at(-1)?.content).toContain("消息 11");
});

it("重启后仍能读取情景和语义记忆", async () => {
  const first = new MemoryManager(new DeterministicEmbeddingService(), { dataDir: tempDir });
  await first.initialize();
  await first.learn("[部署]→[端口冲突]→[先检查端口]", ["devops"], 0.9);
  await first.close();
  const second = new MemoryManager(new DeterministicEmbeddingService(), { dataDir: tempDir });
  await second.initialize();
  expect((await second.retrieveRelevant("部署端口冲突", { limit: 3 })).length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `npm test -- tests/core/context.test.ts tests/core/memory.test.ts`
Expected: 模块不存在，FAIL。

- [ ] **Step 3: 实现最小代码**

工具压缩保留 JSON 错误字段并截断重复行；对话压缩优先调用模型，失败时使用最近消息确定性摘要。情景存储使用 JSONL 和追加写入；语义存储定义 `EmbeddingService` 接口，提供 OpenAI 与确定性实现，文件向量集使用余弦相似度并原子写入，ChromaDB 作为可选后端。`learn` 同时写程序性/语义记录，检索按相关度排序并应用阈值。

- [ ] **Step 4: 运行并确认通过**

Run: `npm test -- tests/core/context.test.ts tests/core/memory.test.ts`
Expected: 全部 PASS，临时目录已清理。

---

### Task 4: 事件、Skills 与图编排

**Files:**
- Create: `src/core/streaming/event-emitter.ts`, `src/core/aci/aci-loop.ts`, `src/core/agent-loop.ts`
- Create: `src/skills/types.ts`, `manager.ts`, `builtin/devops-deploy.ts`, `data-analysis.ts`, `log-diagnostics.ts`
- Create: `src/graph/agent-state.ts`, `agent-graph.ts`, `routing.ts`, `nodes/agent-node.ts`, `tool-node.ts`, `planner-node.ts`, `replanner-node.ts`, `reflect-node.ts`
- Create: `src/core/sandbox/agent-runner.ts`
- Test: `tests/graph/agent-graph.test.ts`, `tests/skills/manager.test.ts`, `tests/core/events.test.ts`

**Interfaces:**
- Consumes: Tasks 1-3 的模型、工具、安全和记忆接口。
- Produces: `createReactAgent(config): CompiledStateGraph`, `AgentRunner.run(input, options?): Promise<AgentRunResult>`、`stream()`，以及 `AgentEventEmitter` 的 `thinkingStart/toolStart/toolComplete/...` 方法。

- [ ] **Step 1: 写失败测试**

使用脚本化内存模型依次返回工具调用和最终文本，断言图执行 `echo` 工具并保留 assistant/tool 消息关联；复杂任务进入 planner；关闭 planning/reflection 时路由不访问未注册节点；工具拒绝后模型收到结构化错误。Skill 测试断言按需注入和卸载，事件测试断言 unsubscribe 后不再收到事件。

- [ ] **Step 2: 运行并确认失败**

Run: `npm test -- tests/graph/agent-graph.test.ts tests/skills/manager.test.ts tests/core/events.test.ts`
Expected: 目标导出不存在，FAIL。

- [ ] **Step 3: 实现最小代码**

State 使用 `Annotation.Root`，消息追加、其余字段替换。Agent 节点保存模型原始 tool call 响应，工具节点写回匹配 `tool_call_id` 的工具消息。`afterAgent` 在错误且启用反思时进入 reflect，否则完成或继续；`afterStart` 尊重配置。checkpoint 目录在编译前创建。Runner 使用唯一 `thread_id`，支持配置覆盖和事件流，结束后记录记忆并输出步数、答案和消息。

教学 `agent-loop` 与 ACI 循环复用同一工具/模型契约，保持精简且可运行。

- [ ] **Step 4: 运行并确认通过**

Run: `npm test -- tests/graph/agent-graph.test.ts tests/skills/manager.test.ts tests/core/events.test.ts`
Expected: 全部 PASS。

---

### Task 5: MCP 与视觉工具

**Files:**
- Create: `src/tools/mcp/mcp-client.ts`, `mcp-server.ts`
- Create: `src/tools/vision/index.ts`, `screenshot-tool.ts`, `visual-analyzer.ts`, `gui-tools.ts`
- Test: `tests/tools/mcp.test.ts`, `tests/tools/vision.test.ts`

**Interfaces:**
- Produces: `MCPClientManager.connect/listTools/callTool/close`、`createMcpServer(registry)`、`createScreenshotTool()`、`VisualAnalyzer.analyze()`、GUI 工具集合。

- [ ] **Step 1: 写失败测试**

用 MCP SDK 的内存 transport 连接真实客户端/服务，验证工具列举和调用；视觉测试注入假的截图与 GUI adapter，验证返回格式、坐标参数和不可用错误，不读取真实屏幕。

- [ ] **Step 2: 运行并确认失败**

Run: `npm test -- tests/tools/mcp.test.ts tests/tools/vision.test.ts`
Expected: 模块不存在，FAIL。

- [ ] **Step 3: 实现最小代码**

MCP 服务把注册表 JSON Schema 暴露为工具，客户端按服务名隔离连接并统一关闭。截图工具使用 `screenshot-desktop` 和 `sharp`，输出 PNG 路径、尺寸和 base64（可关闭 base64）；VisualAnalyzer 将图片送入多模态模型；GUI 工具通过 adapter 执行移动、点击、输入和按键，默认 adapter 在无原生依赖时报告明确不可用。

- [ ] **Step 4: 运行并确认通过**

Run: `npm test -- tests/tools/mcp.test.ts tests/tools/vision.test.ts`
Expected: 全部 PASS，无桌面副作用。

---

### Task 6: 评测与可观测性

**Files:**
- Create: `src/evaluation/types.ts`, `test-cases.ts`, `runner.ts`, `run-suite.ts`, `evaluators/code-evaluator.ts`, `model-evaluator.ts`, `human-evaluator.ts`
- Create: `src/observability/tracer.ts`, `metrics.ts`, `alerts.ts`, `dashboard.ts`
- Test: `tests/evaluation/runner.test.ts`, `tests/observability/metrics.test.ts`

**Interfaces:**
- Produces: `EvaluationRunner.run(cases, options)`、`CodeEvaluator/ModelEvaluator/HumanEvaluator.evaluate`、`MetricsRegistry`、`AlertEngine`、`Dashboard.snapshot()`、`Tracer`。

- [ ] **Step 1: 写失败测试**

```ts
it("统计成功率与 pass@k", async () => {
  const runner = new EvaluationRunner(async () => "4", new CodeEvaluator());
  const report = await runner.run([{ id: "math", input: "2+2", expected: "4", category: "reasoning" }], { k: 2 });
  expect(report.totalCases).toBe(1);
  expect(report.passAtK).toBe(1);
  expect(report.results).toHaveLength(2);
});
```

指标测试覆盖计数、均值、P95、Token 汇总、阈值告警与无 Langfuse 凭据时的本地 trace。

- [ ] **Step 2: 运行并确认失败**

Run: `npm test -- tests/evaluation/runner.test.ts tests/observability/metrics.test.ts`
Expected: 模块不存在，FAIL。

- [ ] **Step 3: 实现最小代码**

Runner 限制并发、隔离单次失败、计算 Pass@k=`1-C(n-c,k)/C(n,k)`（`n<k` 时按实际尝试次数），默认用例使用确定性本地执行器时才可离线运行。模型评分器解析 JSON 并限制分数 0-1；人工评分器通过注入回调获取评分。Tracer 可选连接 Langfuse；Metrics 使用快照返回副本，AlertEngine 支持规则开关和冷却时间。

- [ ] **Step 4: 运行并确认通过**

Run: `npm test -- tests/evaluation/runner.test.ts tests/observability/metrics.test.ts`
Expected: 全部 PASS。

---

### Task 7: 配置、组装、CLI 与 HTTP/SSE

**Files:**
- Create: `src/agent/config.ts`, `config-loader.ts`, `builder.ts`, `src/cli.ts`
- Create: `src/server/index.ts`, `sse-server.ts`, `task-api.ts`
- Test: `tests/server/server.test.ts`, `tests/agent/config-loader.test.ts`, `tests/agent/builder.test.ts`

**Interfaces:**
- Consumes: Tasks 1-6 全部公开接口。
- Produces: `loadConfig(overrides?)`、`assembleAgent(config)`、`createServer(deps)`、`registerTaskRoutes(app, deps)`、`SSEConnectionManager`。

- [ ] **Step 1: 写失败测试**

配置测试覆盖环境变量、布尔/数字解析和缺失 API Key 错误；Builder 测试注入 fake model 与 LocalSandbox，验证工具注册和统一 close。Fastify inject 测试 `GET /health` 返回 200、`POST /tasks` 返回最终答案、无效 JSON 返回 400、SSE 断开后连接数归零。

- [ ] **Step 2: 运行并确认失败**

Run: `npm test -- tests/server/server.test.ts tests/agent/config-loader.test.ts tests/agent/builder.test.ts`
Expected: 目标模块不存在，FAIL。

- [ ] **Step 3: 实现最小代码**

CLI 使用 commander 提供默认交互、`ask`、`serve`、`skills`、`sandbox` 和 `evaluate` 命令；无 TTY 时支持单次输入并避免永久等待。Fastify 注册 JSON 错误处理、任务路由和 SSE；任务请求使用 Zod 校验并支持 `threadId`。`assembleAgent` 允许注入模型和沙箱以便测试，创建 checkpoint/记忆目录，返回 `close()` 完整释放资源。

- [ ] **Step 4: 运行并确认通过**

Run: `npm test -- tests/server/server.test.ts tests/agent/config-loader.test.ts tests/agent/builder.test.ts`
Expected: 全部 PASS。

---

### Task 8: 部署文件与文档

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `README.md`
- Create: `skills/.gitkeep`, `prompts/system.md`, `scripts/smoke.sh`

- [ ] **Step 1: 写验证命令**

Run: `npm run cli -- --help`
Expected: 显示 `ask`、`serve`、`skills`、`sandbox`、`evaluate` 等命令。

- [ ] **Step 2: 添加部署与使用内容**

Dockerfile 使用 Node 22 多阶段构建，生产阶段以非 root 用户运行并声明 3000 端口；Compose 仅挂载明确的数据卷，默认不开放沙箱网络。CI 在 Node 22 上执行 `npm ci`、lint、test、build。README 说明架构、安装、配置、CLI/HTTP/SSE 示例、安全边界、可选外部服务和验证命令，不声称本地降级具备隔离。

- [ ] **Step 3: 运行烟雾检查**

Run: `bash scripts/smoke.sh`
Expected: 在无外部凭据情况下完成 CLI 帮助、编译产物健康检查和离线评测。

---

### Task 9: 全量验证与交付审查

**Files:**
- Verify: 全部上述文件。

- [ ] **Step 1: 运行标准质量门**

Run: `npm run lint && npm test && npm run build`
Expected: 命令退出码均为 0；无 TypeScript 错误或测试失败。

- [ ] **Step 2: 运行用户原始场景**

Run: `npm run cli -- --help`、`npm run evaluate`、启动编译后的服务并请求 `GET /health`。
Expected: CLI 可用、评测产生报告、健康接口返回 `{ "status": "ok" }`。

- [ ] **Step 3: 检查文件与清理**

Run: `git status --short`（若不是 Git 仓库则使用目录清单）并检查 `dist/`、数据库、临时报告和日志。
Expected: 删除非交付需要的生成物；保留 `package-lock.json`、源码、测试、文档和配置。

- [ ] **Step 4: 完成实现审查**

调用 `requesting-code-review` skill，按需求逐项核对实现、测试证据和安全边界；只修复本次交付范围内问题，外部集成未实测项在最终说明中明确列出。
