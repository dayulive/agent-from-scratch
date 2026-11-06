export interface OutputGuardResult {
  filtered: string;
  redactionCount: number;
}

export class OutputGuard {
  filter(text: string): OutputGuardResult {
    let redactionCount = 0;
    let filtered = text;
    const replacements: Array<[RegExp, string]> = [
      [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[已屏蔽私钥]"],
      [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [已屏蔽令牌]"],
      [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[已屏蔽 API Key]"],
      [/\bAKIA[0-9A-Z]{16}\b/g, "[已屏蔽 Access Key]"],
      [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[已屏蔽 GitHub Token]"],
    ];
    for (const [pattern, replacement] of replacements) {
      filtered = filtered.replace(pattern, () => {
        redactionCount += 1;
        return replacement;
      });
    }
    return { filtered, redactionCount };
  }
}
