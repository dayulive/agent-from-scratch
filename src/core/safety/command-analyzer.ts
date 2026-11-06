export enum SecurityLevel {
  READ = "read",
  WRITE = "write",
  EXECUTE = "execute",
  DANGEROUS = "dangerous",
  BLOCKED = "blocked",
}

export interface CommandAnalysis {
  command: string;
  baseCommand: string;
  level: SecurityLevel;
  requiresApproval: boolean;
  detectedPatterns: string[];
  reason?: string;
}

export class CommandAnalyzer {
  private readonly blockedPatterns: Array<[RegExp, string]> = [
    [/\brm\s+(?:-[a-z]*[rf][a-z]*\s+)+(?:--no-preserve-root\s+)?\/(?:\s|$)/i, "删除根目录"],
    [/\bmkfs(?:\.[a-z0-9]+)?\b/i, "格式化文件系统"],
    [/\bdd\b[^;|&]*\bof=\/dev\//i, "覆写块设备"],
    [/:\(\)\s*\{\s*:\|:&\s*\};:/i, "Fork 炸弹"],
    [/\b(?:shutdown|poweroff|reboot)\b/i, "系统关机或重启"],
    [/\bchmod\s+-R\s+777\s+\/(?:\s|$)/i, "递归修改根目录权限"],
  ];

  private readonly dangerousPatterns: Array<[RegExp, string]> = [
    [/\bsudo\b/i, "提权执行"],
    [/\b(?:curl|wget)\b[^|]*\|\s*(?:sh|bash)\b/i, "远程脚本直接执行"],
    [/\b(?:iptables|ufw|diskutil|fdisk)\b/i, "系统安全或磁盘配置"],
  ];

  private readonly writePatterns: Array<[RegExp, string]> = [
    [/\b(?:rm|mv|cp|touch|mkdir|rmdir|truncate|chmod|chown|ln|tee)\b/i, "文件修改"],
    [/>>?|>\|/i, "输出重定向"],
    [/\b(?:npm|pnpm|yarn|pip|pip3|brew|apt|apt-get)\s+(?:install|remove|uninstall|upgrade|update)\b/i, "包管理变更"],
    [/\bgit\s+(?:add|commit|push|reset|rebase|merge|checkout|clean)\b/i, "版本库修改"],
  ];

  private readonly readCommands = new Set([
    "ls", "pwd", "cat", "head", "tail", "less", "more", "grep", "rg", "find", "wc", "file", "stat",
    "echo", "printf", "date", "whoami", "id", "uname", "which", "env", "printenv", "ps", "df", "du", "hostname",
  ]);

  analyze(command: string): CommandAnalysis {
    const trimmed = command.trim();
    const baseCommand = trimmed.split(/\s+/)[0] ?? "";
    const detectedPatterns: string[] = [];

    for (const [pattern, description] of this.blockedPatterns) {
      if (pattern.test(trimmed)) detectedPatterns.push(description);
    }
    if (detectedPatterns.length > 0) {
      return { command, baseCommand, level: SecurityLevel.BLOCKED, requiresApproval: true, detectedPatterns, reason: "命令被安全策略阻断" };
    }

    for (const [pattern, description] of this.dangerousPatterns) {
      if (pattern.test(trimmed)) detectedPatterns.push(description);
    }
    if (detectedPatterns.length > 0) {
      return { command, baseCommand, level: SecurityLevel.DANGEROUS, requiresApproval: true, detectedPatterns };
    }

    for (const [pattern, description] of this.writePatterns) {
      if (pattern.test(trimmed)) detectedPatterns.push(description);
    }
    if (detectedPatterns.length > 0) {
      return { command, baseCommand, level: SecurityLevel.WRITE, requiresApproval: true, detectedPatterns };
    }

    if (this.readCommands.has(baseCommand)) {
      return { command, baseCommand, level: SecurityLevel.READ, requiresApproval: false, detectedPatterns: [] };
    }
    return { command, baseCommand, level: SecurityLevel.EXECUTE, requiresApproval: true, detectedPatterns: ["非只读命令"] };
  }
}
