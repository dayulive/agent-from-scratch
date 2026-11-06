import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EpisodicStore } from "../../src/core/memory/episodic-store.js";
import { MemoryManager } from "../../src/core/memory/memory-manager.js";
import { DeterministicEmbeddingService } from "../../src/core/memory/semantic-store.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "agent-memory-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("MemoryManager", () => {
  it("重启后仍能检索语义和程序性记忆", async () => {
    const first = new MemoryManager(new DeterministicEmbeddingService(), { dataDir: tempDir });
    await first.initialize();
    await first.learn("[部署]→[端口冲突]→[先检查端口]", ["devops"], 0.9);
    await first.close();

    const second = new MemoryManager(new DeterministicEmbeddingService(), { dataDir: tempDir });
    await second.initialize();
    const memories = await second.retrieveRelevant("部署端口冲突", { limit: 3 });
    expect(memories.length).toBeGreaterThan(0);
    expect(memories[0].entry.content).toContain("先检查端口");
    expect(memories[0].relevance).toBeGreaterThan(0);
    await second.close();
  });

  it("持久化情景执行记录", async () => {
    const manager = new MemoryManager(new DeterministicEmbeddingService(), { dataDir: tempDir });
    await manager.initialize();
    await manager.recordEpisode({ task: "修复构建", success: true, steps: ["运行测试", "修复类型"], outcome: "构建通过" });
    await manager.close();

    const store = new EpisodicStore(tempDir);
    await store.initialize();
    expect(await store.list()).toHaveLength(1);
    expect((await store.list())[0].content).toContain("修复构建");
    await store.close();
  });

  it("应用最小相关度阈值", async () => {
    const manager = new MemoryManager(new DeterministicEmbeddingService(), { dataDir: tempDir });
    await manager.initialize();
    await manager.learn("部署前检查端口", ["devops"], 0.8);
    const memories = await manager.retrieveRelevant("完全无关的量子引力", { limit: 5, minRelevance: 0.99 });
    expect(memories).toEqual([]);
    await manager.close();
  });

  it("一次持久化失败不会毒化后续写入队列", async () => {
    const manager = new MemoryManager(new DeterministicEmbeddingService(), { dataDir: tempDir });
    await manager.initialize();
    const episodePath = path.join(tempDir, "episodes.jsonl");
    const semanticPath = path.join(tempDir, "agent_memory.json");
    await mkdir(episodePath);
    await mkdir(semanticPath);
    await expect(manager.recordEpisode({ task: "失败", steps: [], outcome: "失败", success: false })).rejects.toThrow();
    await expect(manager.learn("失败经验")).rejects.toThrow();

    await rm(episodePath, { recursive: true });
    await rm(semanticPath, { recursive: true });
    await expect(manager.recordEpisode({ task: "恢复", steps: [], outcome: "成功", success: true })).resolves.toMatchObject({ content: expect.stringContaining("恢复") });
    await expect(manager.learn("恢复经验")).resolves.toMatchObject({ content: "恢复经验" });
    expect(await manager.getRecentEpisodes()).toHaveLength(1);
    await manager.close();
  });
});
