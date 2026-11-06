import { randomUUID } from "node:crypto";

export interface LocalSpan {
  id: string;
  name: string;
  startTime: Date;
  endTime?: Date;
  input?: unknown;
  output?: unknown;
}

export interface LocalTrace {
  id: string;
  name: string;
  startTime: Date;
  endTime?: Date;
  metadata?: Record<string, unknown>;
  output?: unknown;
  spans: LocalSpan[];
  exported?: boolean;
}

export class Tracer {
  private readonly traces = new Map<string, LocalTrace>();
  private langfuse: any;

  constructor(private readonly config: {
    publicKey?: string;
    secretKey?: string;
    baseUrl?: string;
    enabled?: boolean;
  } = {}) {}

  startTrace(name: string, metadata?: Record<string, unknown>): { id: string; end: (output?: unknown) => void } {
    const id = randomUUID();
    const trace: LocalTrace = { id, name, startTime: new Date(), metadata, spans: [] };
    this.traces.set(id, trace);
    return {
      id,
      end: output => {
        trace.output = output;
        trace.endTime = new Date();
      },
    };
  }

  startSpan(traceId: string, name: string, input?: unknown): { id: string; end: (output?: unknown) => void } {
    const trace = this.traces.get(traceId);
    if (!trace) throw new Error(`Trace ${traceId} 不存在`);
    const span: LocalSpan = { id: randomUUID(), name, startTime: new Date(), input };
    trace.spans.push(span);
    return {
      id: span.id,
      end: output => {
        span.output = output;
        span.endTime = new Date();
      },
    };
  }

  getLocalTraces(): LocalTrace[] {
    return [...this.traces.values()].map(trace => ({ ...trace, spans: trace.spans.map(span => ({ ...span })) }));
  }

  async flush(): Promise<void> {
    if (this.config.enabled === false) return;
    if (!this.config.publicKey || !this.config.secretKey) return;
    if (!this.langfuse) {
      const { Langfuse } = await import("langfuse");
      this.langfuse = new Langfuse({
        publicKey: this.config.publicKey,
        secretKey: this.config.secretKey,
        baseUrl: this.config.baseUrl,
      });
    }
    for (const trace of this.traces.values()) {
      if (trace.exported || !trace.endTime) continue;
      const remoteTrace = this.langfuse.trace({
        id: trace.id,
        name: trace.name,
        timestamp: trace.startTime,
        metadata: trace.metadata,
        output: trace.output,
      });
      for (const span of trace.spans) {
        const remoteSpan = remoteTrace.span({
          id: span.id,
          name: span.name,
          startTime: span.startTime,
          endTime: span.endTime,
          input: span.input,
          output: span.output,
        });
        remoteSpan.end({ endTime: span.endTime, output: span.output });
      }
      remoteTrace.update({ output: trace.output });
      trace.exported = true;
    }
    await this.langfuse.flushAsync();
  }

  async close(): Promise<void> {
    await this.flush();
    if (this.langfuse) await this.langfuse.shutdownAsync();
  }
}
