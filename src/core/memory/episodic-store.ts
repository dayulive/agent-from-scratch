import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { MemoryEntry } from "./types.js";

export class EpisodicStore {
  private readonly filePath: string;
  private entries: MemoryEntry[] = [];
  private initialized = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir: string) {
    this.filePath = path.join(dataDir, "episodes.jsonl");
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.dataDir, { recursive: true });
    try {
      const content = await readFile(this.filePath, "utf8");
      this.entries = content.split("\n").filter(Boolean).map(line => this.deserialize(line));
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
      this.entries = [];
    }
    this.initialized = true;
  }

  async append(entry: MemoryEntry): Promise<void> {
    await this.initialize();
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      this.entries.push(entry);
      try {
        await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
      } catch (error) {
        this.entries = this.entries.filter(item => item.id !== entry.id);
        throw error;
      }
    });
    await this.writeQueue;
  }

  async list(limit?: number): Promise<MemoryEntry[]> {
    await this.initialize();
    await this.writeQueue.catch(() => undefined);
    const sorted = [...this.entries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return limit === undefined ? sorted : sorted.slice(0, limit);
  }

  async close(): Promise<void> {
    await this.writeQueue.catch(() => undefined);
    this.initialized = false;
  }

  private deserialize(line: string): MemoryEntry {
    const entry = JSON.parse(line) as MemoryEntry;
    return { ...entry, createdAt: new Date(entry.createdAt) };
  }
}
