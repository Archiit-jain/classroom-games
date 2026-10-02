import type { BotStreamStep, SeededRng } from '@cg/game-sdk';
import { CANVAS_HEIGHT, CANVAS_WIDTH, type Op } from '../shared/types';

/*
 * Bot drawings (spec §12: 30–40 hand-authored templates). Each is an original
 * sketch built from simple shapes on the fixed 4096 × 3072 canvas and keyed by
 * a word in the pack. Bots only ever draw words that have a template.
 */

type P = [number, number];
export interface TemplateStroke {
  colour: number;
  size: number;
  points: P[];
}

// Palette indexes (see PALETTE) and brush sizes.
const INK = 0;
const WHITE = 1;
const GREY = 2;
const RED = 3;
const ORANGE = 4;
const YELLOW = 5;
const GREEN = 6;
const BLUE = 8;
const PINK = 10;
const BROWN = 11;
const THIN = 0;
const MID = 1;
const THICK = 2;

const rad = (deg: number) => (deg * Math.PI) / 180;
const rnd = (n: number) => Math.round(n);

/** Points on an ellipse arc from `from`° to `to`° (0° = right, clockwise on screen). */
function arc(cx: number, cy: number, r: number, from: number, to: number, ry = r, n = 24): P[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = rad(from + ((to - from) * i) / n);
    return [rnd(cx + r * Math.cos(a)), rnd(cy + ry * Math.sin(a))] as P;
  });
}
const circle = (cx: number, cy: number, r: number, ry = r) => arc(cx, cy, r, 0, 360, ry, 32);
const rect = (x: number, y: number, w: number, h: number): P[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
  [x, y],
];
const s = (colour: number, size: number, points: P[]): TemplateStroke => ({ colour, size, points });
/** Lines from a centre outwards (sun rays, whiskers …). */
const rays = (cx: number, cy: number, r1: number, r2: number, count: number, offset = 0) =>
  Array.from({ length: count }, (_, i) => {
    const a = rad(offset + (360 / count) * i);
    return [
      [rnd(cx + r1 * Math.cos(a)), rnd(cy + r1 * Math.sin(a))],
      [rnd(cx + r2 * Math.cos(a)), rnd(cy + r2 * Math.sin(a))],
    ] as P[];
  });
function star(cx: number, cy: number, r1: number, r2: number): P[] {
  const pts: P[] = [];
  for (let i = 0; i <= 10; i++) {
    const r = i % 2 === 0 ? r1 : r2;
    const a = rad(-90 + i * 36);
    pts.push([rnd(cx + r * Math.cos(a)), rnd(cy + r * Math.sin(a))]);
  }
  return pts;
}
function heart(cx: number, cy: number, k: number): P[] {
  return Array.from({ length: 41 }, (_, i) => {
    const t = (i / 40) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    return [rnd(cx + x * k), rnd(cy - y * k)] as P;
  });
}
function wave(x1: number, x2: number, y: number, amp: number, waves: number): P[] {
  return Array.from({ length: 33 }, (_, i) => {
    const x = x1 + ((x2 - x1) * i) / 32;
    return [rnd(x), rnd(y + amp * Math.sin((i / 32) * waves * Math.PI * 2))] as P;
  });
}

