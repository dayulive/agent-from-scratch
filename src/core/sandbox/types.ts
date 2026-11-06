export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  duration: number;
}

export interface SandboxSession {
  id: string;
  backend: string;
  execute(command: string, timeout?: number, signal?: AbortSignal): Promise<SandboxResult>;
  destroy(): Promise<void>;
}

export interface SandboxBackend {
  name: string;
  isAvailable(): Promise<boolean>;
  createSession(options?: SessionOptions): Promise<SandboxSession>;
}

export interface SessionOptions {
  workDir?: string;
  env?: Record<string, string>;
}

export interface SandboxConfig {
  defaultTimeout?: number;
  memoryLimit?: string;
  cpuQuota?: number;
  networkEnabled?: boolean;
  allowedMounts?: Record<string, string>;
  workDir?: string;
  allowLocal?: boolean;
  preferredBackend?: "auto" | "local" | "docker" | "nsjail" | "seccomp";
}
