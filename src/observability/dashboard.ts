import type { AlertEngine, Alert } from "./alerts.js";
import type { MetricsRegistry } from "./metrics.js";
import type { Tracer } from "./tracer.js";

export class Dashboard {
  constructor(
    private readonly metrics: MetricsRegistry,
    private readonly tracer?: Tracer,
    private readonly alertEngine?: AlertEngine,
  ) {}

  snapshot(): {
    status: "ok" | "alert";
    timestamp: Date;
    metrics: ReturnType<MetricsRegistry["snapshot"]>;
    traces: ReturnType<Tracer["getLocalTraces"]>;
    alerts: Alert[];
  } {
    const alerts = this.alertEngine?.evaluate() ?? [];
    return {
      status: alerts.length > 0 ? "alert" : "ok",
      timestamp: new Date(),
      metrics: this.metrics.snapshot(),
      traces: this.tracer?.getLocalTraces() ?? [],
      alerts,
    };
  }
}
