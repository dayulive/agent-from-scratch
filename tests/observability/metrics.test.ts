import { describe, expect, it } from "vitest";
import { AlertEngine } from "../../src/observability/alerts.js";
import { Dashboard } from "../../src/observability/dashboard.js";
import { MetricsRegistry } from "../../src/observability/metrics.js";
import { Tracer } from "../../src/observability/tracer.js";

describe("MetricsRegistry", () => {
  it("聚合计数、耗时百分位和 Token", () => {
    const metrics = new MetricsRegistry();
    metrics.increment("requests");
    metrics.increment("requests", 2);
    for (const duration of [10, 20, 30, 40, 100]) metrics.recordDuration("latency", duration);
    metrics.recordTokens({ promptTokens: 3, completionTokens: 4, totalTokens: 7 });

    expect(metrics.getCounter("requests")).toBe(3);
    expect(metrics.getHistogram("latency")).toMatchObject({ count: 5, mean: 40, min: 10, max: 100, p95: 100 });
    expect(metrics.snapshot().tokens).toEqual({ promptTokens: 3, completionTokens: 4, totalTokens: 7 });
  });
});

describe("Alerts、Tracer 与 Dashboard", () => {
  it("按阈值告警并应用冷却时间", () => {
    const metrics = new MetricsRegistry();
    metrics.increment("errors", 3);
    const alerts = new AlertEngine(metrics, [{ name: "错误过多", metric: "errors", threshold: 2, cooldownSeconds: 60 }]);
    expect(alerts.evaluate()).toHaveLength(1);
    expect(alerts.evaluate()).toHaveLength(0);
  });

  it("无 Langfuse 凭据时保留本地追踪并生成面板", async () => {
    const tracer = new Tracer();
    const trace = tracer.startTrace("task", { source: "test" });
    const span = tracer.startSpan(trace.id, "llm");
    span.end({ text: "done" });
    trace.end("ok");
    await tracer.flush();

    const metrics = new MetricsRegistry();
    const dashboard = new Dashboard(metrics, tracer);
    expect(dashboard.snapshot().traces).toHaveLength(1);
    expect(dashboard.snapshot().traces[0].spans[0]).toMatchObject({ name: "llm", output: { text: "done" } });
    expect(dashboard.snapshot().status).toBe("ok");
  });
});
