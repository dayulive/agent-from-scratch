import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolExecutionContext, ToolInstance, ToolResult } from "./types.js";

export function createTool<S extends z.ZodTypeAny>(config: {
  name: string;
  description: string;
  schema: S;
  execute: (params: z.output<S>, context?: ToolExecutionContext) => Promise<string>;
}): ToolInstance<z.output<S>> {
  const converted = zodToJsonSchema(config.schema, { target: "openApi3" }) as Record<string, any>;
  const parameters = converted.properties ? converted : { type: "object", properties: {} };

  return {
    name: config.name,
    description: config.description,
    parameters,
    schema: config.schema,
    async execute(rawParams: z.output<S>, context?: ToolExecutionContext): Promise<string> {
      if (context?.signal?.aborted) {
        return JSON.stringify({ success: false, error: { error: "工具执行已取消", isRetryable: false } } satisfies ToolResult);
      }
      const parsed = config.schema.safeParse(rawParams);
      if (!parsed.success) {
        const result: ToolResult = {
          success: false,
          error: {
            error: `参数校验失败：${parsed.error.message}`,
            suggestion: `期望 Schema：${JSON.stringify(parameters)}`,
            isRetryable: true,
          },
        };
        return JSON.stringify(result);
      }
      try {
        return JSON.stringify({ success: true, output: await config.execute(parsed.data, context) } satisfies ToolResult);
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: { error: error instanceof Error ? error.message : String(error), isRetryable: false },
        } satisfies ToolResult);
      }
    },
  };
}
