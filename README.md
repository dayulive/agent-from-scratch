# Agent From Scratch

从零构建一个可运行的命令行 AI Agent，整合 20 期系列中的模型调用、提示工程、LangGraph 编排、工具、上下文、记忆、沙箱、安全、流式、多模态、Skills、评测、可观测性与部署代码。

## 特性

- **混合编排**：LangGraph + 规划器 + ReAct + 反思，支持 SQLite checkpoint。
- **工具系统**：Shell、文件、上下文、视觉、GUI 适配器与 MCP 客户端/服务。
- **多层安全**：输入检查、命令分级、人工审批、输出凭据屏蔽。
- **沙箱降级**：NSJAIL → Docker → Firejail/Seccomp → Local；后端不可用时自动降级。
- **记忆与 Skills**：工作上下文、程序性经验、情景记录、语义检索，以及三个内置 Skill。
- **服务与观测**：Fastify 任务 API、SSE、指标、告警、本地 Trace 和可选 Langfuse。
- **系统化评测**：30 个默认用例、并发执行、Pass@k、代码/模型/人工评分器。

## 环境要求

- Node.js 22 或更高版本（CI 使用 Node 22）。
- npm 10 或更高版本。
- 在线任务需要 OpenAI 或 Anthropic API Key；离线测试、CLI 帮助、健康检查和基线评测不需要密钥。
- Docker、NSJAIL、Firejail、ChromaDB 和桌面截图均为可选外部能力。

## 快速开始

```bash
npm install
cp .env.example .env
# 编辑 .env，填入 OPENAI_API_KEY 或 ANTHROPIC_API_KEY

npm run cli -- --help
npm run cli -- ask "总结当前目录结构"
npm run cli                 # TTY 交互模式
```

HTTP/SSE 服务：

```bash
npm run build
npm start
curl http://localhost:3000/health
curl -X POST http://localhost:3000/tasks \
  -H 'content-type: application/json' \
  -d '{"input":"你好","threadId":"demo"}'
```

未配置 API Key 时，服务仍可启动并提供 `/health`，但 `/tasks` 会返回 503。任务流接口为 `POST /tasks/stream`，事件连接为 `GET /events`，聚合指标为 `GET /dashboard`。

## 常用命令

```bash
npm run dev                 # 监听 CLI 源码
npm run cli -- skills      # 列出内置 Skills
npm run cli -- sandbox     # 检查沙箱后端，不创建会话
npm run evaluate           # 有密钥时评测 Agent，否则运行离线基线
npm run evaluate -- --offline
npm run lint
npm test
npm run build
bash scripts/smoke.sh
```

`ask` 命令在交互终端中遇到需审批命令时会显示完整命令并询问；非交互环境自动拒绝需审批命令。Local 后端仅用于开发，**不提供隔离**。生产环境请配置 NSJAIL 或 Docker，并用 `SAFETY_ALLOW_LOCAL=false` 禁止本地降级。

文件工具仅允许访问 `SANDBOX_WORK_DIR` 内的路径，会检查 `..`、绝对路径和符号链接逃逸，并限制读取字节、写入内容和目录条目；写入操作复用审批门。命令安全分析和阻断位于工具边界，图、MCP 与教学循环共用同一约束。

每次运行都有独立 `runId`、提示状态、事件通道和取消控制器。`GET /events` 是全局监控流，`POST /tasks/stream` 只接收本任务事件；客户端断开会取消底层模型和沙箱执行，服务关闭会等待活动运行结束。

## 配置

主要环境变量见 `.env.example`：

| 配置 | 默认值 | 说明 |
|---|---|---|
| `LLM_PROVIDER` | `openai` | `openai` 或 `anthropic` |
| `LLM_MODEL` | `gpt-4o` | 模型名称 |
| `AGENT_MAX_STEPS` | `15` | 单次任务图递归上限 |
| `SANDBOX_BACKEND` | `auto` | `auto/local/docker/nsjail/seccomp` |
| `SANDBOX_NETWORK_ENABLED` | `false` | 沙箱网络默认关闭 |
| `SAFETY_ALLOW_LOCAL` | `true` | 是否允许无隔离本地降级 |
| `MEMORY_SEMANTIC_BACKEND` | `file` | `file` 或 `chromadb` |
| `MEMORY_DATA_DIR` | `./memory-data` | 记忆持久化目录 |
| `CHECKPOINT_PATH` | `./checkpoints/agent-state.db` | 设为 `false` 可关闭 checkpoint |
| `VISION_ENABLED` | `false` | 是否注册截图和 GUI 工具 |

未配置 Embedding 时，记忆系统使用本地确定性嵌入和文件向量存储。设置 `EMBEDDING_MODEL` 后使用 OpenAI Embedding；设置 `MEMORY_SEMANTIC_BACKEND=chromadb` 后连接 `CHROMADB_URL`。Langfuse 只有配置两个密钥后才导出 Trace。

## 架构

```text
CLI / Fastify / SSE
        ↓
   AgentRunner
        ↓
     LangGraph ─────── Memory / Skills / Prompt
        ↓
 Agent / Tools / Planner / Reflect
        ↓
 LLMClient + ToolRegistry + SafetySystem
        ↓
 SandboxFactory / 文件与上下文工具 / MCP / Vision
```

核心模块位于 `src/core`，图节点位于 `src/graph`，工具位于 `src/tools`，服务位于 `src/server`。`src/core/agent-loop.ts` 是精简教学循环，生产入口使用 LangGraph。详细设计与实施记录见 `docs/superpowers/`。

## 评测与验证

`npm test` 使用内存模型、MCP 内存传输和临时目录，不访问真实模型或桌面。`npm run evaluate -- --offline` 仅验证评测执行器和断言管线，**不代表模型能力评分**；配置 API Key 后不带 `--offline` 才会运行真实 Agent 评测。

完整本地质量门：

```bash
npm run lint && npm test && npm run build && bash scripts/smoke.sh
```

## Docker

```bash
docker build -t agent-from-scratch .
docker compose up --build
```

Compose 使用非 root 容器、只读根文件系统、独立记忆和 checkpoint 数据卷，不挂载 Docker Socket。容器内默认使用 Local 后端，命令作用于该容器而非宿主机；如需更强隔离，请自行配置独立沙箱服务，不要共享宿主机 Docker Socket。

## 外部能力边界

- NSJAIL、Firejail 和 Docker 的执行路径需要对应 Linux/守护进程环境；不可用时会检测并降级。
- 截图需要操作系统屏幕录制权限；GUI 默认适配器会明确报告不可用，需注入原生桌面实现。
- ChromaDB、Langfuse 和真实模型集成本身依赖外部服务与凭据，离线测试不覆盖这些远端调用。
