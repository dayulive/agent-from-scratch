import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { SandboxBackend, SandboxConfig, SandboxResult, SandboxSession, SessionOptions } from "./types.js";

const execFileAsync = promisify(execFile);

export class NSJAILSandbox implements SandboxBackend {
  readonly name = "nsjail";
  private readonly binaryPath: string;

  constructor(private readonly config: SandboxConfig & { binaryPath?: string } = {}) {
    this.binaryPath = config.binaryPath || process.env.NSJAIL_PATH || "/usr/bin/nsjail";
  }

  async isAvailable(): Promise<boolean> {
    if (process.platform !== "linux") return false;
    try {
      await access(this.binaryPath);
      return true;
    } catch {
      return false;
    }
  }

  async createSession(options?: SessionOptions): Promise<SandboxSession> {
    if (!await this.isAvailable()) throw new Error("NSJAIL 不可用");
    const id = `nsjail-${randomUUID().slice(0, 8)}`;
    return {
      id,
      backend: this.name,
      execute: async (command, timeout = this.config.defaultTimeout ?? 30, signal?: AbortSignal) => {
        const memoryMb = parseMemoryMb(this.config.memoryLimit);
        const args = [
          "-Mo", "--chroot", "/", "--user", "65534", "--group", "65534",
          "--rlimit_as", String(memoryMb), "--time_limit", String(Math.ceil(timeout)),
          "--disable_proc", "--cwd", options?.workDir ?? this.config.workDir ?? "/workspace",
          this.config.networkEnabled ? "--disable_clone_newnet" : "--clone_newnet",
          "--", "/bin/sh", "-lc", command,
        ];
        return runProcess(this.binaryPath, args, timeout, options, signal);
      },
      destroy: async () => undefined,
    };
  }
}

async function runProcess(binary: string, args: string[], timeout: number, options?: SessionOptions, signal?: AbortSignal): Promise<SandboxResult> {
  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      timeout: (timeout + 1) * 1000,
      cwd: options?.workDir,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...options?.env },
      maxBuffer: 10 * 1024 * 1024,
      killSignal: "SIGKILL",
      signal,
    });
    return { exitCode: 0, stdout, stderr, timedOut: false, duration: Date.now() - start };
  } catch (error: any) {
    return {
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message ?? "",
      timedOut: Boolean(error.killed || error.signal === "SIGKILL" || error.code === "ETIMEDOUT"),
      duration: Date.now() - start,
    };
  }
}

function parseMemoryMb(value?: string): number {
  const match = /^(\d+)([mg])?$/i.exec(value ?? "256m");
  if (!match) return 256;
  return match[2]?.toLowerCase() === "g" ? Number(match[1]) * 1024 : Number(match[1]);
}
