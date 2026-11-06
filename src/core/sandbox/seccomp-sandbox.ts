import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import type { SandboxBackend, SandboxConfig, SandboxResult, SandboxSession, SessionOptions } from "./types.js";

const execFileAsync = promisify(execFile);

export class SeccompSandbox implements SandboxBackend {
  readonly name = "seccomp";
  private readonly binaryPath: string;

  constructor(private readonly config: SandboxConfig & { binaryPath?: string } = {}) {
    this.binaryPath = config.binaryPath || process.env.FIREJAIL_PATH || "/usr/bin/firejail";
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
    if (!await this.isAvailable()) throw new Error("Firejail/Seccomp 不可用");
    return {
      id: `seccomp-${randomUUID().slice(0, 8)}`,
      backend: this.name,
      execute: async (command, timeout = this.config.defaultTimeout ?? 30, signal?: AbortSignal) => {
        const args = ["--quiet", "--noroot", "--seccomp", "--private-tmp", "--nogroups", "--nonewprivs"];
        if (!this.config.networkEnabled) args.push("--net=none");
        args.push("/bin/sh", "-lc", command);
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
      timeout: timeout * 1000,
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
