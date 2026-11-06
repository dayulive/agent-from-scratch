import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SafetySystem } from "../../src/core/safety/safety-system.js";
import { createFileTools } from "../../src/tools/shell-tools.js";

let root: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "agent-file-root-"));
  outside = await mkdtemp(path.join(tmpdir(), "agent-file-outside-"));
});

afterEach(async () => {
  await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
});

describe("文件工具安全边界", () => {
  it("允许根目录内写入并拒绝相对路径和绝对路径逃逸", async () => {
    const { writeFileTool } = createFileTools({ workDir: root });
    expect(JSON.parse(await writeFileTool.execute({ path: "nested/ok.txt", content: "ok", overwrite: false })).success).toBe(true);
    expect(await readFile(path.join(root, "nested", "ok.txt"), "utf8")).toBe("ok");

    for (const target of [path.join(root, "..", "escape.txt"), path.join(outside, "absolute.txt")]) {
      const result = JSON.parse(await writeFileTool.execute({ path: target, content: "bad", overwrite: true }));
      expect(result.success).toBe(false);
      expect(result.error.error).toContain("根目录");
    }
  });

  it("拒绝通过符号链接读取根目录外文件", async () => {
    const secretPath = path.join(outside, "secret.txt");
    await writeFile(secretPath, "outside-secret");
    await symlink(secretPath, path.join(root, "linked.txt"));
    const { readFileTool } = createFileTools({ workDir: root });
    const result = JSON.parse(await readFileTool.execute({ path: "linked.txt", maxLines: 10, maxBytes: 1000 }));
    expect(result.success).toBe(false);
    expect(result.error.error).toContain("根目录");
  });

  it("写入操作复用审批门，拒绝时不创建文件", async () => {
    const safety = new SafetySystem();
    safety.approvalGate.setRequestListener(request => {
      setTimeout(() => safety.approvalGate.reject(request.id), 0);
    });
    const { writeFileTool } = createFileTools({ workDir: root, safetySystem: safety });
    const result = JSON.parse(await writeFileTool.execute({ path: "approval.txt", content: "blocked", overwrite: false }));
    expect(result.success).toBe(false);
    await expect(readFile(path.join(root, "approval.txt"), "utf8")).rejects.toThrow();
  });

  it("限制读取字节和目录条目数量", async () => {
    await writeFile(path.join(root, "large.txt"), "x".repeat(200));
    await writeFile(path.join(root, "a.txt"), "a");
    await writeFile(path.join(root, "b.txt"), "b");
    const { readFileTool, listDirectoryTool } = createFileTools({ workDir: root });
    const read = JSON.parse(await readFileTool.execute({ path: "large.txt", maxLines: 10, maxBytes: 100 }));
    expect(read.success).toBe(false);
    const listed = JSON.parse(await listDirectoryTool.execute({ path: ".", showHidden: false, maxEntries: 2 }));
    expect(JSON.parse(listed.output).entries).toHaveLength(2);
  });
});
