import type { Category } from '../shared';

const OUT = '#07041a';

/** Game icon: a worksheet with a stamped letter and ruled lines. */
export function NpatIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect
        x={6}
        y={3}
        width={36}
        height={42}
        rx={6}
        fill="#fdfcff"
        stroke={OUT}
        strokeWidth={2.5}
      />
      <g stroke="#8fb7e8" strokeWidth={2} strokeLinecap="round">
        <path d="M13 27h22M13 33h22M13 39h15" />
      </g>
      <path d="M11 6v36" stroke="#ff7a59" strokeWidth={1.6} />
      <circle cx={24} cy={15} r={8.5} fill="#ff8a1f" stroke={OUT} strokeWidth={2.2} />
      <text
        x={24}
        y={19.5}
        textAnchor="middle"
        fontSize={12}
        fontWeight={900}
        fontFamily="system-ui, sans-serif"
        fill={OUT}
      >
        A
      </text>
    </svg>
  );
}

const PATHS: Record<Category, string> = {
  // A person
  name: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-3.9 3.1-6 7-6s7 2.1 7 6',
  // A map pin
  place:
    'M12 21s-6-5.6-6-10.5A6 6 0 0 1 18 10.5C18 15.4 12 21 12 21Zm0-8.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  // A paw
  animal:
    'M8 9.5a1.8 2.3 0 1 0 0-.1M16 9.5a1.8 2.3 0 1 0 0-.1M5 13.5a1.6 2 0 1 0 0-.1M19 13.5a1.6 2 0 1 0 0-.1M12 13c-3 0-5 3.6-5 5.4 0 1.6 1.6 2.1 5 2.1s5-.5 5-2.1C17 16.6 15 13 12 13Z',
  // A box
  thing: 'M4 8l8-4 8 4v8l-8 4-8-4V8Zm0 0 8 4 8-4M12 12v8',
};

export function CategoryIcon({ category, size = 22 }: { category: Category; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[category]} />
    </svg>
  );
}

export function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M5 12.5l4.5 4.5L19 7"
        fill="none"
        stroke="currentColor"
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CrossIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M6 6l12 12M18 6 6 18"
        fill="none"
        stroke="currentColor"
        strokeWidth={3.2}
        strokeLinecap="round"
      />
    </svg>
  );
}
