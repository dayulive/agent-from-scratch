import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { createTool } from "./create-tool.js";
import type { ToolInstance } from "./types.js";
import type { SandboxSession } from "../core/sandbox/types.js";
import type { SafetySystem } from "../core/safety/safety-system.js";
import { CommandAnalyzer, SecurityLevel } from "../core/safety/command-analyzer.js";

export interface CommandToolConfig {
  defaultTimeout?: number;
  safetySystem?: SafetySystem;
}

export function createSandboxedCommandTool(getSession: () => SandboxSession | null, config: CommandToolConfig = {}) {
  const fallbackAnalyzer = new CommandAnalyzer();
  return createTool({
    name: "execute_command",
    description: "在沙箱中执行 Shell 命令。命令经过统一安全分析和审批；无会话时不会执行。",
    schema: z.object({
      command: z.string().min(1).describe("要执行的 Shell 命令"),
      timeout: z.number().positive().max(300).default(config.defaultTimeout ?? 30).describe("超时时间（秒）"),
    }),
    async execute({ command, timeout }, context) {
      if (config.safetySystem) {
        const approval = await config.safetySystem.requestApprovalIfNeeded([command], "工具请求执行命令", { signal: context?.signal });
        if (approval.needsApproval && !approval.approved) throw new Error(approval.blocked ? "命令被安全策略阻断" : "命令未获用户批准");
      } else {
        const analysis = fallbackAnalyzer.analyze(command);
        if (analysis.level === SecurityLevel.BLOCKED) throw new Error("命令被安全策略阻断");
        if (analysis.requiresApproval) throw new Error("未配置审批系统，命令需要审批，已拒绝执行");
      }
      const session = getSession();
      if (!session) throw new Error("沙箱会话不可用，命令未执行");
      const result = await session.execute(command, timeout, context?.signal);
      const parts = [`[命令] ${command}`, `[退出码] ${result.exitCode}`, `[耗时] ${result.duration}ms`];
      if (result.timedOut) parts.push("[状态] 超时");
      if (result.stdout.trim()) parts.push(result.stdout.slice(0, 8000));
      if (result.stderr.trim()) parts.push(`[stderr]\n${result.stderr.slice(0, 2000)}`);
      return parts.join("\n");
    },
  });
}

export interface FileToolsConfig {
  workDir?: string;
  safetySystem?: SafetySystem;
  maxReadBytes?: number;
  maxWriteBytes?: number;
  maxDirectoryEntries?: number;
}

