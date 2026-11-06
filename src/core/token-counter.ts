import { encoding_for_model, type Tiktoken, type TiktokenModel } from "tiktoken";

export class TokenCounter {
  private encoder: Tiktoken | null = null;
  private disposed = false;

  constructor(private readonly model: TiktokenModel = "gpt-4o") {}

  count(text: string): number {
    if (this.disposed) throw new Error("TokenCounter 已释放");
    if (!text) return 0;
    if (!this.encoder) this.encoder = encoding_for_model(this.model);
    return this.encoder.encode(text).length;
  }

  countMessages(messages: Array<{ role: string; content: string }>): number {
    return messages.reduce((total, message) => total + this.count(message.content) + 4, 2);
  }

  dispose(): void {
    this.encoder?.free();
    this.encoder = null;
    this.disposed = true;
  }
}
