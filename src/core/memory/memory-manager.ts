import { randomUUID } from "node:crypto";
import { EpisodicStore } from "./episodic-store.js";
import { SemanticStore } from "./semantic-store.js";
import type {
  EmbeddingService,
  EpisodeInput,
  MemoryConfig,
  MemoryEntry,
  MemoryRetrievalOptions,
  MemoryType,
  RetrievedMemory,
} from "./types.js";

export class MemoryManager {
  private readonly dataDir: string;
  private readonly episodicStore: EpisodicStore;
  private readonly semanticStore: SemanticStore;

  constructor(embeddingService: EmbeddingService, config: MemoryConfig = {}) {
    this.dataDir = config.dataDir ?? "./memory-data";
    this.episodicStore = new EpisodicStore(this.dataDir);
    this.semanticStore = new SemanticStore(embeddingService, {
      dataDir: this.dataDir,
      collectionName: config.semanticCollectionName,
      backend: config.semanticBackend,
      chromaUrl: config.chromaUrl,
    });
  }

  async initialize(): Promise<void> {
    await this.episodicStore.initialize();
    await this.semanticStore.initialize();
  }

  async recordEpisode(input: EpisodeInput): Promise<MemoryEntry> {
    const entry = this.createEntry("episodic", `任务：${input.task}\n结果：${input.outcome}\n步骤：${input.steps.join(" → ")}`, [], input.success ? 0.6 : 0.8, {
      ...input.metadata,
      task: input.task,
      steps: input.steps,
      outcome: input.outcome,
      success: input.success,
    });
    await this.episodicStore.append(entry);
    await this.semanticStore.add(entry);
    return entry;
  }

  async learn(content: string, tags: string[] = [], importance = 0.8): Promise<MemoryEntry> {
    const entry = this.createEntry("procedural", content, tags, importance);
    await this.semanticStore.add(entry);
    return entry;
  }

  async remember(content: string, options: { type?: MemoryType; tags?: string[]; importance?: number; metadata?: Record<string, unknown> } = {}): Promise<MemoryEntry> {
    const entry = this.createEntry(options.type ?? "semantic", content, options.tags ?? [], options.importance ?? 0.5, options.metadata);
    if (entry.type === "episodic") await this.episodicStore.append(entry);
    await this.semanticStore.add(entry);
    return entry;
  }

  async retrieveRelevant(query: string, options: MemoryRetrievalOptions = {}): Promise<RetrievedMemory[]> {
    return this.semanticStore.search(query, options);
  }

  async getRecentEpisodes(limit = 10): Promise<MemoryEntry[]> {
    return this.episodicStore.list(limit);
  }

  async close(): Promise<void> {
    await Promise.all([this.episodicStore.close(), this.semanticStore.close()]);
  }

  private createEntry(type: MemoryType, content: string, tags: string[], importance: number, metadata?: Record<string, unknown>): MemoryEntry {
    return { id: randomUUID(), type, content, tags, importance, createdAt: new Date(), metadata };
  }
}