export const TEMPLATES: Record<string, TemplateStroke[]> = {
  sun: [
    s(ORANGE, THICK, circle(2048, 1536, 430)),
    ...rays(2048, 1536, 560, 860, 8).map((r) => s(YELLOW, THICK, r)),
  ],
  moon: [s(YELLOW, THICK, [...arc(2048, 1536, 700, 50, 310), ...arc(2330, 1536, 520, 230, 130)])],
  star: [s(YELLOW, THICK, star(2048, 1600, 900, 380))],
  house: [
    s(BROWN, MID, rect(1400, 1500, 1260, 1100)),
    s(RED, THICK, [
      [1250, 1560],
      [2030, 760],
      [2810, 1560],
    ]),
    s(BLUE, MID, rect(1900, 2050, 280, 550)),
    s(BLUE, MID, rect(1560, 1700, 240, 240)),
  ],
  tree: [
    s(BROWN, THICK, rect(1920, 1850, 260, 900)),
    s(GREEN, THICK, circle(2050, 1300, 650, 600)),
  ],
  flower: [
    s(GREEN, THICK, [
      [2048, 2850],
      [2048, 1700],
    ]),
    ...[0, 60, 120, 180, 240, 300].map((a) =>
      s(
        PINK,
        MID,
        circle(rnd(2048 + 300 * Math.cos(rad(a))), rnd(1400 + 300 * Math.sin(rad(a))), 190),
      ),
    ),
    s(YELLOW, THICK, circle(2048, 1400, 150)),
    s(GREEN, MID, [...arc(2300, 2300, 260, 180, 330, 140)]),
  ],
  fish: [
    s(ORANGE, THICK, circle(1950, 1536, 820, 460)),
    s(ORANGE, THICK, [
      [2720, 1536],
      [3300, 1080],
      [3300, 1990],
      [2720, 1536],
    ]),
    s(INK, THICK, circle(1450, 1420, 60)),
    s(ORANGE, MID, arc(1950, 1536, 380, 300, 420, 300, 10)),
  ],
  cat: [
    s(INK, MID, circle(2048, 1650, 650)),
    s(INK, MID, [
      [1580, 1260],
      [1660, 680],
      [1920, 1040],
    ]),
    s(INK, MID, [
      [2176, 1040],
      [2436, 680],
      [2516, 1260],
    ]),
    s(GREEN, THICK, circle(1810, 1550, 70)),
    s(GREEN, THICK, circle(2286, 1550, 70)),
    s(PINK, MID, [
      [1990, 1760],
      [2106, 1760],
      [2048, 1840],
      [1990, 1760],
    ]),
    ...[
      [
        [1900, 1880],
        [1250, 1780],
      ],
      [
        [1900, 1920],
        [1260, 2000],
      ],
      [
        [2196, 1880],
        [2846, 1780],
      ],
      [
        [2196, 1920],
        [2836, 2000],
      ],
    ].map((w) => s(INK, THIN, w as P[])),
  ],
  apple: [
    s(RED, THICK, circle(2048, 1720, 660, 620)),
    s(BROWN, THICK, [
      [2048, 1100],
      [2140, 760],
    ]),
    s(GREEN, MID, [
      [2140, 880],
      [2420, 720],
      [2560, 900],
      [2300, 1000],
      [2140, 880],
    ]),
  ],
  car: [
    s(BLUE, THICK, [
      [900, 1950],
      [900, 1520],
      [1420, 1500],
      [1720, 1100],
      [2620, 1100],
      [2960, 1500],
      [3220, 1520],
      [3220, 1950],
      [900, 1950],
    ]),
    s(INK, THICK, circle(1420, 1980, 260)),
    s(INK, THICK, circle(2700, 1980, 260)),
    s(BLUE, MID, [
      [1800, 1180],
      [1800, 1500],
      [2560, 1500],
      [2560, 1180],
    ]),
  ],
  boat: [
    s(BROWN, THICK, [
      [880, 1900],
      [3220, 1900],
      [2820, 2420],
      [1280, 2420],
      [880, 1900],
    ]),
    s(BROWN, MID, [
      [2048, 1900],
      [2048, 560],
    ]),
    s(RED, MID, [
      [2080, 640],
      [2080, 1760],
      [2940, 1760],
      [2080, 640],
    ]),
    s(BLUE, MID, wave(600, 3500, 2600, 70, 4)),
  ],
  kite: [
    s(PINK, THICK, [
      [2048, 480],
      [2720, 1320],
      [2048, 2220],
      [1380, 1320],
      [2048, 480],
    ]),
    s(PINK, THIN, [
      [2048, 480],
      [2048, 2220],
    ]),
    s(PINK, THIN, [
      [1380, 1320],
      [2720, 1320],
    ]),
    s(
      INK,
      THIN,
      wave(2048, 2700, 2500, 120, 2).map(([x, y]) => [x, y + (x - 2048) / 3] as P),
    ),
  ],
  umbrella: [
    s(RED, THICK, arc(2048, 1500, 1000, 180, 360, 760)),
    s(RED, MID, [
      [1048, 1500],
      [3048, 1500],
    ]),
    s(INK, THICK, [[2048, 740], [2048, 2450], ...arc(1880, 2450, 168, 0, 180, 150, 10)]),
  ],
  cloud: [
    s(BLUE, THICK, [
      ...arc(1500, 1700, 400, 90, 270),
      ...arc(1900, 1250, 470, 190, 330),
      ...arc(2550, 1350, 430, 220, 360),
      ...arc(2750, 1750, 360, 270, 450),
      [1500, 2100],
    ]),
  ],
  heart: [s(RED, THICK, heart(2048, 1450, 52))],
  ball: [
    s(RED, THICK, circle(2048, 1536, 760)),
    s(WHITE, THICK, arc(2048, 1536, 760, 200, 340, 260, 16)),
    s(WHITE, THICK, arc(2048, 1536, 760, 20, 160, 260, 16)),
  ],
  balloon: [
    s(RED, THICK, circle(2048, 1200, 560, 700)),
    s(RED, MID, [
      [1980, 1960],
      [2048, 1900],
      [2116, 1960],
      [1980, 1960],
    ]),
    s(
      INK,
      THIN,
      wave(1960, 2140, 2400, 0, 1).map(
        (_, i) => [rnd(2048 + 90 * Math.sin(i / 3)), rnd(1960 + i * 30)] as P,
      ),
    ),
  ],
  cup: [
    s(BLUE, THICK, [
      [1450, 1100],
      [1550, 2400],
      [2550, 2400],
      [2650, 1100],
      [1450, 1100],
    ]),
    s(BLUE, THICK, arc(2700, 1650, 360, 270, 450, 420, 16)),
    s(
      GREY,
      THIN,
      wave(1750, 1750, 800, 0, 1).map(
        (_, i) => [rnd(1800 + 80 * Math.sin(i / 3)), 950 - i * 18] as P,
      ),
    ),
    s(
      GREY,
      THIN,
      wave(2300, 2300, 800, 0, 1).map(
        (_, i) => [rnd(2300 + 80 * Math.sin(i / 3)), 950 - i * 18] as P,
      ),
    ),
  ],
  book: [
    s(BROWN, THICK, [
      [2048, 900],
      [1100, 760],
      [1100, 2300],
      [2048, 2440],
      [2996, 2300],
      [2996, 760],
      [2048, 900],
      [2048, 2440],
    ]),
    ...[1150, 1350, 1550, 1750].map((y) =>
      s(GREY, THIN, [
        [1300, y],
        [1850, y + 60],
      ] as P[]),
    ),
    ...[1150, 1350, 1550, 1750].map((y) =>
      s(GREY, THIN, [
        [2246, y + 60],
        [2796, y],
      ] as P[]),
    ),
  ],
  clock: [
    s(INK, THICK, circle(2048, 1536, 820)),
    ...rays(2048, 1536, 680, 780, 12).map((r) => s(INK, THIN, r)),
    s(RED, THICK, [
      [2048, 1536],
      [2048, 1000],
    ]),
    s(INK, THICK, [
      [2048, 1536],
      [2450, 1700],
    ]),
  ],
  key: [
    s(YELLOW, THICK, circle(1300, 1536, 380)),
    s(YELLOW, THICK, [
      [1680, 1536],
      [3150, 1536],
      [3150, 1850],
      [2900, 1850],
      [2900, 1536],
      [2650, 1536],
      [2650, 1780],
    ]),
  ],
  ladder: [
    s(BROWN, THICK, [
      [1550, 2900],
      [1700, 300],
    ]),
    s(BROWN, THICK, [
      [2550, 2900],
      [2400, 300],
    ]),
    ...[2550, 2150, 1750, 1350, 950, 600].map((y) => {
      const t = (2900 - y) / 2600;
      return s(BROWN, MID, [
        [rnd(1550 + 150 * t), y],
        [rnd(2550 - 150 * t), y],
      ] as P[]);
    }),
  ],
  snowman: [
    s(INK, MID, circle(2048, 2300, 620)),
    s(INK, MID, circle(2048, 1350, 440)),
    s(INK, MID, circle(2048, 680, 300)),
    s(INK, THICK, circle(1960, 620, 30)),
    s(INK, THICK, circle(2136, 620, 30)),
    s(ORANGE, MID, [
      [2048, 720],
      [2300, 780],
      [2048, 800],
    ]),
    s(BROWN, MID, [
      [1640, 1300],
      [1100, 1000],
    ]),
    s(BROWN, MID, [
      [2456, 1300],
      [2996, 1000],
    ]),
  ],
  spider: [
    s(INK, THICK, circle(2048, 1700, 420, 480)),
    s(INK, THICK, circle(2048, 1080, 240)),
    ...[-1, 1].flatMap((side) =>
      [1450, 1650, 1850, 2050].map((y, i) =>
        s(INK, MID, [
          [2048 + side * 380, y],
          [2048 + side * (800 + i * 60), y - 300],
          [2048 + side * (1150 + i * 60), y + 250],
        ] as P[]),
      ),
    ),
  ],
  snake: [
    s(GREEN, THICK, wave(700, 3100, 1700, 380, 2)),
    s(GREEN, THICK, circle(3200, 1700, 170)),
    s(RED, THIN, [
      [3370, 1700],
      [3600, 1700],
      [3680, 1630],
      [3600, 1700],
      [3680, 1770],
    ]),
  ],
  egg: [s(ORANGE, THICK, circle(2048, 1600, 560, 760))],
  mountain: [
    s(GREY, THICK, [
      [300, 2700],
      [1400, 900],
      [2000, 1700],
      [2700, 600],
      [3800, 2700],
      [300, 2700],
    ]),
    s(BLUE, MID, [
      [2440, 1000],
      [2700, 600],
      [2960, 1000],
      [2800, 1080],
      [2700, 950],
      [2580, 1080],
      [2440, 1000],
    ]),
  ],
  rainbow: [
    s(RED, THICK, arc(2048, 2500, 1500, 180, 360, 1400)),
    s(YELLOW, THICK, arc(2048, 2500, 1320, 180, 360, 1220)),
    s(GREEN, THICK, arc(2048, 2500, 1140, 180, 360, 1040)),
    s(BLUE, THICK, arc(2048, 2500, 960, 180, 360, 860)),
  ],
  pencil: [
    s(YELLOW, THICK, [
      [900, 2100],
      [2900, 900],
      [3150, 1300],
      [1150, 2500],
      [900, 2100],
    ]),
    s(BROWN, MID, [
      [900, 2100],
      [600, 2600],
      [1150, 2500],
    ]),
    s(PINK, THICK, [
      [2900, 900],
      [3150, 750],
      [3400, 1150],
      [3150, 1300],
    ]),
  ],
  glasses: [
    s(INK, THICK, circle(1450, 1600, 450, 380)),
    s(INK, THICK, circle(2650, 1600, 450, 380)),
    s(INK, MID, arc(2048, 1560, 160, 200, 340, 120, 10)),
    s(INK, MID, [
      [1000, 1520],
      [600, 1300],
    ]),
    s(INK, MID, [
      [3100, 1520],
      [3500, 1300],
    ]),
  ],
  cake: [
    s(PINK, THICK, rect(1150, 1500, 1800, 1000)),
    s(WHITE, MID, wave(1150, 2950, 1700, 80, 5)),
    s(BLUE, MID, [
      [2048, 1500],
      [2048, 1050],
    ]),
    s(ORANGE, MID, [
      [2048, 1050],
      [1980, 950],
      [2048, 800],
      [2116, 950],
      [2048, 1050],
    ]),
  ],
  lollipop: [
    s(
      PINK,
      THICK,
      Array.from({ length: 60 }, (_, i) => {
        const a = (i / 60) * Math.PI * 6;
        const r = 40 + i * 9;
        return [rnd(2048 + r * Math.cos(a)), rnd(1200 + r * Math.sin(a))] as P;
      }),
    ),
    s(GREY, THICK, [
      [2048, 1760],
      [2048, 2900],
    ]),
  ],
  mushroom: [
    s(RED, THICK, [...arc(2048, 1500, 1000, 180, 360, 800), [1048, 1500]]),
    s(BROWN, THICK, [
      [1750, 1500],
      [1700, 2600],
      [2400, 2600],
      [2350, 1500],
    ]),
    s(WHITE, THICK, circle(1700, 1100, 110)),
    s(WHITE, THICK, circle(2300, 1000, 130)),
  ],
  tent: [
    s(ORANGE, THICK, [
      [600, 2500],
      [2048, 500],
      [3500, 2500],
      [600, 2500],
    ]),
    s(ORANGE, MID, [
      [2048, 500],
      [1750, 2500],
    ]),
    s(ORANGE, MID, [
      [2048, 500],
      [2350, 2500],
    ]),
    s(GREEN, MID, [
      [300, 2550],
      [3800, 2550],
    ]),
  ],
  door: [
    s(BROWN, THICK, rect(1500, 500, 1100, 2300)),
    s(YELLOW, THICK, circle(2400, 1700, 70)),
    s(BROWN, THIN, rect(1650, 700, 800, 700)),
    s(BROWN, THIN, rect(1650, 1900, 800, 700)),
  ],
  candle: [
    s(PINK, THICK, rect(1800, 1300, 500, 1500)),
    s(INK, MID, [
      [2050, 1300],
      [2050, 1100],
    ]),
    s(ORANGE, MID, [
      [2050, 1120],
      [1950, 950],
      [2050, 650],
      [2150, 950],
      [2050, 1120],
    ]),
  ],
};

