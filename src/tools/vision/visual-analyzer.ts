import { readFile } from "node:fs/promises";
import type { LLMClient } from "../../core/llm-client.js";

export class VisualAnalyzer {
  constructor(private readonly llmClient: LLMClient) {}

  async analyze(image: string | Buffer, prompt = "描述图片中的关键内容、文本和异常。"): Promise<string> {
    const data = Buffer.isBuffer(image) ? image : await readFile(image);
    const response = await this.llmClient.chat([{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image", image: `data:image/png;base64,${data.toString("base64")}`, mimeType: "image/png" },
      ],
    }]);
    return response.text;
  }
}
