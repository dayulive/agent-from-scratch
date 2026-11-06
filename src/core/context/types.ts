import type { CoreMessage } from "ai";

export interface ContextConfig {
  maxTokens?: number;
  reserveTokens?: number;
  maxSummaryTokens?: number;
}

export interface ContextStats {
  originalTokens: number;
  managedTokens: number;
  originalMessageCount: number;
  managedMessageCount: number;
  compressed: boolean;
}

export interface AssembledContext {
  systemPrompt: string;
  messages: CoreMessage[];
  totalTokens: number;
}

export function messageContentToString(message: CoreMessage): string {
  if (typeof message.content === "string") return message.content;
  return JSON.stringify(message.content);
}
