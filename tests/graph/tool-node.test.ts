import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentEventEmitter } from "../../src/core/streaming/event-emitter.js";
import { createToolNode } from "../../src/graph/nodes/tool-node.js";
import { MetricsRegistry } from "../../src/observability/metrics.js";
import { createTool } from "../../src/tools/create-tool.js";
import { ToolRegistry } from "../../src/tools/registry.js";

describe("工具节点指标", () => {
  it("结构化工具失败记录 tool_errors 和 tool_error 事件", async () => {
    const registry = new ToolRegistry();
    registry.register(createTool({
      name: "fail", description: "失败工具", schema: z.object({}),
      execute: async () => { throw new Error("permission denied"); },
    }));
    const metrics = new MetricsRegistry();
    const events = new AgentEventEmitter();
    const errorListener = vi.fn();
    events.subscribe(errorListener);
    const node = createToolNode({ toolRegistry: registry, metrics, eventEmitter: events });
    const result = await node({
      pendingToolCalls: [{ id: "call-1", name: "fail", args: {} }],
    });

    expect(metrics.getCounter("tool_calls")).toBe(1);
    expect(metrics.getCounter("tool_errors")).toBe(1);
    expect(errorListener).toHaveBeenCalledWith(expect.objectContaining({ type: "tool_error" }));
    expect((result.messages?.[0] as any).content[0].result.success).toBe(false);
  });
});
