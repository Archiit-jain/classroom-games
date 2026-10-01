import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useEffects } from '../effects';

export interface CountdownRingProps {
  /** Server timestamp when the countdown ends. */
  deadline: number;
  totalMs: number;
  msUntil(serverTs: number): number;
  size?: number;
  stroke?: number;
  color?: string;
  urgentMs?: number;
  showSeconds?: boolean;
  children?: ReactNode;
}

/** Circular countdown driven by a server deadline. Turns pink when time is nearly up. */
export function CountdownRing({
  deadline,
  totalMs,
  msUntil,
  size = 56,
  stroke = 5,
  color,
  urgentMs = 5000,
  showSeconds = true,
  children,
}: CountdownRingProps) {
  const mode = useEffects();
  const barRef = useRef<SVGCircleElement>(null);
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil(msUntil(deadline) / 1000)));
  const [urgent, setUrgent] = useState(false);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    let raf = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      const left = Math.max(0, msUntil(deadline));
      const fraction = totalMs > 0 ? Math.min(1, left / totalMs) : 0;
      barRef.current?.setAttribute('stroke-dashoffset', String(circumference * (1 - fraction)));
      const s = Math.ceil(left / 1000);
      setSeconds((prev) => (prev === s ? prev : s));
      setUrgent(left > 0 && left <= urgentMs);
      return left > 0;
    };
    if (mode === 'full') {
      const loop = () => {
        if (tick()) raf = requestAnimationFrame(loop);
      };
      loop();
    } else {
      tick();
      interval = setInterval(() => {
        if (!tick() && interval) clearInterval(interval);
      }, 250);
    }
    return () => {
      cancelAnimationFrame(raf);
      if (interval) clearInterval(interval);
    };
  }, [deadline, totalMs, msUntil, circumference, urgentMs, mode]);

  return (
    <span
      className={urgent ? 'cb-ring cb-ring--urgent' : 'cb-ring'}
      style={{
        width: size,
        height: size,
        ...(color ? ({ '--ring-color': color } as CSSProperties) : {}),
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          className="cb-ring__track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
        />
        <circle
          ref={barRef}
          className="cb-ring__bar"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={0}
        />
      </svg>
      {children ?? (showSeconds && <span className="cb-ring__label">{seconds}</span>)}
    </span>
  );
}
