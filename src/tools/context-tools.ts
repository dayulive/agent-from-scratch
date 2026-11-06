import type { CoreMessage } from "ai";
import { z } from "zod";
import type { ContextManager } from "../core/context/context-manager.js";
import { createTool } from "./create-tool.js";
import type { ToolInstance } from "./types.js";

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
});

export function createContextTools(contextManager: ContextManager): ToolInstance[] {
  const countTool = createTool({
    name: "count_context_tokens",
    description: "计算一组对话消息的 Token 用量。",
    schema: z.object({ messages: z.array(messageSchema) }),
    execute: async ({ messages }) => JSON.stringify({
      tokens: contextManager.countTokens(messages as CoreMessage[]),
      messageCount: messages.length,
    }),
  });
  const compressTool = createTool({
    name: "compress_context",
    description: "按上下文预算压缩消息并返回新的消息数组。",
    schema: z.object({ messages: z.array(messageSchema) }),
    execute: async ({ messages }) => JSON.stringify(await contextManager.manage(messages as CoreMessage[])),
  });
  return [countTool, compressTool];
}
