import type { SandboxBackend, SandboxSession, SandboxConfig, SessionOptions } from "./types.js";

export class SandboxFactory {
  private readonly backends: SandboxBackend[] = [];
  private readonly defaultConfig: Required<Omit<SandboxConfig, "allowedMounts">> & { allowedMounts: Record<string, string> };

  constructor(config: SandboxConfig = {}) {
    this.defaultConfig = {
      defaultTimeout: config.defaultTimeout ?? 30,
      memoryLimit: config.memoryLimit ?? "256m",
      cpuQuota: config.cpuQuota ?? 1,
      networkEnabled: config.networkEnabled ?? false,
      allowedMounts: config.allowedMounts ?? {},
      workDir: config.workDir ?? process.cwd(),
      allowLocal: config.allowLocal ?? true,
      preferredBackend: config.preferredBackend ?? "auto",
    };
  }

  registerBackend(backend: SandboxBackend): void {
    this.backends.push(backend);
  }

  getBackends(): ReadonlyArray<SandboxBackend> {
    return this.backends;
  }

  async createSession(options?: SessionOptions): Promise<SandboxSession> {
    const ordered = this.orderedBackends();
    for (const backend of ordered) {
      if (backend.name === "local" && !this.defaultConfig.allowLocal) continue;
      try {
        if (await backend.isAvailable()) {
          return await backend.createSession({ workDir: this.defaultConfig.workDir, ...options });
        }
      } catch (error) {
        console.warn(`[SandboxFactory] ${backend.name} 创建失败：`, error);
      }
    }
    throw new Error("没有可用的沙箱后端");
  }

  async analyze(): Promise<Array<{ name: string; available: boolean; reason?: string }>> {
    const results = [];
    for (const backend of this.backends) {
      if (backend.name === "local" && !this.defaultConfig.allowLocal) {
        results.push({ name: backend.name, available: false, reason: "本地后端已禁用" });
        continue;
      }
      try {
        results.push({ name: backend.name, available: await backend.isAvailable() });
      } catch (error) {
        results.push({ name: backend.name, available: false, reason: String(error) });
      }
    }
    return results;
  }

  private orderedBackends(): SandboxBackend[] {
    if (this.defaultConfig.preferredBackend === "auto") return this.backends;
    return [...this.backends].sort((a, b) => {
      if (a.name === this.defaultConfig.preferredBackend) return -1;
      if (b.name === this.defaultConfig.preferredBackend) return 1;
      return 0;
    });
  }
}
