import { describe, expect, it } from "vitest";
import { PromptBuilder } from "../../src/core/prompt/prompt-builder.js";
import { SkillManager } from "../../src/skills/manager.js";
import { dataAnalysisSkill, devopsDeploySkill, logDiagnosticsSkill } from "../../src/skills/builtin/index.js";
import type { Skill } from "../../src/skills/types.js";

describe("SkillManager", () => {
  it("按需激活和卸载 Skill 提示", () => {
    const prompt = new PromptBuilder();
    const manager = new SkillManager(prompt);
    manager.registerAll([devopsDeploySkill, dataAnalysisSkill, logDiagnosticsSkill]);

    expect(manager.list()).toHaveLength(3);
    manager.activate("devops-deploy");
    expect(prompt.build()).toContain("部署前检查");
    expect(manager.getActive()).toEqual(["devops-deploy"]);

    manager.deactivate("devops-deploy");
    expect(prompt.build()).not.toContain("部署前检查");
  });

  it("根据任务关键词自动激活并执行生命周期钩子", async () => {
    const manager = new SkillManager(new PromptBuilder());
    let activated = false;
    manager.register({ ...logDiagnosticsSkill, activate: () => { activated = true; } });
    await expect(manager.autoActivate("请排查线上错误日志")).resolves.toEqual(["log-diagnostics"]);
    expect(activated).toBe(true);
  });

  it("拒绝重复注册和激活未知 Skill", async () => {
    const manager = new SkillManager(new PromptBuilder());
    const skill: Skill = { name: "custom", description: "自定义", version: "1.0.0", triggers: ["custom"], instructions: "步骤", tags: [] };
    manager.register(skill);
    expect(() => manager.register(skill)).toThrow("已注册");
    await expect(manager.activate("missing")).rejects.toThrow("未注册");
  });
});
