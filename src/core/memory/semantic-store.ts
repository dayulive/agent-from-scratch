import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EmbeddingService, MemoryEntry, MemoryRetrievalOptions, RetrievedMemory } from "./types.js";

interface StoredVector {
  entry: MemoryEntry;
  embedding: number[];
}

interface SemanticStoreConfig {
  dataDir: string;
  collectionName?: string;
  backend?: "file" | "chromadb";
  chromaUrl?: string;
}

export class OpenAIEmbeddingService implements EmbeddingService {
  constructor(
    private readonly apiKey: string,
    private readonly model = "text-embedding-3-small",
    private readonly baseUrl = "https://api.openai.com/v1",
  ) {}

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: text }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`OpenAI Embedding 请求失败（${response.status}）：${await response.text()}`);
    const payload = await response.json() as { data?: Array<{ embedding: number[] }> };
    const embedding = payload.data?.[0]?.embedding;
    if (!embedding) throw new Error("OpenAI Embedding 响应缺少向量");
    return embedding;
  }
}

export class DeterministicEmbeddingService implements EmbeddingService {
  constructor(private readonly dimensions = 128) {}

  async embed(text: string): Promise<number[]> {
    const vector = Array<number>(this.dimensions).fill(0);
    const characters = [...text.toLowerCase()].filter(character => /[\p{L}\p{N}]/u.test(character));
    const features = [...characters];
    for (let index = 0; index < characters.length - 1; index++) features.push(`${characters[index]}${characters[index + 1]}`);
    for (const feature of features) {
      const hash = hashString(feature);
      vector[hash % this.dimensions] += 1;
      vector[(hash >>> 8) % this.dimensions] += 0.5;
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return norm === 0 ? vector : vector.map(value => value / norm);
  }
}

export class SemanticStore {
  private readonly collectionName: string;
  private readonly filePath: string;
  private vectors: StoredVector[] = [];
  private initialized = false;
  private writeQueue: Promise<void> = Promise.resolve();
  private chromaClient: any;
  private chromaCollection: any;

  constructor(private readonly embeddingService: EmbeddingService, private readonly config: SemanticStoreConfig) {
    this.collectionName = config.collectionName ?? "agent_memory";
    this.filePath = path.join(config.dataDir, `${this.collectionName.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.config.dataDir, { recursive: true });
    if (this.config.backend === "chromadb") {
      const { ChromaClient } = await import("chromadb");
      this.chromaClient = new ChromaClient({ path: this.config.chromaUrl ?? "http://localhost:8000" });
      this.chromaCollection = await this.chromaClient.getOrCreateCollection({ name: this.collectionName });
    } else {
      try {
        const content = await readFile(this.filePath, "utf8");
        const stored = JSON.parse(content) as StoredVector[];
        this.vectors = stored.map(vector => ({
          ...vector,
          entry: { ...vector.entry, createdAt: new Date(vector.entry.createdAt) },
        }));
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
        this.vectors = [];
      }
    }
    this.initialized = true;
  }

  async add(entry: MemoryEntry): Promise<void> {
    await this.initialize();
    const embedding = await this.embeddingService.embed(entry.content);
    if (this.chromaCollection) {
      await this.chromaCollection.add({
        ids: [entry.id],
        documents: [entry.content],
        embeddings: [embedding],
        metadatas: [{ entry: JSON.stringify(entry), type: entry.type }],
      });
      return;
    }
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      const previous = this.vectors;
      this.vectors = [...previous.filter(vector => vector.entry.id !== entry.id), { entry, embedding }];
      try {
        await this.persist();
      } catch (error) {
        this.vectors = previous;
        throw error;
      }
    });
    await this.writeQueue;
  }

  async search(query: string, options: MemoryRetrievalOptions = {}): Promise<RetrievedMemory[]> {
    await this.initialize();
    const limit = options.limit ?? 5;
    const minRelevance = options.minRelevance ?? 0;
    const embedding = await this.embeddingService.embed(query);
    let memories: RetrievedMemory[];
    if (this.chromaCollection) {
      const result = await this.chromaCollection.query({ queryEmbeddings: [embedding], nResults: Math.max(limit * 2, 10) });
      const metadatas = result.metadatas?.[0] ?? [];
      const distances = result.distances?.[0] ?? [];
      memories = metadatas.map((metadata: Record<string, string> | null, index: number) => {
        if (!metadata?.entry) return null;
        const entry = JSON.parse(metadata.entry) as MemoryEntry;
        entry.createdAt = new Date(entry.createdAt);
        return { entry, relevance: Math.max(0, 1 - (distances[index] ?? 1)) };
      }).filter(Boolean) as RetrievedMemory[];
    } else {
      memories = this.vectors.map(vector => ({
        entry: vector.entry,
        relevance: cosineSimilarity(embedding, vector.embedding),
      }));
    }
    return memories
      .filter(memory => memory.relevance >= minRelevance && (!options.types || options.types.includes(memory.entry.type)))
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);
  }

  async close(): Promise<void> {
    await this.writeQueue.catch(() => undefined);
    this.chromaClient = null;
    this.chromaCollection = null;
    this.initialized = false;
  }

  private async persist(): Promise<void> {
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(this.vectors), "utf8");
    await rename(temporaryPath, this.filePath);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < length; index++) {
    dot += a[index] * b[index];
    normA += a[index] ** 2;
    normB += b[index] ** 2;
  }
  if (normA === 0 || normB === 0) return 0;
  return Math.max(0, dot / Math.sqrt(normA * normB));
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
