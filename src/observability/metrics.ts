export interface HistogramSnapshot {
  count: number;
  mean: number;
  min: number;
  max: number;
  p95: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly durations = new Map<string, number[]>();
  private tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  increment(name: string, value = 1, labels?: Record<string, string>): void {
    const key = metricKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  recordDuration(name: string, durationMs: number, labels?: Record<string, string>): void {
    const key = metricKey(name, labels);
    const values = this.durations.get(key) ?? [];
    values.push(durationMs);
    this.durations.set(key, values);
  }

  recordTokens(usage: { promptTokens: number; completionTokens: number; totalTokens?: number }): void {
    this.tokenUsage.promptTokens += usage.promptTokens;
    this.tokenUsage.completionTokens += usage.completionTokens;
    this.tokenUsage.totalTokens += usage.totalTokens ?? usage.promptTokens + usage.completionTokens;
  }

  getCounter(name: string, labels?: Record<string, string>): number {
    return this.counters.get(metricKey(name, labels)) ?? 0;
  }

  getHistogram(name: string, labels?: Record<string, string>): HistogramSnapshot {
    const values = this.durations.get(metricKey(name, labels)) ?? [];
    if (values.length === 0) return { count: 0, mean: 0, min: 0, max: 0, p95: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    return {
      count: values.length,
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      min: sorted[0],
      max: sorted.at(-1)!,
      p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)],
    };
  }

  snapshot(): { counters: Record<string, number>; histograms: Record<string, HistogramSnapshot>; tokens: TokenUsage } {
    return {
      counters: Object.fromEntries(this.counters),
      histograms: Object.fromEntries([...this.durations.keys()].map(key => [key, this.getHistogram(key)])),
      tokens: { ...this.tokenUsage },
    };
  }

  reset(): void {
    this.counters.clear();
    this.durations.clear();
    this.tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }
}

function metricKey(name: string, labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return name;
  const suffix = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join(",");
  return `${name}{${suffix}}`;
}
