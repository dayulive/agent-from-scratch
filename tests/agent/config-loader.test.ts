import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/agent/config.js";
import { loadConfig } from "../../src/agent/config-loader.js";

describe("loadConfig", () => {
  it("读取默认配置", () => {
    const config = loadConfig({}, {});
    expect(config.orchestration.maxSteps).toBe(defaultConfig.orchestration.maxSteps);
    expect(config.sandbox?.networkEnabled).toBe(false);
    expect(config.prompt?.maxTokens).toBe(6000);
  });

  it("解析环境变量并支持显式覆盖", () => {
    const config = loadConfig({ orchestration: { maxSteps: 20, enablePlanning: false, enableReflection: true } }, {
      LLM_PROVIDER: "anthropic",
      LLM_MODEL: "claude-sonnet-4",
      ANTHROPIC_API_KEY: "test-key",
      PORT: "4100",
      SAFETY_APPROVAL: "false",
      SANDBOX_NETWORK_ENABLED: "true",
      MEMORY_DATA_DIR: "/tmp/agent-config-memory",
    });
    expect(config.llm).toMatchObject({ provider: "anthropic", model: "claude-sonnet-4", apiKey: "test-key" });
    expect(config.server).toMatchObject({ port: 4100, host: "0.0.0.0" });
    expect(config.orchestration.maxSteps).toBe(20);
    expect(config.orchestration.enablePlanning).toBe(false);
    expect(config.safety?.enableApproval).toBe(false);
    expect(config.sandbox?.networkEnabled).toBe(true);
    expect(config.memory?.dataDir).toBe("/tmp/agent-config-memory");
  });

  it("拒绝非法布尔和数字配置", () => {
    expect(() => loadConfig({}, { PORT: "not-a-number" })).toThrow("PORT");
    expect(() => loadConfig({}, { SAFETY_APPROVAL: "perhaps" })).toThrow("SAFETY_APPROVAL");
  });
});
