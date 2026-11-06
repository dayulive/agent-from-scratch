import { TokenCounter } from "../token-counter.js";

export class ToolResultCompressor {
  private readonly tokenCounter = new TokenCounter();

  compress(result: string, maxTokens = 1000): string {
    if (this.tokenCounter.count(result) <= maxTokens) return result;

    try {
      const parsed = JSON.parse(result) as { success?: boolean; output?: string; error?: unknown };
      if (parsed.success === false) return JSON.stringify({ success: false, error: parsed.error });
      if (typeof parsed.output === "string") {
        const output = this.compressText(parsed.output, maxTokens);
        return JSON.stringify({ ...parsed, output });
      }
    } catch {
      // 非 JSON 工具结果按普通文本压缩。
    }
    return this.compressText(result, maxTokens);
  }

  dispose(): void {
    this.tokenCounter.dispose();
  }

  private compressText(text: string, maxTokens: number): string {
    const lines = text.split("\n");
    const deduplicated = lines.filter((line, index) => index === 0 || line !== lines[index - 1]);
    if (deduplicated.length < lines.length) {
      return `${deduplicated.join("\n")}\n[已压缩 ${lines.length - deduplicated.length} 行重复输出]`;
    }
    const maxChars = Math.max(80, maxTokens * 4);
    if (text.length <= maxChars) return text;
    const headLength = Math.floor(maxChars * 0.65);
    const tailLength = maxChars - headLength;
    return `${text.slice(0, headLength)}\n[已压缩中间 ${text.length - maxChars} 字符]\n${text.slice(-tailLength)}`;
  }
}
