import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { createTool } from "../create-tool.js";

export interface ScreenshotConfig {
  capture?: () => Promise<Buffer>;
}

export function createScreenshotTool(config: ScreenshotConfig = {}) {
  return createTool({
    name: "screenshot",
    description: "截取桌面图片，调整尺寸并保存为 PNG。需要当前操作系统授予屏幕录制权限。",
    schema: z.object({
      path: z.string().optional().describe("PNG 保存路径"),
      includeBase64: z.boolean().default(false).describe("是否在结果中附带 base64"),
      maxWidth: z.number().int().min(1).max(4096).default(1280).describe("最大图片宽度"),
    }),
    execute: async ({ path: requestedPath, includeBase64, maxWidth }) => {
      const capture = config.capture ?? defaultCapture;
      const source = await capture();
      const { data, info } = await sharp(source).resize({ width: maxWidth, withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
      const outputPath = requestedPath ?? path.join(tmpdir(), `agent-screenshot-${Date.now()}.png`);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, data);
      return JSON.stringify({
        path: outputPath,
        width: info.width,
        height: info.height,
        bytes: data.length,
        ...(includeBase64 ? { base64: data.toString("base64") } : {}),
      });
    },
  });
}

async function defaultCapture(): Promise<Buffer> {
  const screenshot = (await import("screenshot-desktop")).default;
  return screenshot({ format: "png" });
}
