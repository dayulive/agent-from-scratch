import type { ToolDefinition, ToolInstance } from "./types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolInstance>();

  register(tool: ToolInstance): void {
    if (this.tools.has(tool.name)) throw new Error(`工具 "${tool.name}" 已注册`);
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: ToolInstance[]): void {
    for (const tool of tools) this.register(tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): ToolInstance | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getToolNames(): string[] {
    return [...this.tools.keys()];
  }

  getToolSchemas(): ToolDefinition[] {
    return [...this.tools.values()].map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  values(): ToolInstance[] {
    return [...this.tools.values()];
  }

  get size(): number {
    return this.tools.size;
  }
}