export const TEMPLATE_WORDS = Object.keys(TEMPLATES);

const clampX = (x: number) => Math.min(CANVAS_WIDTH - 1, Math.max(0, Math.round(x)));
const clampY = (y: number) => Math.min(CANVAS_HEIGHT - 1, Math.max(0, Math.round(y)));

/** Adds points along long segments so the pen moves smoothly (≤ `step` units apart). */
function densify(points: P[], step = 90): P[] {
  const out: P[] = [];
  points.forEach((p, i) => {
    const prev = points[i - 1];
    if (prev) {
      const d = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      const n = Math.floor(d / step);
      for (let k = 1; k < n; k++) {
        out.push([prev[0] + ((p[0] - prev[0]) * k) / n, prev[1] + ((p[1] - prev[1]) * k) / n]);
      }
    }
    out.push(p);
  });
  return out;
}

/**
 * Turns a template into a timed stream plan: jittered, densified points split into
 * chunks of ≤ 40 points, spread over `durationMs` (spec §12: 20–40 s with jitter).
 */
export function planDrawing(
  template: readonly TemplateStroke[],
  rng: SeededRng,
  durationMs: number,
): BotStreamStep[] {
  const strokes = template.map((stroke) => ({
    ...stroke,
    points: densify(stroke.points).map(([x, y]) => [
      clampX(x + rng.int(-22, 22)),
      clampY(y + rng.int(-22, 22)),
    ]) as P[],
  }));
  const total = strokes.reduce((n, st) => n + st.points.length, 0) || 1;
  const steps: BotStreamStep[] = [];
  strokes.forEach((stroke, id) => {
    for (let i = 0; i < stroke.points.length; i += 40) {
      const part = stroke.points.slice(i, i + 40);
      const chunk: Op = {
        op: 'stroke',
        id,
        tool: 'pen',
        colour: stroke.colour,
        size: stroke.size,
        points: part.flat(),
      };
      const pause = i === 0 ? rng.int(150, 500) : 0;
      steps.push({ delayMs: Math.round((durationMs * part.length) / total) + pause, chunk });
    }
  });
  return steps;
}
