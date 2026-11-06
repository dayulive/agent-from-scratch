import { describe, expect, it, vi } from "vitest";
import { AgentRunner } from "../../src/core/sandbox/agent-runner.js";

describe("AgentRunner.close", () => {
  it("等待活动运行和运行资源关闭后返回，并拒绝新任务", async () => {
    let graphStarted = false;
    let graphFinished = false;
    let runtimeClosed = false;
    const runner = new AgentRunner({
      graphFactory: async () => ({
        graph: {
          defaultRecursionLimit: 5,
          invoke: async () => {
            graphStarted = true;
            await new Promise(resolve => setTimeout(resolve, 50));
            graphFinished = true;
            return { finalAnswer: "done", messages: [], step: 1, plan: null };
          },
        },
        close: async () => { runtimeClosed = true; },
      }),
    });
    const running = runner.run("slow");
    await vi.waitFor(() => expect(graphStarted).toBe(true));
    await runner.close();

    expect(graphFinished).toBe(true);
    expect(runtimeClosed).toBe(true);
    expect(runner.activeRunCount).toBe(0);
    await expect(running).resolves.toMatchObject({ finalAnswer: "done" });
    await expect(runner.run("new")).rejects.toThrow("关闭");
  });

  it("缺少执行图时清理活动运行", async () => {
    const runner = new AgentRunner({});
    await expect(runner.run("missing")).rejects.toThrow("未配置");
    expect(runner.activeRunCount).toBe(0);
    await runner.close();
  });
});
