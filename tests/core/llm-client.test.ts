import { MockLanguageModelV1 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LLMClient, LLMClientError } from "../../src/core/llm-client.js";

const successResult = {
  rawCall: { rawPrompt: null, rawSettings: {} },
  finishReason: "stop" as const,
  usage: { promptTokens: 2, completionTokens: 3 },
  text: "完成",
};

afterEach(() => vi.restoreAllMocks());

describe("LLMClient", () => {
  it("返回文本、用量与耗时并统计调用", async () => {
    const client = new LLMClient({ model: new MockLanguageModelV1({ doGenerate: async () => successResult }) });
    const response = await client.chat([{ role: "user", content: "你好" }]);

    expect(response.text).toBe("完成");
    expect(response.usage).toEqual({ promptTokens: 2, completionTokens: 3, totalTokens: 5 });
    expect(client.getUsageStats()).toMatchObject({ totalCalls: 1, totalTokens: 5, averageTokensPerCall: 5 });
    client.dispose();
  });

  it("限流错误退避后重试", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    let attempts = 0;
    const model = new MockLanguageModelV1({
      doGenerate: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("429 too many requests");
        return successResult;
      },
    });
    const client = new LLMClient({ model, maxRetries: 1, retryBaseDelay: 1 });
    await expect(client.chat([{ role: "user", content: "hi" }])).resolves.toMatchObject({ text: "完成" });
    expect(attempts).toBe(2);
    client.dispose();
  });

  it("认证错误不重试并保留原因", async () => {
    let attempts = 0;
    const model = new MockLanguageModelV1({
      doGenerate: async () => {
        attempts += 1;
        throw new Error("401 unauthorized");
      },
    });
    const client = new LLMClient({ model, maxRetries: 3 });
    const promise = client.chat([{ role: "user", content: "hi" }]);
    await expect(promise).rejects.toBeInstanceOf(LLMClientError);
    await expect(promise).rejects.toMatchObject({ cause: expect.objectContaining({ message: "401 unauthorized" }) });
    expect(attempts).toBe(1);
    client.dispose();
  });

  it("模型不存在等永久错误不重试", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    let attempts = 0;
    const model = new MockLanguageModelV1({
      doGenerate: async () => {
        attempts += 1;
        throw new Error("404 model not found");
      },
    });
    const client = new LLMClient({ model, maxRetries: 2, retryBaseDelay: 1 });
    await expect(client.chat([{ role: "user", content: "hi" }])).rejects.toThrow();
    expect(attempts).toBe(1);
    client.dispose();
  });

  it("流式输出文本块和最终响应", async () => {
    const model = new MockLanguageModelV1({
      doStream: async () => ({
        rawCall: { rawPrompt: null, rawSettings: {} },
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-delta", textDelta: "你" });
            controller.enqueue({ type: "text-delta", textDelta: "好" });
            controller.enqueue({ type: "finish", finishReason: "stop", usage: { promptTokens: 1, completionTokens: 2 } });
            controller.close();
          },
        }),
      }),
    });
    const client = new LLMClient({ model });
    const events = [];
    for await (const event of client.streamChat([{ role: "user", content: "hi" }])) events.push(event);

    expect(events.filter(event => event.type === "token").map(event => event.content).join("")).toBe("你好");
    expect(events.at(-1)).toMatchObject({ type: "done", response: { text: "你好", usage: { totalTokens: 3 } } });
    client.dispose();
  });

  it("外部 AbortSignal 会取消模型请求", async () => {
    let modelSignal: AbortSignal | undefined;
    const model = new MockLanguageModelV1({
      doGenerate: ({ abortSignal }) => new Promise((_resolve, reject) => {
        modelSignal = abortSignal;
        const rejectAbort = () => reject(abortSignal?.reason ?? new Error("aborted"));
        if (abortSignal?.aborted) rejectAbort();
        else abortSignal?.addEventListener("abort", rejectAbort, { once: true });
      }),
    });
    const client = new LLMClient({ model });
    const controller = new AbortController();
    const promise = client.chat([{ role: "user", content: "hi" }], { signal: controller.signal });
    await vi.waitFor(() => expect(modelSignal).toBeDefined());
    controller.abort();
    await expect(promise).rejects.toThrow();
    expect(modelSignal?.aborted).toBe(true);
    client.dispose();
  });
});
