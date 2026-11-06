import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import Docker, { type Container } from "dockerode";
import type { SandboxBackend, SandboxConfig, SandboxResult, SandboxSession, SessionOptions } from "./types.js";

export interface DockerSandboxOptions extends SandboxConfig {
  docker?: Docker;
  image?: string;
}

export class DockerSandbox implements SandboxBackend {
  readonly name = "docker";
  private readonly docker: Docker;
  private readonly image: string;

  constructor(private readonly config: DockerSandboxOptions = {}) {
    this.docker = config.docker ?? new Docker();
    this.image = config.image ?? "alpine:3.20";
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  async createSession(options?: SessionOptions): Promise<SandboxSession> {
    if (!await this.isAvailable()) throw new Error("Docker 守护进程不可用");
    await this.ensureImage();
    const workDir = options?.workDir ?? this.config.workDir ?? "/workspace";
    const activeContainers = new Set<Container>();
    let destroyed = false;

    const createExecutionContainer = async (): Promise<Container> => {
      const container = await this.docker.createContainer({
        Image: this.image,
        Cmd: ["sh"],
        Tty: true,
        OpenStdin: true,
        WorkingDir: workDir,
        Env: Object.entries(options?.env ?? {}).map(([key, value]) => `${key}=${value}`),
        Labels: { "agent-from-scratch.session": randomUUID() },
        HostConfig: {
          Memory: parseMemoryBytes(this.config.memoryLimit),
          NanoCpus: Math.round((this.config.cpuQuota ?? 1) * 1_000_000_000),
          NetworkMode: this.config.networkEnabled ? "bridge" : "none",
          Mounts: Object.entries(this.config.allowedMounts ?? {}).map(([host, target]) => ({
            Source: host, Target: target, Type: "bind" as const, ReadOnly: false,
          })),
          AutoRemove: false,
        },
      });
      activeContainers.add(container);
      try {
        await container.start();
        return container;
      } catch (error) {
        activeContainers.delete(container);
        await container.remove({ force: true }).catch(() => undefined);
        throw error;
      }
    };

    return {
      id: `docker-${randomUUID()}`,
      backend: this.name,
      execute: async (command, timeout = this.config.defaultTimeout ?? 30, signal?: AbortSignal): Promise<SandboxResult> => {
        if (destroyed) throw new Error("沙箱会话已销毁");
        if (signal?.aborted) return { exitCode: 130, stdout: "", stderr: "执行已取消", timedOut: false, duration: 0 };
        const container = await createExecutionContainer();
        try {
          return await this.executeInContainer(container, command, timeout, signal);
        } finally {
          activeContainers.delete(container);
          await container.remove({ force: true }).catch(() => undefined);
        }
      },
      destroy: async () => {
        if (destroyed) return;
        destroyed = true;
        await Promise.allSettled([...activeContainers].map(container => container.remove({ force: true })));
        activeContainers.clear();
      },
    };
  }

  private async executeInContainer(container: Container, command: string, timeout: number, signal?: AbortSignal): Promise<SandboxResult> {
    const start = Date.now();
    if (signal?.aborted) return { exitCode: 130, stdout: "", stderr: "执行已取消", timedOut: false, duration: 0 };
    let aborted = false;
    let timedOut = false;
    let stream: any;
    const onAbort = () => {
      aborted = true;
      void container.stop({ t: 0 }).catch(() => undefined);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      void container.stop({ t: 0 }).catch(() => undefined);
    }, timeout * 1000);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    try {
      const exec = await container.exec({ Cmd: ["sh", "-lc", command], AttachStdout: true, AttachStderr: true });
      stream = await exec.start({ hijack: true, stdin: false });
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      stdout.on("data", chunk => stdoutChunks.push(Buffer.from(chunk)));
      stderr.on("data", chunk => stderrChunks.push(Buffer.from(chunk)));
      container.modem.demuxStream(stream, stdout, stderr);
      const completed = new Promise<void>((resolve, reject) => {
        stream.once("end", resolve);
        stream.once("error", reject);
      });
      await completed;
      const inspection = await exec.inspect();
      return {
        exitCode: aborted ? 130 : timedOut ? 124 : inspection.ExitCode ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: aborted ? "执行已取消" : Buffer.concat(stderrChunks).toString("utf8"),
        timedOut,
        duration: Date.now() - start,
      };
    } catch (error) {
      if (aborted) {
        return { exitCode: 130, stdout: "", stderr: "执行已取消", timedOut: false, duration: Date.now() - start };
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      stream?.destroy();
    }
  }

  private async ensureImage(): Promise<void> {
    try {
      await this.docker.getImage(this.image).inspect();
      return;
    } catch {
      const stream = await this.docker.pull(this.image);
      await new Promise<void>((resolve, reject) => {
        this.docker.modem.followProgress(stream, error => error ? reject(error) : resolve());
      });
    }
  }
}

function parseMemoryBytes(value?: string): number {
  const match = /^(\d+)([kmg])?$/i.exec(value ?? "256m");
  if (!match) return 256 * 1024 * 1024;
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  if (unit === "g") return amount * 1024 ** 3;
  if (unit === "k") return amount * 1024;
  return amount * 1024 ** 2;
}
