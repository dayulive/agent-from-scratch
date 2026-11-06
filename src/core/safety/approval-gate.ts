import { randomUUID } from "node:crypto";
import type { CommandAnalyzer } from "./command-analyzer.js";

export interface ApprovalRequest {
  id: string;
  commands: string[];
  context: string;
  createdAt: Date;
  timeoutSeconds: number;
}

export interface ApprovalResult {
  requestId: string;
  approved: boolean;
  reason?: string;
  decidedBy?: string;
}

interface PendingApproval {
  request: ApprovalRequest;
  promise: Promise<ApprovalResult>;
  resolve: (result: ApprovalResult) => void;
  timer: NodeJS.Timeout;
  abortCleanup?: () => void;
}

export class ApprovalGate {
  private readonly pending = new Map<string, PendingApproval>();
  private requestListener?: (request: ApprovalRequest) => void;

  constructor(private readonly commandAnalyzer: CommandAnalyzer) {}

  setRequestListener(listener: (request: ApprovalRequest) => void): void {
    this.requestListener = listener;
  }

  requiresApprovalBatch(commands: string[]): boolean {
    return commands.some(command => this.commandAnalyzer.analyze(command).requiresApproval);
  }

  createRequest(commands: string[], context: string, timeoutSeconds = 120): ApprovalRequest {
    const request = { id: randomUUID(), commands: [...commands], context, createdAt: new Date(), timeoutSeconds };
    let resolve!: (result: ApprovalResult) => void;
    const promise = new Promise<ApprovalResult>(resolver => { resolve = resolver; });
    const timer = setTimeout(() => {
      this.settle(request.id, { requestId: request.id, approved: false, reason: "审批超时" });
    }, timeoutSeconds * 1000);
    this.pending.set(request.id, { request, promise, resolve, timer });
    queueMicrotask(() => {
      try {
        this.requestListener?.(request);
      } catch (error) {
        this.settle(request.id, { requestId: request.id, approved: false, reason: error instanceof Error ? error.message : String(error) });
      }
    });
    return request;
  }

  formatRequest(request: ApprovalRequest): string {
    return [
      `[审批请求] ${request.id}`,
      `上下文：${request.context}`,
      ...request.commands.map(command => `命令：${command}`),
      `将在 ${request.timeoutSeconds} 秒后自动拒绝`,
    ].join("\n");
  }

  waitForApproval(requestId: string, signal?: AbortSignal): Promise<ApprovalResult> {
    const pending = this.pending.get(requestId);
    if (!pending) return Promise.resolve({ requestId, approved: false, reason: "审批请求不存在或已完成" });
    if (signal) {
      const onAbort = () => this.settle(requestId, { requestId, approved: false, reason: "运行已取消" });
      pending.abortCleanup = () => signal.removeEventListener("abort", onAbort);
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    return pending.promise;
  }

  approve(requestId: string, decidedBy = "user"): boolean {
    return this.settle(requestId, { requestId, approved: true, decidedBy });
  }

  reject(requestId: string, decidedBy = "user", reason = "用户拒绝"): boolean {
    return this.settle(requestId, { requestId, approved: false, decidedBy, reason });
  }

  cancelAll(reason = "系统关闭"): void {
    for (const requestId of [...this.pending.keys()]) this.settle(requestId, { requestId, approved: false, reason });
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  get requestCount(): number {
    return this.pending.size;
  }

  private settle(requestId: string, result: ApprovalResult): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    pending.abortCleanup?.();
    this.pending.delete(requestId);
    pending.resolve(result);
    return true;
  }
}
