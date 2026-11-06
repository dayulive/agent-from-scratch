import type { z } from "zod";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolExecutionContext {
  signal?: AbortSignal;
}

export interface ToolInstance<T = any> extends ToolDefinition {
  schema: z.ZodType<T>;
  execute(params: T, context?: ToolExecutionContext): Promise<string>;
}

export interface ToolExecutionError {
  error: string;
  suggestion?: string;
  isRetryable: boolean;
}

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: ToolExecutionError;
}
