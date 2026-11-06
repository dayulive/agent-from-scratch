import type { MemoryManager } from "../core/memory/memory-manager.js";
import type { PromptBuilder } from "../core/prompt/prompt-builder.js";
import type { Skill } from "./types.js";

export class SkillManager {
  private readonly skills = new Map<string, Skill>();
  private readonly active = new Set<string>();

  constructor(private readonly promptBuilder: PromptBuilder, private readonly memoryManager?: MemoryManager | null) {}

  register(skill: Skill): void {
    if (this.skills.has(skill.name)) throw new Error(`Skill "${skill.name}" 已注册`);
    this.skills.set(skill.name, skill);
  }

  registerAll(skills: Skill[]): void {
    for (const skill of skills) this.register(skill);
  }

  list(): Skill[] {
    return [...this.skills.values()];
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  getActive(): string[] {
    return [...this.active];
  }

  async activate(name: string): Promise<void> {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill "${name}" 未注册`);
    if (this.active.has(name)) return;
    this.promptBuilder.addOnDemand(`## Skill：${skill.name}\n${skill.instructions}`, `skill-${name}`, 10);
    this.active.add(name);
    await skill.activate?.({ promptBuilder: this.promptBuilder, memoryManager: this.memoryManager });
  }

  async deactivate(name: string): Promise<void> {
    const skill = this.skills.get(name);
    if (!skill || !this.active.has(name)) return;
    this.promptBuilder.removeBySource(`skill-${name}`);
    this.active.delete(name);
    await skill.deactivate?.({ promptBuilder: this.promptBuilder, memoryManager: this.memoryManager });
  }

  async autoActivate(task: string): Promise<string[]> {
    const activated: string[] = [];
    const normalized = task.toLowerCase();
    for (const skill of this.skills.values()) {
      if (!this.active.has(skill.name) && skill.triggers.some(trigger => normalized.includes(trigger.toLowerCase()))) {
        await this.activate(skill.name);
        activated.push(skill.name);
      }
    }
    return activated;
  }

  fork(promptBuilder: PromptBuilder, memoryManager = this.memoryManager): SkillManager {
    const forked = new SkillManager(promptBuilder, memoryManager);
    for (const skill of this.skills.values()) forked.register(skill);
    for (const name of this.active) forked.active.add(name);
    return forked;
  }

  async recordExperience(name: string, lesson: string): Promise<void> {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill "${name}" 未注册`);
    await this.memoryManager?.learn(lesson, ["skill", name, ...skill.tags], 0.85);
  }
}
