import { LLMClient } from "../llm-client.js";
import { InputGuard, type InputGuardResult } from "./input-guard.js";
import { CommandAnalyzer, SecurityLevel, type CommandAnalysis } from "./command-analyzer.js";
import { ApprovalGate, type ApprovalRequest } from "./approval-gate.js";
import { OutputGuard } from "./output-guard.js";

export interface SafetyConfig {
  enableInputGuard?: boolean;
  enableCommandControl?: boolean;
  enableApproval?: boolean;
  enableOutputGuard?: boolean;
  approvalTimeout?: number;
}

export class SafetySystem {
  readonly inputGuard: InputGuard;
  readonly commandAnalyzer: CommandAnalyzer;
  readonly approvalGate: ApprovalGate;
  readonly outputGuard: OutputGuard;
  private readonly config: Required<SafetyConfig>;

  constructor(config: SafetyConfig = {}, llmClient?: LLMClient) {
    this.config = {
      enableInputGuard: config.enableInputGuard ?? true,
      enableCommandControl: config.enableCommandControl ?? true,
      enableApproval: config.enableApproval ?? true,
      enableOutputGuard: config.enableOutputGuard ?? true,
      approvalTimeout: config.approvalTimeout ?? 120,
    };
    this.inputGuard = new InputGuard(llmClient);
    this.commandAnalyzer = new CommandAnalyzer();
    this.approvalGate = new ApprovalGate(this.commandAnalyzer);
    this.outputGuard = new OutputGuard();
  }

  async checkInput(input: string): Promise<InputGuardResult> {
    if (!this.config.enableInputGuard) return { allowed: true, method: "none" };
    return this.inputGuard.check(input);
  }

  analyzeCommand(command: string): CommandAnalysis {
    if (!this.config.enableCommandControl) {
      return { command, baseCommand: command, level: SecurityLevel.READ, requiresApproval: false, detectedPatterns: [] };
    }
    return this.commandAnalyzer.analyze(command);
  }

  async requestApprovalIfNeeded(commands: string[], context: string, options: { signal?: AbortSignal } = {}): Promise<{
    needsApproval: boolean;
    approved: boolean;
    blocked?: boolean;
    request?: ApprovalRequest;
  }> {
    const analyses = commands.map(command => this.analyzeCommand(command));
    if (analyses.some(analysis => analysis.level === SecurityLevel.BLOCKED)) {
      return { needsApproval: true, approved: false, blocked: true };
    }
    if (!this.config.enableApproval) return { needsApproval: false, approved: true };
    if (!analyses.some(analysis => analysis.requiresApproval)) return { needsApproval: false, approved: true };

    const request = this.approvalGate.createRequest(commands, context, this.config.approvalTimeout);
    console.log(this.approvalGate.formatRequest(request));
    const result = await this.approvalGate.waitForApproval(request.id, options.signal);
    return { needsApproval: true, approved: result.approved, request };
  }

  filterOutput(text: string): string {
    if (!this.config.enableOutputGuard) return text;
    return this.outputGuard.filter(text).filtered;
  }

  close(): void {
    this.approvalGate.cancelAll();
  }
}
