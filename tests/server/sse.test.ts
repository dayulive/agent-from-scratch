import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { SSEConnectionManager } from "../../src/server/sse-server.js";

describe("SSEConnectionManager", () => {
  it("广播事件并在连接关闭后清理", () => {
    const manager = new SSEConnectionManager({ heartbeatMs: 1000 });
    const raw = new EventEmitter();
    const reply = {
      raw: Object.assign(raw, { writeHead: vi.fn().mockReturnThis(), write: vi.fn().mockReturnValue(true), end: vi.fn() }),
    };
    const id = manager.connect(reply as never);
    expect(manager.size).toBe(1);
    manager.broadcast({ type: "thinking_start", timestamp: new Date(), data: {} });
    expect(reply.raw.write).toHaveBeenCalledWith(expect.stringContaining("event: thinking_start"));

    raw.emit("close");
    expect(manager.size).toBe(0);
    manager.disconnect(id);
    manager.close();
  });

  it("任务专用连接不接收全局广播，直接发送不重复", () => {
    const manager = new SSEConnectionManager({ heartbeatMs: 1000 });
    const createReply = () => {
      const raw = new EventEmitter();
      return Object.assign(raw, { writeHead: vi.fn().mockReturnThis(), write: vi.fn().mockReturnValue(true), end: vi.fn() });
    };
    const globalReply = createReply();
    const taskReply = createReply();
    manager.connect({ raw: globalReply } as never);
    const taskId = manager.connect({ raw: taskReply } as never, { broadcast: false });
    const event = { type: "thinking_start" as const, timestamp: new Date(), data: {} };

    manager.broadcast(event);
    expect(globalReply.write).toHaveBeenCalledWith(expect.stringContaining("event: thinking_start"));
    expect(taskReply.write).not.toHaveBeenCalledWith(expect.stringContaining("event: thinking_start"));
    manager.send(taskId, event);
    expect(taskReply.write).toHaveBeenCalledTimes(2);
    manager.close();
  });
});
