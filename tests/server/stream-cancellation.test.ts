import { describe, expect, it, vi } from "vitest";
import { AgentRunner } from "../../src/core/sandbox/agent-runner.js";
import { createServer } from "../../src/server/index.js";

describe("SSE 断连取消", () => {
  it("客户端关闭时立即取消尚未完成的图", async () => {
    let aborted = false;
    const graph = {
      defaultRecursionLimit: 5,
      invoke: async (_input: unknown, config: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        const onAbort = () => {
          aborted = true;
          reject(new Error("aborted"));
        };
        if (config.signal.aborted) onAbort();
        else config.signal.addEventListener("abort", onAbort, { once: true });
      }),
    };
    const runner = new AgentRunner({ compiledGraph: graph });
    const app = await createServer({ agentRunner: runner });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/tasks/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "wait" }),
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    while (!received.includes("run_started")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += decoder.decode(chunk.value, { stream: true });
    }
    controller.abort();
    await vi.waitFor(() => expect(aborted).toBe(true), { timeout: 500 });
    await app.close();
    await runner.close();
  });
});
