import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MCPClientManager } from "../../src/tools/mcp/mcp-client.js";
import { createMcpServer } from "../../src/tools/mcp/mcp-server.js";
import { createTool } from "../../src/tools/create-tool.js";
import { ToolRegistry } from "../../src/tools/registry.js";

describe("MCP", () => {
  it("通过真实内存传输列出并调用注册表工具", async () => {
    const registry = new ToolRegistry();
    registry.register(createTool({
      name: "echo", description: "回声", schema: z.object({ value: z.string() }),
      execute: async ({ value }) => `hello ${value}`,
    }));
    const server = createMcpServer(registry);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const manager = new MCPClientManager();
    await manager.connect("local", clientTransport);

    const tools = await manager.listTools("local");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: "echo", description: "回声" });

    const result = await manager.callTool("local", "echo", { value: "mcp" });
    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("hello mcp");
    await manager.close();
    await server.close();
  });

  it("未知服务返回明确错误", async () => {
    const manager = new MCPClientManager();
    await expect(manager.listTools("missing")).rejects.toThrow("未连接");
    await manager.close();
  });
});
