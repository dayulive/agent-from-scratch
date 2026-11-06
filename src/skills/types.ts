import type { PromptBuilder } from "../core/prompt/prompt-builder.js";
import type { MemoryManager } from "../core/memory/memory-manager.js";
import type { ToolInstance } from "../tools/types.js";

export interface SkillContext {
  promptBuilder: PromptBuilder;
  memoryManager?: MemoryManager | null;
}

export interface Skill {
  name: string;
  description: string;
  version: string;
  triggers: string[];
  instructions: string;
  tags: string[];
  tools?: ToolInstance[];
  activate?(context: SkillContext): Promise<void> | void;
  deactivate?(context: SkillContext): Promise<void> | void;
}
