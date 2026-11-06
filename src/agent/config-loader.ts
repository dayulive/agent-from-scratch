import { defaultConfig, type AgentConfig } from "./config.js";

export function loadConfig(overrides: Partial<AgentConfig> = {}, env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const provider = overrides.llm?.provider ?? env.LLM_PROVIDER ?? defaultConfig.llm.provider;
  if (provider !== "openai" && provider !== "anthropic") throw new Error(`LLM_PROVIDER 非法：${provider}`);
  const apiKey = overrides.llm?.apiKey ?? (provider === "openai" ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY) ?? "";

  return {
    ...defaultConfig,
    ...overrides,
    llm: {
      ...defaultConfig.llm,
      ...overrides.llm,
      provider,
      model: overrides.llm?.model ?? env.LLM_MODEL ?? defaultConfig.llm.model,
      apiKey,
      baseUrl: overrides.llm?.baseUrl ?? env.LLM_BASE_URL ?? defaultConfig.llm.baseUrl,
      maxRetries: overrides.llm?.maxRetries ?? optionalNumber(env.LLM_MAX_RETRIES, "LLM_MAX_RETRIES") ?? defaultConfig.llm.maxRetries,
      timeout: overrides.llm?.timeout ?? optionalNumber(env.LLM_TIMEOUT, "LLM_TIMEOUT") ?? defaultConfig.llm.timeout,
    },
    embedding: overrides.embedding ?? (env.EMBEDDING_MODEL ? {
      provider: "openai",
      model: env.EMBEDDING_MODEL,
      apiKey: env.OPENAI_API_KEY ?? "",
      baseUrl: env.EMBEDDING_BASE_URL,
    } : undefined),
    orchestration: {
      ...defaultConfig.orchestration,
      ...overrides.orchestration,
      maxSteps: overrides.orchestration?.maxSteps ?? optionalNumber(env.AGENT_MAX_STEPS, "AGENT_MAX_STEPS") ?? defaultConfig.orchestration.maxSteps,
      enablePlanning: overrides.orchestration?.enablePlanning ?? optionalBoolean(env.AGENT_ENABLE_PLANNING, "AGENT_ENABLE_PLANNING") ?? defaultConfig.orchestration.enablePlanning,
      enableReflection: overrides.orchestration?.enableReflection ?? optionalBoolean(env.AGENT_ENABLE_REFLECTION, "AGENT_ENABLE_REFLECTION") ?? defaultConfig.orchestration.enableReflection,
    },
    sandbox: {
      ...defaultConfig.sandbox,
      ...overrides.sandbox,
      memoryLimit: overrides.sandbox?.memoryLimit ?? env.SANDBOX_MEMORY_LIMIT ?? defaultConfig.sandbox?.memoryLimit,
      networkEnabled: overrides.sandbox?.networkEnabled ?? optionalBoolean(env.SANDBOX_NETWORK_ENABLED, "SANDBOX_NETWORK_ENABLED") ?? defaultConfig.sandbox?.networkEnabled,
      allowLocal: overrides.sandbox?.allowLocal ?? optionalBoolean(env.SAFETY_ALLOW_LOCAL, "SAFETY_ALLOW_LOCAL") ?? defaultConfig.sandbox?.allowLocal,
      preferredBackend: overrides.sandbox?.preferredBackend ?? parseBackend(env.SANDBOX_BACKEND) ?? defaultConfig.sandbox?.preferredBackend,
      workDir: overrides.sandbox?.workDir ?? env.SANDBOX_WORK_DIR ?? defaultConfig.sandbox?.workDir,
    },
    safety: {
      ...defaultConfig.safety,
      ...overrides.safety,
      enableInputGuard: overrides.safety?.enableInputGuard ?? optionalBoolean(env.SAFETY_INPUT_GUARD, "SAFETY_INPUT_GUARD") ?? defaultConfig.safety?.enableInputGuard,
      enableCommandControl: overrides.safety?.enableCommandControl ?? optionalBoolean(env.SAFETY_COMMAND_CONTROL, "SAFETY_COMMAND_CONTROL") ?? defaultConfig.safety?.enableCommandControl,
      enableApproval: overrides.safety?.enableApproval ?? optionalBoolean(env.SAFETY_APPROVAL, "SAFETY_APPROVAL") ?? defaultConfig.safety?.enableApproval,
      enableOutputGuard: overrides.safety?.enableOutputGuard ?? optionalBoolean(env.SAFETY_OUTPUT_GUARD, "SAFETY_OUTPUT_GUARD") ?? defaultConfig.safety?.enableOutputGuard,
    },
    memory: {
      ...defaultConfig.memory,
      ...overrides.memory,
      dataDir: overrides.memory?.dataDir ?? env.MEMORY_DATA_DIR ?? defaultConfig.memory!.dataDir,
      semanticBackend: overrides.memory?.semanticBackend ?? parseMemoryBackend(env.MEMORY_SEMANTIC_BACKEND) ?? defaultConfig.memory?.semanticBackend,
      chromaUrl: overrides.memory?.chromaUrl ?? env.CHROMADB_URL,
      enabled: overrides.memory?.enabled ?? optionalBoolean(env.MEMORY_ENABLED, "MEMORY_ENABLED") ?? defaultConfig.memory?.enabled,
    },
    prompt: {
      maxTokens: overrides.prompt?.maxTokens ?? optionalNumber(env.PROMPT_MAX_TOKENS, "PROMPT_MAX_TOKENS") ?? defaultConfig.prompt!.maxTokens,
    },
    server: {
      port: overrides.server?.port ?? optionalNumber(env.PORT, "PORT") ?? defaultConfig.server!.port,
      host: overrides.server?.host ?? env.HOST ?? defaultConfig.server!.host,
    },
    checkpointPath: overrides.checkpointPath ?? parseCheckpointPath(env.CHECKPOINT_PATH) ?? defaultConfig.checkpointPath,
    vision: {
      enabled: overrides.vision?.enabled ?? optionalBoolean(env.VISION_ENABLED, "VISION_ENABLED") ?? defaultConfig.vision!.enabled,
    },
  };
}

function optionalBoolean(value: string | undefined, name: string): boolean | undefined {
  if (value === undefined || value === "") return undefined;
  if (["true", "1", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["false", "0", "no", "off"].includes(value.toLowerCase())) return false;
  throw new Error(`${name} 必须是 true 或 false`);
}

function optionalNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} 必须是非负数字`);
  return parsed;
}

function parseBackend(value: string | undefined): "auto" | "local" | "docker" | "nsjail" | "seccomp" | undefined {
  if (!value || value === "auto") return value === "auto" ? "auto" : undefined;
  if (value === "local" || value === "docker" || value === "nsjail" || value === "seccomp") return value;
  throw new Error(`SANDBOX_BACKEND 非法：${value}`);
}

function parseMemoryBackend(value: string | undefined): "file" | "chromadb" | undefined {
  if (!value) return undefined;
  if (value === "file" || value === "chromadb") return value;
  throw new Error(`MEMORY_SEMANTIC_BACKEND 非法：${value}`);
}

function parseCheckpointPath(value: string | undefined): string | false | undefined {
  if (!value) return undefined;
  return value === "false" ? false : value;
}
