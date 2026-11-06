import type { CoreMessage } from "ai";
import type { LLMClient } from "../llm-client.js";
import { messageContentToString } from "./types.js";

export class DialogueCompressor {
  constructor(private readonly llmClient?: LLMClient) {}

  async compress(messages: CoreMessage[], options: { maxTokens?: number } = {}): Promise<string> {
    if (messages.length === 0) return "无早期对话";
    if (this.llmClient) {
      try {
        const response = await this.llmClient.chat(messages, {
          system: "将早期对话压缩为中文摘要。保留用户目标、已完成操作、错误、文件路径和未解决事项，省略寒暄与重复输出。",
          maxTokens: options.maxTokens ?? 500,
        });
        if (response.text.trim()) return response.text.trim();
      } catch {
        // 模型不可用时使用确定性摘要，保证上下文流程不中断。
      }
    }

    const lines = messages.slice(-8).map(message => {
      const role = { user: "用户", assistant: "助手", system: "系统", tool: "工具" }[message.role];
      const content = messageContentToString(message).replace(/\s+/g, " ").slice(0, 180);
      return `- ${role}：${content}`;
    });
    return lines.join("\n");
  }
}
