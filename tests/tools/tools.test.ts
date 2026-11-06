import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTool } from "../../src/tools/create-tool.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { createFileTools, createSandboxedCommandTool } from "../../src/tools/shell-tools.js";
import type { SandboxSession } from "../../src/core/sandbox/types.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "agent-tools-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("createTool", () => {
  it("拒绝非法参数且不执行副作用", async () => {
    let called = false;
    const tool = createTool({
      name: "echo",
      description: "echo",
      schema: z.object({ value: z.string() }),
      execute: async ({ value }) => { called = true; return value; },
    });

    const result = JSON.parse(await tool.execute({ value: 42 } as never));
    expect(result.success).toBe(false);
    expect(result.error.isRetryable).toBe(true);
    expect(called).toBe(false);
  });

  it("返回执行结果并把异常转为不可重试错误", async () => {
    const echo = createTool({
      name: "echo", description: "echo", schema: z.object({ value: z.string() }),
      execute: async ({ value }) => value,
    });
    const failing = createTool({
      name: "fail", description: "fail", schema: z.object({}),
      execute: async () => { throw new Error("boom"); },
    });

    expect(JSON.parse(await echo.execute({ value: "ok" }))).toEqual({ success: true, output: "ok" });
    expect(JSON.parse(await failing.execute({}))).toMatchObject({ success: false, error: { error: "boom", isRetryable: false } });
  });
});

describe("ToolRegistry", () => {
  it("列出工具 Schema 并拒绝重复注册", () => {
    const registry = new ToolRegistry();
    const tool = createTool({ name: "echo", description: "回声", schema: z.object({ value: z.string() }), execute: async ({ value }) => value });
    registry.register(tool);

    expect(registry.getToolNames()).toEqual(["echo"]);
    expect(registry.getToolSchemas()[0]).toMatchObject({ name: "echo", description: "回声" });
    expect(registry.getToolSchemas()[0].parameters).toMatchObject({ type: "object" });
    expect(() => registry.register(tool)).toThrow("已注册");
    expect(registry.unregister("echo")).toBe(true);
    expect(registry.size).toBe(0);
  });
});

describe("文件工具", () => {
  it("写入、读取并保护已有文件", async () => {
    const { readFileTool, writeFileTool } = createFileTools({ workDir: tempDir });
    const filePath = path.join(tempDir, "nested", "note.txt");
    const created = JSON.parse(await writeFileTool.execute({ path: filePath, content: "first\nsecond", overwrite: false }));
    expect(created.success).toBe(true);
    expect(await readFile(filePath, "utf8")).toBe("first\nsecond");

    const rejected = JSON.parse(await writeFileTool.execute({ path: filePath, content: "changed", overwrite: false }));
    expect(rejected.output).toContain("已存在");
    expect(await readFile(filePath, "utf8")).toBe("first\nsecond");

    const read = JSON.parse(await readFileTool.execute({ path: filePath, maxLines: 1 }));
    expect(read.output).toContain("显示前 1 行");
    expect(read.output).toContain("first");
    expect(read.output).not.toContain("second");
  });

  it("按通配符列出目录并处理不存在的路径", async () => {
    const { readFileTool, listDirectoryTool } = createFileTools({ workDir: tempDir });
    await writeFile(path.join(tempDir, "a.log"), "a");
    await writeFile(path.join(tempDir, "b.txt"), "b");
    const listed = JSON.parse(await listDirectoryTool.execute({ path: tempDir, pattern: "*.log", showHidden: false }));
    const output = JSON.parse(listed.output);
    expect(output.entries.map((entry: any) => entry.name)).toEqual(["a.log"]);

    const missing = JSON.parse(await readFileTool.execute({ path: path.join(tempDir, "missing"), maxLines: 10 }));
    expect(missing.output).toContain("文件不存在");
  });
});

describe("execute_command", () => {
  it("始终通过沙箱会话执行", async () => {
    const session: SandboxSession = {
      id: "fake", backend: "fake", destroy: async () => undefined,
      execute: async (command, timeout) => ({ exitCode: 0, stdout: `${command}:${timeout}`, stderr: "", timedOut: false, duration: 1 }),
    };
    const tool = createSandboxedCommandTool(() => session, { defaultTimeout: 12 });
    const result = JSON.parse(await tool.execute({ command: "pwd", timeout: 12 }));
    expect(result.output).toContain("pwd:12");
  });

  it("无会话时不直接执行宿主机命令", async () => {
    const tool = createSandboxedCommandTool(() => null);
    const result = JSON.parse(await tool.execute({ command: "printf unsafe", timeout: 1 }));
    expect(result.success).toBe(false);
    expect(result.error.error).toContain("沙箱");
  });

  it("工具边界直接阻断危险命令，MCP 和教学循环无法绕过", async () => {
    let executed = false;
    const session: SandboxSession = {
      id: "fake", backend: "fake", destroy: async () => undefined,
      execute: async () => { executed = true; return { exitCode: 0, stdout: "", stderr: "", timedOut: false, duration: 0 }; },
    };
    const tool = createSandboxedCommandTool(() => session);
    for (const command of ["rm -rf /", "sudo cat /etc/hosts", "npm install"]) {
      const result = JSON.parse(await tool.execute({ command, timeout: 1 }));
      expect(result.success).toBe(false);
    }
    expect(executed).toBe(false);
  });
});
