import { TokenCounter } from "../token-counter.js";

export type ContextLayer = "resident" | "on_demand" | "runtime" | "memory";

export interface PromptSection {
  layer: ContextLayer;
  content: string;
  source: string;
  priority?: number;
}

export class PromptBuilder {
  private sections: PromptSection[] = [];
  private readonly maxTokens: number;
  private readonly tokenCounter: TokenCounter;

  constructor(config: { maxTokens?: number } = {}) {
    this.maxTokens = config.maxTokens ?? 8000;
    this.tokenCounter = new TokenCounter();
  }

  addResident(content: string, source: string, priority = 0): void {
    this.sections.push({ layer: "resident", content, source, priority });
  }

  addOnDemand(content: string, source: string, priority = 10): void {
    this.sections.push({ layer: "on_demand", content, source, priority });
  }

  addRuntime(content: string, source: string, priority = 20): void {
    this.sections.push({ layer: "runtime", content, source, priority });
  }

  addMemory(content: string, source: string, priority = 30): void {
    this.sections.push({ layer: "memory", content, source, priority });
  }

  clearLayer(layer?: ContextLayer): void {
    this.sections = layer ? this.sections.filter(section => section.layer !== layer) : [];
  }

  removeBySource(source: string): void {
    this.sections = this.sections.filter(section => section.source !== source);
  }

  getTotalTokens(): number {
    return this.sections.reduce((sum, section) => sum + this.tokenCounter.count(section.content), 0);
  }

  isOverBudget(): boolean {
    return this.getTotalTokens() > this.maxTokens;
  }

  getTokenStats(): Record<ContextLayer, { tokenCount: number; sectionCount: number }> {
    return {
      resident: this.getLayerStats("resident"),
      on_demand: this.getLayerStats("on_demand"),
      runtime: this.getLayerStats("runtime"),
      memory: this.getLayerStats("memory"),
    };
  }

  build(options?: { activeLayers?: ContextLayer[] }): string {
    const active = options?.activeLayers ?? ["resident", "on_demand", "runtime", "memory"];
    const parts: string[] = [];
    const order = [
      { layer: "resident" as const, marker: "system-core", header: "核心指令" },
      { layer: "on_demand" as const, marker: "on-demand", header: "按需加载的能力" },
      { layer: "runtime" as const, marker: "runtime", header: "当前任务状态" },
      { layer: "memory" as const, marker: "memory", header: "相关历史信息" },
    ];

    for (const { layer, marker, header } of order) {
      if (!active.includes(layer)) continue;
      const sections = this.sections
        .filter(section => section.layer === layer)
        .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));
      if (sections.length === 0) continue;
      parts.push(`<${marker}>`, `<!-- ${header} -->`, ...sections.map(section => section.content), `</${marker}>`);
    }
    return parts.join("\n\n");
  }

  clone(): PromptBuilder {
    const cloned = new PromptBuilder({ maxTokens: this.maxTokens });
    cloned.sections = this.sections.map(section => ({ ...section }));
    return cloned;
  }

  dispose(): void {
    this.tokenCounter.dispose();
  }

  private getLayerStats(layer: ContextLayer): { tokenCount: number; sectionCount: number } {
    const sections = this.sections.filter(section => section.layer === layer);
    return {
      tokenCount: sections.reduce((sum, section) => sum + this.tokenCounter.count(section.content), 0),
      sectionCount: sections.length,
    };
  }
}
