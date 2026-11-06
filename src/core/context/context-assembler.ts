import type { CoreMessage } from "ai";
import type { MemoryManager } from "../memory/memory-manager.js";
import type { PromptBuilder } from "../prompt/prompt-builder.js";
import { TokenCounter } from "../token-counter.js";
import type { ContextManager } from "./context-manager.js";
import type { AssembledContext } from "./types.js";

export class ContextAssembler {
  private readonly tokenCounter = new TokenCounter();

  constructor(private readonly dependencies: {
    promptBuilder: PromptBuilder;
    contextManager: ContextManager;
    memoryManager?: MemoryManager;
  }) {}

  async assemble(input: { messages: CoreMessage[]; query?: string; includeMemory?: boolean }): Promise<AssembledContext> {
    const { promptBuilder, contextManager, memoryManager } = this.dependencies;
    if (memoryManager && input.includeMemory !== false && input.query) {
      const memories = await memoryManager.retrieveRelevant(input.query, { limit: 5, minRelevance: 0.2 });
      promptBuilder.clearLayer("memory");
      for (const memory of memories) {
        promptBuilder.addMemory(
          `[相关记忆 ${(memory.relevance * 100).toFixed(0)}%] ${memory.entry.content}`,
          `mem-${memory.entry.id}`,
        );
      }
    }
    const messages = await contextManager.manage(input.messages);
    const systemPrompt = promptBuilder.build();
    return { systemPrompt, messages, totalTokens: this.tokenCounter.count(systemPrompt) + contextManager.countTokens(messages) };
  }

  dispose(): void {
    this.tokenCounter.dispose();
  }
}