export function createFileTools(config: FileToolsConfig = {}) {
  const root = path.resolve(config.workDir ?? process.cwd());
  const maxWriteBytes = config.maxWriteBytes ?? 1_000_000;

  const readFileTool = createTool({
    name: "read_file",
    description: "读取允许根目录内的文件，限制返回行数和字节数。",
    schema: z.object({
      path: z.string().min(1).describe("文件路径"),
      maxLines: z.number().int().min(1).max(5000).default(1000).describe("最大返回行数"),
      maxBytes: z.number().int().min(1).max(10_000_000).default(config.maxReadBytes ?? 200_000).describe("最大读取字节数"),
    }),
    async execute({ path: requestedPath, maxLines, maxBytes }) {
      try {
        const filePath = await resolveWithinRoot(root, requestedPath);
        const stats = await fs.stat(filePath);
        if (!stats.isFile()) return `[错误] 不是普通文件：${requestedPath}`;
        if (stats.size > maxBytes) throw new Error(`文件超过读取限制（${maxBytes} 字节）`);
        const content = await fs.readFile(filePath, "utf8");
        if (Buffer.byteLength(content) > maxBytes) throw new Error(`文件超过读取限制（${maxBytes} 字节）`);
        const lines = content.split("\n");
        if (lines.length <= maxLines) return `[文件] ${filePath}\n[行数] ${lines.length}\n\n${content}`;
        return [
          `[文件] ${filePath}`,
          `[行数] ${lines.length}（显示前 ${maxLines} 行）`,
          "",
          lines.slice(0, maxLines).join("\n"),
        ].join("\n");
      } catch (error: any) {
        if (error.code === "ENOENT") return `[错误] 文件不存在：${requestedPath}`;
        if (error.code === "EISDIR") return `[错误] 路径是目录：${requestedPath}`;
        throw error;
      }
    },
  });

  const writeFileTool = createTool({
    name: "write_file",
    description: "将内容写入允许根目录内的文件。默认不覆盖，写入前复用安全审批。",
    schema: z.object({
      path: z.string().min(1).describe("文件路径"),
      content: z.string().max(maxWriteBytes).describe("文件内容"),
      overwrite: z.boolean().default(false).describe("是否覆盖已有文件"),
    }),
    async execute({ path: requestedPath, content, overwrite }, context) {
      const filePath = await resolveWithinRoot(root, requestedPath);
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      if (exists && !overwrite) return `[错误] 文件 ${filePath} 已存在。如需覆盖，设置 overwrite: true`;
      if (Buffer.byteLength(content) > maxWriteBytes) throw new Error(`内容超过写入限制（${maxWriteBytes} 字节）`);
      if (config.safetySystem) {
        const approval = await config.safetySystem.requestApprovalIfNeeded(["write_file"], `写入文件：${filePath}`, { signal: context?.signal });
        if (approval.needsApproval && !approval.approved) throw new Error("文件写入未获用户批准");
      }
      if (context?.signal?.aborted) throw new Error("文件写入已取消");
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, { encoding: "utf8", flag: overwrite ? "w" : "wx" });
      const stats = await fs.stat(filePath);
      return `[文件] ${filePath}\n[大小] ${stats.size} 字节\n[状态] ${exists ? "已覆盖" : "已创建"}`;
    },
  });

  const listDirectoryTool = createTool({
    name: "list_directory",
    description: "列出允许根目录内的目录内容，支持过滤和条目上限。",
    schema: z.object({
      path: z.string().default(".").describe("目录路径"),
      pattern: z.string().optional().describe("文件名过滤模式（如 *.log）"),
      showHidden: z.boolean().default(false).describe("是否显示隐藏文件"),
      maxEntries: z.number().int().min(1).max(10_000).default(config.maxDirectoryEntries ?? 500).describe("最大返回条目数"),
    }),
    async execute({ path: requestedPath, pattern, showHidden, maxEntries }) {
      try {
        const directory = await resolveWithinRoot(root, requestedPath);
        const entries = await fs.readdir(directory, { withFileTypes: true });
        let filtered = showHidden ? entries : entries.filter(entry => !entry.name.startsWith("."));
        if (pattern) {
          const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
          const regex = new RegExp(`^${escaped}$`);
          filtered = filtered.filter(entry => regex.test(entry.name));
        }
        const sorted = [...filtered].sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        const limited = sorted.slice(0, maxEntries);
        return JSON.stringify({
          path: directory,
          total: sorted.length,
          shown: limited.length,
          entries: limited.map(entry => ({ name: entry.isDirectory() ? `${entry.name}/` : entry.name, directory: entry.isDirectory() })),
        });
      } catch (error: any) {
        if (error.code === "ENOENT") return `[错误] 目录不存在：${requestedPath}`;
        if (error.code === "ENOTDIR") return `[错误] 路径不是目录：${requestedPath}`;
        throw error;
      }
    },
  });
  return { readFileTool, writeFileTool, listDirectoryTool };
}

async function resolveWithinRoot(root: string, requestedPath: string): Promise<string> {
  await fs.mkdir(root, { recursive: true });
  const canonicalRoot = await fs.realpath(root);
  const candidate = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(canonicalRoot, requestedPath);
  if (!path.isAbsolute(requestedPath)) assertInsideRoot(canonicalRoot, candidate);

  let existing = candidate;
  while (!await fs.access(existing).then(() => true).catch(() => false)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const canonicalExisting = await fs.realpath(existing);
  assertInsideRoot(canonicalRoot, canonicalExisting);
  const resolved = path.resolve(canonicalExisting, path.relative(existing, candidate));
  assertInsideRoot(canonicalRoot, resolved);
  return resolved;
}

function assertInsideRoot(root: string, candidate: string): void {
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error(`路径超出允许根目录：${candidate}`);
  }
}

const defaultTools = createFileTools();
export const readFileTool = defaultTools.readFileTool;
export const writeFileTool = defaultTools.writeFileTool;
export const listDirectoryTool = defaultTools.listDirectoryTool;
export const defaultShellTools: ToolInstance[] = [readFileTool, writeFileTool, listDirectoryTool];
