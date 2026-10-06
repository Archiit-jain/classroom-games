import { monitorEventLoopDelay } from 'node:perf_hooks';

/**
 * This process's resource use, for the operator-only metrics endpoint (Phase 10 §20).
 * The event-loop delay histogram is Node's own sampler (one timer, negligible cost).
 */
let loop: ReturnType<typeof monitorEventLoopDelay> | null = null;
const startedAt = Date.now();

export interface ProcessStats {
  uptimeS: number;
  rssMb: number;
  heapUsedMb: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  /** Event-loop delay since the last read (ms): how long work waited for the CPU. */
  loopDelayMeanMs: number;
  loopDelayP99Ms: number;
  loopDelayMaxMs: number;
}

const mb = (bytes: number) => Math.round((bytes / 1_048_576) * 10) / 10;
const ms = (ns: number) => Math.round((ns / 1e6) * 10) / 10;

export function processStats(): ProcessStats {
  if (!loop) {
    loop = monitorEventLoopDelay({ resolution: 20 });
    loop.enable();
  }
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  const stats: ProcessStats = {
    uptimeS: Math.round((Date.now() - startedAt) / 1000),
    rssMb: mb(memory.rss),
    heapUsedMb: mb(memory.heapUsed),
    cpuUserMs: Math.round(cpu.user / 1000),
    cpuSystemMs: Math.round(cpu.system / 1000),
    loopDelayMeanMs: Number.isFinite(loop.mean) ? ms(loop.mean) : 0,
    loopDelayP99Ms: ms(loop.percentile(99)),
    loopDelayMaxMs: ms(loop.max),
  };
  loop.reset();
  return stats;
}
