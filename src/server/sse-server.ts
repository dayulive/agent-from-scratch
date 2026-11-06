import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import type { AgentEvent } from "../core/streaming/event-emitter.js";

interface Connection {
  reply: FastifyReply;
  heartbeat: NodeJS.Timeout;
  broadcast: boolean;
}

export class SSEConnectionManager {
  private readonly connections = new Map<string, Connection>();

  constructor(private readonly options: { heartbeatMs?: number } = {}) {}

  connect(reply: FastifyReply, options: { broadcast?: boolean } = {}): string {
    const id = randomUUID();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ id })}\n\n`);
    const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), this.options.heartbeatMs ?? 15_000);
    heartbeat.unref();
    this.connections.set(id, { reply, heartbeat, broadcast: options.broadcast ?? true });
    reply.raw.once("close", () => this.cleanup(id));
    return id;
  }

  send(id: string, event: AgentEvent): boolean {
    const connection = this.connections.get(id);
    if (!connection) return false;
    connection.reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    return true;
  }

  broadcast(event: AgentEvent): void {
    for (const [id, connection] of this.connections) {
      if (connection.broadcast) this.send(id, event);
    }
  }

  disconnect(id: string): void {
    const connection = this.connections.get(id);
    if (!connection) return;
    this.cleanup(id);
    if (!connection.reply.raw.writableEnded) connection.reply.raw.end();
  }

  close(): void {
    for (const id of [...this.connections.keys()]) this.disconnect(id);
  }

  get size(): number {
    return this.connections.size;
  }

  private cleanup(id: string): void {
    const connection = this.connections.get(id);
    if (!connection) return;
    clearInterval(connection.heartbeat);
    this.connections.delete(id);
  }
}
