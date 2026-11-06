import type { SandboxConfig } from "../core/sandbox/types.js";
import type { SafetyConfig } from "../core/safety/safety-system.js";
import type { MemoryConfig } from "../core/memory/types.js";

export interface AgentConfig {
  llm: {
    provider: "openai" | "anthropic";
    model: string;
    apiKey: string;
    baseUrl?: string;
    maxRetries?: number;
    timeout?: number;
  };
  embedding?: { provider: "openai"; model: string; apiKey: string; baseUrl?: string };
  sandbox?: SandboxConfig;
  safety?: SafetyConfig & { useLLMInputGuard?: boolean };
  orchestration: {
    maxSteps: number;
    enablePlanning: boolean;
    enableReflection: boolean;
  };
  memory?: Omit<MemoryConfig, "dataDir"> & { dataDir: string; enabled?: boolean };
  prompt?: { maxTokens: number };
  server?: { port: number; host: string };
  checkpointPath?: string | false;
  vision?: { enabled: boolean };
}

export const defaultConfig: AgentConfig = {
  llm: {
    provider: "openai",
    model: "gpt-4o",
    apiKey: process.env.OPENAI_API_KEY ?? "",
    maxRetries: 3,
    timeout: 60000,
  },
  orchestration: { maxSteps: 15, enablePlanning: true, enableReflection: true },
  sandbox: {
    defaultTimeout: 30,
    memoryLimit: "256m",
    networkEnabled: false,
    allowLocal: true,
    preferredBackend: "auto",
    workDir: process.cwd(),
  },
  safety: {
    enableInputGuard: true,
    enableCommandControl: true,
    enableApproval: true,
    enableOutputGuard: true,
    approvalTimeout: 120,
    useLLMInputGuard: false,
  },
  memory: { dataDir: "./memory-data", semanticCollectionName: "agent_memory", semanticBackend: "file", enabled: true },
  prompt: { maxTokens: 6000 },
  server: { port: 3000, host: "0.0.0.0" },
  checkpointPath: "./checkpoints/agent-state.db",
  vision: { enabled: false },
};
