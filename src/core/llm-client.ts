import { generateText, jsonSchema, streamText, type CoreMessage, type LanguageModel } from "ai";
import { TokenCounter } from "./token-counter.js";

export interface LLMClientConfig {
  model: LanguageModel;
  maxRetries?: number;
  retryBaseDelay?: number;
  timeout?: number;
}

export interface LLMCallOptions {
  system?: string;
  tools?: any[] | Record<string, unknown>;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LLMResponse {
  text: string;
  finishReason: string;
  toolCalls?: any[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  duration: number;
}

export type StreamEvent =
  | { type: "token"; content: string }
  | { type: "done"; response: LLMResponse }
  | { type: "error"; error: Error };

interface CallRecord {
  totalTokens: number;
  duration: number;
}

export class LLMClient {
  private readonly config: Required<LLMClientConfig>;
  private readonly tokenCounter: TokenCounter;
  private readonly callLog: CallRecord[] = [];

  constructor(config: LLMClientConfig) {
    this.config = {
      model: config.model,
      maxRetries: config.maxRetries ?? 3,
      retryBaseDelay: config.retryBaseDelay ?? 1000,
      timeout: config.timeout ?? 60000,
    };
    this.tokenCounter = new TokenCounter();
  }

  async chat(messages: CoreMessage[], options: LLMCallOptions = {}): Promise<LLMResponse> {
    const startTime = Date.now();
    let lastError: Error | null = null;
    const fullMessages = this.prepareMessages(messages, options.system);

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error(`超时（${this.config.timeout}ms）`)), this.config.timeout);
      try {
        const result = await generateText({
          model: this.config.model,
          messages: fullMessages,
          tools: this.prepareTools(options.tools) as any,
          maxTokens: options.maxTokens,
          maxRetries: 0,
          abortSignal: this.getAbortSignal(controller.signal, options.signal),
        });
        const usage = this.normalizeUsage(result.usage);
        const response = {
          text: result.text,
          finishReason: result.finishReason,
          toolCalls: result.toolCalls ?? [],
          usage,
          duration: Date.now() - startTime,
        };
        this.callLog.push({ totalTokens: usage.totalTokens, duration: response.duration });
        return response;
      } catch (error) {
        lastError = this.toError(error);
        if (!this.shouldRetry(lastError) || attempt >= this.config.maxRetries) break;
        await this.sleep(this.calculateBackoff(attempt), options.signal);
      } finally {
        clearTimeout(timer);
      }
    }
    throw new LLMClientError(`LLM 调用失败：${lastError?.message ?? "未知错误"}`, lastError);
  }

  async *streamChat(messages: CoreMessage[], options: LLMCallOptions = {}): AsyncGenerator<StreamEvent> {
    const startTime = Date.now();
    const fullMessages = this.prepareMessages(messages, options.system);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`超时（${this.config.timeout}ms）`)), this.config.timeout);
    let fullText = "";

    try {
      const streamResult = streamText({
        model: this.config.model,
        messages: fullMessages,
        tools: this.prepareTools(options.tools) as any,
        maxTokens: options.maxTokens,
        maxRetries: this.config.maxRetries,
        abortSignal: this.getAbortSignal(controller.signal, options.signal),
      });

      for await (const chunk of streamResult.textStream) {
        fullText += chunk;
        yield { type: "token", content: chunk };
      }

      const [finishReason, rawUsage, toolCalls] = await Promise.all([
        streamResult.finishReason,
        streamResult.usage,
        streamResult.toolCalls,
      ]);
      const usage = this.normalizeUsage(rawUsage);
      const response = {
        text: fullText,
        finishReason: finishReason ?? "stop",
        toolCalls: toolCalls ?? [],
        usage,
        duration: Date.now() - startTime,
      };
      this.callLog.push({ totalTokens: usage.totalTokens, duration: response.duration });
      yield { type: "done", response };
    } catch (error) {
      yield { type: "error", error: this.toError(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  getUsageStats(): { totalCalls: number; totalTokens: number; averageTokensPerCall: number; totalDuration: number } {
    const totalTokens = this.callLog.reduce((sum, call) => sum + call.totalTokens, 0);
    const totalDuration = this.callLog.reduce((sum, call) => sum + call.duration, 0);
    return {
      totalCalls: this.callLog.length,
      totalTokens,
      averageTokensPerCall: this.callLog.length === 0 ? 0 : totalTokens / this.callLog.length,
      totalDuration,
    };
  }

  dispose(): void {
    this.tokenCounter.dispose();
  }

  private prepareMessages(messages: CoreMessage[], systemPrompt?: string): CoreMessage[] {
    const prepared = [...messages];
    if (systemPrompt && prepared[0]?.role !== "system") prepared.unshift({ role: "system", content: systemPrompt });
    return prepared;
  }

  private prepareTools(tools?: any[] | Record<string, unknown>): Record<string, unknown> | undefined {
    if (!tools) return undefined;
    if (!Array.isArray(tools)) return tools;
    return Object.fromEntries(tools.map(definition => [
      definition.name,
      { description: definition.description, parameters: jsonSchema(definition.parameters) },
    ]));
  }

  private normalizeUsage(usage?: { promptTokens?: number; completionTokens?: number }): LLMResponse["usage"] {
    const promptTokens = usage?.promptTokens ?? 0;
    const completionTokens = usage?.completionTokens ?? 0;
    return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
  }

  private shouldRetry(error: Error): boolean {
    const candidate = error as Error & { statusCode?: number; isRetryable?: boolean };
    if (candidate.isRetryable === true) return true;
    if (candidate.isRetryable === false) return false;
    if (candidate.statusCode) return candidate.statusCode === 429 || candidate.statusCode >= 500;
    const message = error.message.toLowerCase();
    if (["401", "403", "400", "404", "422", "context_length_exceeded", "aborted"].some(part => message.includes(part))) return false;
    return ["fetch failed", "econnrefused", "econnreset", "etimedout", "429", "500", "502", "503", "504", "超时"]
      .some(part => message.includes(part));
  }

  private calculateBackoff(attempt: number): number {
    return this.config.retryBaseDelay * Math.pow(2, attempt) + Math.random() * 1000;
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason ?? new Error("请求已取消"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private getAbortSignal(timeoutSignal: AbortSignal, externalSignal?: AbortSignal): AbortSignal {
    return externalSignal ? AbortSignal.any([timeoutSignal, externalSignal]) : timeoutSignal;
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }
}

export class LLMClientError extends Error {
  public readonly cause: Error | null;

  constructor(message: string, cause?: Error | null) {
    super(message);
    this.name = "LLMClientError";
    this.cause = cause ?? null;
  }
}
