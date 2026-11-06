import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ToolRegistry } from "../registry.js";

export function createMcpServer(registry: ToolRegistry): Server {
  const server = new Server(
    { name: "agent-from-scratch", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.getToolSchemas().map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: { type: "object", ...tool.parameters },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const tool = registry.get(request.params.name);
    if (!tool) {
      return { content: [{ type: "text", text: `未知工具：${request.params.name}` }], isError: true };
    }
    const output = await tool.execute(request.params.arguments ?? {});
    let isError = false;
    try {
      isError = JSON.parse(output).success === false;
    } catch {
      isError = false;
    }
    return { content: [{ type: "text", text: output }], isError };
  });
  return server;
}
