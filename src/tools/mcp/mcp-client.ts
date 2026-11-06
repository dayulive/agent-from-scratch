import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export class MCPClientManager {
  private readonly clients = new Map<string, Client>();

  async connect(name: string, transport: Transport): Promise<Client> {
    if (this.clients.has(name)) throw new Error(`MCP 服务 "${name}" 已连接`);
    const client = new Client({ name: "agent-from-scratch", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    this.clients.set(name, client);
    return client;
  }

  async connectStdio(name: string, options: { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }): Promise<Client> {
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    return this.connect(name, new StdioClientTransport(options));
  }

  async listTools(serverName?: string): Promise<any[]> {
    if (serverName) {
      const result = await this.getClient(serverName).listTools();
      return result.tools.map(tool => ({ ...tool, server: serverName }));
    }
    const groups = await Promise.all([...this.clients.keys()].map(async name => this.listTools(name)));
    return groups.flat();
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown> = {}): Promise<any> {
    return this.getClient(serverName).callTool({ name: toolName, arguments: args });
  }

  getClient(name: string): Client {
    const client = this.clients.get(name);
    if (!client) throw new Error(`MCP 服务 "${name}" 未连接`);
    return client;
  }

  async close(serverName?: string): Promise<void> {
    if (serverName) {
      const client = this.clients.get(serverName);
      if (client) await client.close();
      this.clients.delete(serverName);
      return;
    }
    await Promise.allSettled([...this.clients.values()].map(client => client.close()));
    this.clients.clear();
  }
}
