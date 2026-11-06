import type { CoreMessage } from "ai";
import { TokenCounter } from "../token-counter.js";
import { DialogueCompressor } from "./dialogue-compressor.js";
import { messageContentToString, type ContextConfig, type ContextStats } from "./types.js";

interface MessageGroup {
  messages: CoreMessage[];
  tokens: number;
}

export class ContextManager {
  private readonly maxTokens: number;
  private readonly reserveTokens: number;
  private readonly maxSummaryTokens: number;
  private readonly tokenCounter = new TokenCounter();
  private readonly dialogueCompressor: DialogueCompressor;
  private lastStats: ContextStats = { originalTokens: 0, managedTokens: 0, originalMessageCount: 0, managedMessageCount: 0, compressed: false };

  constructor(config: ContextConfig = {}, dialogueCompressor?: DialogueCompressor) {
    this.maxTokens = config.maxTokens ?? 6000;
    this.reserveTokens = config.reserveTokens ?? 500;
    this.maxSummaryTokens = config.maxSummaryTokens ?? 500;
    this.dialogueCompressor = dialogueCompressor ?? new DialogueCompressor();
  }

  countTokens(messages: CoreMessage[]): number {
    return messages.reduce((total, message) => total + this.tokenCounter.count(messageContentToString(message)) + 4, 2);
  }

  async manage(messages: CoreMessage[]): Promise<CoreMessage[]> {
    const originalTokens = this.countTokens(messages);
    if (originalTokens <= this.maxTokens) {
      this.updateStats(messages, messages, originalTokens, originalTokens, false);
      return [...messages];
    }

    const systemMessages: CoreMessage[] = [];
    let index = 0;
    while (messages[index]?.role === "system") {
      systemMessages.push(messages[index]);
      index += 1;
    }
    const conversation = messages.slice(index);
    const groups = this.createGroups(conversation);
    const fixedTokens = this.countTokens(systemMessages);
    const budget = Math.max(40, this.maxTokens - this.reserveTokens - fixedTokens);
    const recentGroups: MessageGroup[] = [];
    let recentTokens = 0;

    for (let cursor = groups.length - 1; cursor >= 0; cursor--) {
      const group = groups[cursor];
      if (recentGroups.length > 0 && recentTokens + group.tokens > budget) break;
      recentGroups.unshift(group);
      recentTokens += group.tokens;
      if (recentTokens > budget) break;
    }

    const keptCount = recentGroups.reduce((sum, group) => sum + group.messages.length, 0);
    const droppedCount = Math.max(0, conversation.length - keptCount);
    const recent = recentGroups.flatMap(group => group.messages);
    let result: CoreMessage[];
    if (droppedCount > 0) {
      const summary = await this.dialogueCompressor.compress(conversation.slice(0, droppedCount), { maxTokens: this.maxSummaryTokens });
      result = [...systemMessages, { role: "system", content: `[早期对话摘要]\n${summary}` }, ...recent];
    } else {
      result = [...systemMessages, ...recent];
    }
    this.updateStats(messages, result, originalTokens, this.countTokens(result), true);
    return result;
  }

  getStats(): ContextStats {
    return { ...this.lastStats };
  }

  dispose(): void {
    this.tokenCounter.dispose();
  }

  private createGroups(messages: CoreMessage[]): MessageGroup[] {
    const groups: MessageGroup[] = [];
    for (let index = 0; index < messages.length; index++) {
      const group = [messages[index]];
      if (this.hasToolCalls(messages[index])) {
        while (messages[index + 1]?.role === "tool") {
          group.push(messages[index + 1]);
          index += 1;
        }
      }
      groups.push({ messages: group, tokens: this.countTokens(group) });
    }
    return groups;
  }

  private hasToolCalls(message: CoreMessage): boolean {
    return message.role === "assistant" && Array.isArray(message.content)
      && message.content.some(part => part.type === "tool-call");
  }

  private updateStats(original: CoreMessage[], managed: CoreMessage[], originalTokens: number, managedTokens: number, compressed: boolean): void {
    this.lastStats = {
      originalTokens,
      managedTokens,
      originalMessageCount: original.length,
      managedMessageCount: managed.length,
      compressed,
    };
  }
}
