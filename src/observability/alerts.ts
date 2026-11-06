import type { MetricsRegistry } from "./metrics.js";

export interface AlertRule {
  name: string;
  metric: string;
  threshold: number;
  type?: "counter" | "duration_p95";
  cooldownSeconds?: number;
}

export interface Alert {
  name: string;
  metric: string;
  value: number;
  threshold: number;
  timestamp: Date;
}

export class AlertEngine {
  private readonly lastTriggered = new Map<string, number>();

  constructor(private readonly metrics: MetricsRegistry, private readonly rules: AlertRule[]) {}

  evaluate(now = Date.now()): Alert[] {
    const triggered: Alert[] = [];
    for (const rule of this.rules) {
      const value = rule.type === "duration_p95"
        ? this.metrics.getHistogram(rule.metric).p95
        : this.metrics.getCounter(rule.metric);
      const cooldown = (rule.cooldownSeconds ?? 300) * 1000;
      if (value <= rule.threshold || now - (this.lastTriggered.get(rule.name) ?? 0) < cooldown) continue;
      this.lastTriggered.set(rule.name, now);
      triggered.push({ name: rule.name, metric: rule.metric, value, threshold: rule.threshold, timestamp: new Date(now) });
    }
    return triggered;
  }
}
