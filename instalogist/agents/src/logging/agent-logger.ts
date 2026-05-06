export type AgentLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AgentLogEvent {
  ts: string;
  level: AgentLogLevel;
  scope: string;
  message: string;
  data?: Record<string, unknown>;
}

export type AgentLogSink = (event: AgentLogEvent) => void;

export class AgentLogger {
  constructor(
    private readonly scope: string,
    private readonly sink: AgentLogSink = consoleSink
  ) {}

  debug(message: string, data?: Record<string, unknown>): void {
    this.emit('debug', message, data);
  }
  info(message: string, data?: Record<string, unknown>): void {
    this.emit('info', message, data);
  }
  warn(message: string, data?: Record<string, unknown>): void {
    this.emit('warn', message, data);
  }
  error(message: string, data?: Record<string, unknown>): void {
    this.emit('error', message, data);
  }

  private emit(level: AgentLogLevel, message: string, data?: Record<string, unknown>): void {
    this.sink({
      ts: new Date().toISOString(),
      level,
      scope: this.scope,
      message,
      data
    });
  }
}

function consoleSink(e: AgentLogEvent): void {
  const line = `[${e.ts}] [${e.level}] [${e.scope}] ${e.message}`;
  if (e.level === 'error') console.error(line, e.data ?? '');
  else if (e.level === 'warn') console.warn(line, e.data ?? '');
  else console.log(line, e.data ?? '');
}
