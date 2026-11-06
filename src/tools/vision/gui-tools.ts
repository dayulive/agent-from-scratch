import { z } from "zod";
import { createTool } from "../create-tool.js";
import type { ToolInstance } from "../types.js";

export interface GUIAdapter {
  moveMouse(x: number, y: number): Promise<void>;
  click(button: "left" | "right" | "middle"): Promise<void>;
  type(text: string): Promise<void>;
  keyPress(key: string): Promise<void>;
}

const unavailable: GUIAdapter = {
  moveMouse: async () => { throw new Error("GUI 不可用：未配置原生桌面适配器"); },
  click: async () => { throw new Error("GUI 不可用：未配置原生桌面适配器"); },
  type: async () => { throw new Error("GUI 不可用：未配置原生桌面适配器"); },
  keyPress: async () => { throw new Error("GUI 不可用：未配置原生桌面适配器"); },
};

export function createGUITools(adapter: GUIAdapter = unavailable): ToolInstance[] {
  return [
    createTool({
      name: "gui_move_mouse", description: "将鼠标移动到屏幕坐标。",
      schema: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }),
      execute: async ({ x, y }) => { await adapter.moveMouse(x, y); return `鼠标已移动到 (${x}, ${y})`; },
    }),
    createTool({
      name: "gui_click", description: "点击鼠标按键。",
      schema: z.object({ button: z.enum(["left", "right", "middle"]).default("left") }),
      execute: async ({ button }) => { await adapter.click(button); return `已点击 ${button}`; },
    }),
    createTool({
      name: "gui_type", description: "在当前焦点位置输入文本。",
      schema: z.object({ text: z.string().max(10_000) }),
      execute: async ({ text }) => { await adapter.type(text); return `已输入 ${text.length} 个字符`; },
    }),
    createTool({
      name: "gui_key_press", description: "按下指定按键或组合键。",
      schema: z.object({ key: z.string().min(1).max(100) }),
      execute: async ({ key }) => { await adapter.keyPress(key); return `已按键 ${key}`; },
    }),
  ];
}
