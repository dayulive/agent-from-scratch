import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { LocalSandbox } from "../../src/core/sandbox/local-sandbox.js";
import { SandboxFactory } from "../../src/core/sandbox/sandbox-factory.js";
import { DockerSandbox } from "../../src/core/sandbox/docker-sandbox.js";
import { NSJAILSandbox } from "../../src/core/sandbox/nsjail-sandbox.js";
import { SeccompSandbox } from "../../src/core/sandbox/seccomp-sandbox.js";
import type { SandboxBackend } from "../../src/core/sandbox/types.js";

describe("隔离后端可用性", () => {
  it("缺少二进制时明确报告不可用", async () => {
    expect(await new NSJAILSandbox({ binaryPath: "/definitely/missing/nsjail" }).isAvailable()).toBe(false);
    expect(await new SeccompSandbox({ binaryPath: "/definitely/missing/firejail" }).isAvailable()).toBe(false);
  });

  it("Docker 守护进程不可用时返回 false", async () => {
    const docker = { ping: async () => { throw new Error("offline"); } };
    expect(await new DockerSandbox({ docker: docker as never }).isAvailable()).toBe(false);
  });

  it("每次 Docker 命令独立隔离，取消不影响并发和后续执行", async () => {
    const containers: any[] = [];
    const createContainer = async () => {
      const stream = Object.assign(new EventEmitter(), { destroy: vi.fn() });
      const container: any = {
        id: `container-${containers.length}`,
        stream,
        running: false,
        execStarted: false,
        start: vi.fn(async () => { container.running = true; }),
        exec: vi.fn(async () => {
          if (!container.running) throw new Error("container is not running");
          return { start: async () => { container.execStarted = true; return stream; }, inspect: async () => ({ ExitCode: 0 }) };
        }),
        stop: vi.fn(async () => { container.running = false; stream.emit("end"); }),
        remove: vi.fn(async () => { container.running = false; }),
        modem: { demuxStream: vi.fn() },
      };
      containers.push(container);
      return container;
    };
    const docker = {
      ping: async () => undefined,
      getImage: () => ({ inspect: async () => ({}) }),
      createContainer,
    };
    const session = await new DockerSandbox({ docker: docker as never }).createSession();
    const firstController = new AbortController();
    const first = session.execute("first", 1, firstController.signal);
    await vi.waitFor(() => expect(containers[0]?.execStarted).toBe(true));
    const second = session.execute("second", 1);
    await vi.waitFor(() => expect(containers[1]?.execStarted).toBe(true));

    firstController.abort();
    expect((await first).exitCode).toBe(130);
    expect(containers[0].running).toBe(false);
    expect(containers[1].running).toBe(true);
    containers[1].stream.emit("end");
    expect((await second).exitCode).toBe(0);

    const third = session.execute("third", 1);
    await vi.waitFor(() => expect(containers[2]?.execStarted).toBe(true));
    containers[2].stream.emit("end");
    expect((await third).exitCode).toBe(0);
    await session.destroy();
  });
});

describe("LocalSandbox", () => {
  it("返回标准输出、非零退出码和耗时", async () => {
    const backend = new LocalSandbox();
    const session = await backend.createSession();

    const success = await session.execute("printf hello");
    expect(success).toMatchObject({ exitCode: 0, stdout: "hello", timedOut: false });
    expect(success.duration).toBeGreaterThanOrEqual(0);

    const failure = await session.execute("printf problem >&2; exit 7");
    expect(failure.exitCode).toBe(7);
    expect(failure.stderr).toContain("problem");
    await session.destroy();
  });

  it("终止超时命令", async () => {
    const session = await new LocalSandbox().createSession();
    const result = await session.execute("sleep 1", 0.02);
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });
});

describe("SandboxFactory", () => {
  it("跳过不可用后端并降级", async () => {
    const unavailable: SandboxBackend = {
      name: "unavailable",
      isAvailable: async () => false,
      createSession: async () => { throw new Error("不应调用"); },
    };
    const factory = new SandboxFactory();
    factory.registerBackend(unavailable);
    factory.registerBackend(new LocalSandbox());

    const session = await factory.createSession();
    expect(session.backend).toBe("local");
    expect(await factory.analyze()).toEqual([
      { name: "unavailable", available: false },
      { name: "local", available: true },
    ]);
  });

  it("禁用本地降级且其他后端不可用时给出明确错误", async () => {
    const factory = new SandboxFactory({ allowLocal: false });
    factory.registerBackend(new LocalSandbox());
    await expect(factory.createSession()).rejects.toThrow("没有可用的沙箱后端");
  });

  it("隔离后端检查异常", async () => {
    const factory = new SandboxFactory();
    factory.registerBackend({
      name: "broken",
      isAvailable: async () => { throw new Error("missing daemon"); },
      createSession: vi.fn(),
    });
    expect(await factory.analyze()).toEqual([{ name: "broken", available: false, reason: "Error: missing daemon" }]);
  });
});
