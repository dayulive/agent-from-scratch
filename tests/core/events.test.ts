import { describe, expect, it, vi } from "vitest";
import { AgentEventEmitter } from "../../src/core/streaming/event-emitter.js";

describe("AgentEventEmitter", () => {
  it("发布带时间和数据的事件并支持退订", () => {
    const emitter = new AgentEventEmitter();
    const listener = vi.fn();
    const unsubscribe = emitter.subscribe(listener);

    emitter.thinkingStart();
    emitter.toolStart("echo", { value: "hello" });
    emitter.toolComplete("echo", 12);
    unsubscribe();
    emitter.thinkingEnd("done");

    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls[0][0]).toMatchObject({ type: "thinking_start" });
    expect(listener.mock.calls[1][0]).toMatchObject({ type: "tool_start", data: { name: "echo", args: { value: "hello" } } });
    expect(listener.mock.calls[1][0].timestamp).toBeInstanceOf(Date);
  });

  it("隔离监听器异常", () => {
    const emitter = new AgentEventEmitter();
    const listener = vi.fn();
    emitter.subscribe(() => { throw new Error("broken listener"); });
    emitter.subscribe(listener);
    expect(() => emitter.planningStart()).not.toThrow();
    expect(listener).toHaveBeenCalledOnce();
  });
});
