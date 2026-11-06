export type MemoryType = "working" | "episodic" | "semantic" | "procedural";

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  tags: string[];
  importance: number;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface RetrievedMemory {
  entry: MemoryEntry;
  relevance: number;
}

export interface MemoryRetrievalOptions {
  limit?: number;
  minRelevance?: number;
  types?: MemoryType[];
}

export interface EpisodeInput {
  task: string;
  steps: string[];
  outcome: string;
  success: boolean;
  metadata?: Record<string, unknown>;
}

export interface EmbeddingService {
  embed(text: string): Promise<number[]>;
}

export interface MemoryConfig {
  dataDir?: string;
  semanticCollectionName?: string;
  semanticBackend?: "file" | "chromadb";
  chromaUrl?: string;
}
