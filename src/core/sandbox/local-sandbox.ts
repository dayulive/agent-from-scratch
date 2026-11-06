import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { SandboxBackend, SandboxSession, SandboxResult, SessionOptions } from "./types.js";

const execFileAsync = promisify(execFile);

export class LocalSandbox implements SandboxBackend {
  readonly name = "local";

  async isAvailable(): Promise<boolean> {
    return process.platform !== "win32";
  }

  async createSession(options?: SessionOptions): Promise<SandboxSession> {
    const sessionId = `local-${randomUUID().slice(0, 8)}`;
    console.warn(`[LocalSandbox] 无隔离执行：${sessionId}`);

    return {
      id: sessionId,
      backend: "local",
      async execute(command: string, timeout = 30, signal?: AbortSignal): Promise<SandboxResult> {
        const start = Date.now();
        try {
          const { stdout, stderr } = await execFileAsync("/bin/sh", ["-lc", command], {
            timeout: timeout * 1000,
            cwd: options?.workDir,
            env: { ...process.env, ...options?.env },
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
      },
      async destroy() {},
    };
  }
}
