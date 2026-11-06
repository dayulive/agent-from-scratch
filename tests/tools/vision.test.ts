import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createScreenshotTool, createGUITools, VisualAnalyzer, type GUIAdapter } from "../../src/tools/vision/index.js";
import type { LLMClient } from "../../src/core/llm-client.js";

let tempDir: string;
let image: Buffer;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "agent-vision-"));
  image = await sharp({ create: { width: 8, height: 6, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("视觉工具", () => {
  it("截图适配器输出压缩图片和元数据", async () => {
    const outputPath = path.join(tempDir, "screen.png");
    const tool = createScreenshotTool({ capture: async () => image });
    const result = JSON.parse(await tool.execute({ path: outputPath, includeBase64: true, maxWidth: 4 }));
    expect(result.success).toBe(true);
    const output = JSON.parse(result.output);
    expect(output).toMatchObject({ path: outputPath, width: 4, height: 3 });
    expect(Buffer.from(output.base64, "base64")).toEqual(await readFile(outputPath));
  });

  it("VisualAnalyzer 发送文本和图像", async () => {
    let received: any;
    const client = {
      chat: async (messages: any) => {
        received = messages;
        return { text: "图中是测试色块" };
      },
    } as LLMClient;
    const analyzer = new VisualAnalyzer(client);
    await expect(analyzer.analyze(image, "描述图片")).resolves.toBe("图中是测试色块");
    expect(received[0].content[0]).toMatchObject({ type: "text", text: "描述图片" });
    expect(received[0].content[1].type).toBe("image");
  });

  it("GUI 工具通过适配器执行并报告不可用", async () => {
    const calls: string[] = [];
    const adapter: GUIAdapter = {
      moveMouse: async (x, y) => { calls.push(`move:${x},${y}`); },
      click: async button => { calls.push(`click:${button}`); },
      type: async text => { calls.push(`type:${text}`); },
      keyPress: async key => { calls.push(`key:${key}`); },
    };
    const [move] = createGUITools(adapter);
    const result = JSON.parse(await move.execute({ x: 10, y: 20 }));
    expect(result.success).toBe(true);
    expect(calls).toEqual(["move:10,20"]);

    const unavailable = createGUITools()[0];
    expect(JSON.parse(await unavailable.execute({ x: 1, y: 1 })).success).toBe(false);
  });
});
