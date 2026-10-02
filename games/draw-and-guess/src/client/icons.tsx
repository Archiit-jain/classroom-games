const OUT = '#07041a';

interface IconProps {
  size?: number;
}

/** Game icon: a pencil scribbling on a sheet, with a "?" bubble. */
export function DrawIcon({ size = 40 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <g stroke={OUT} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round">
        <rect x={5} y={12} width={30} height={30} rx={4} fill="#fff7e3" />
        <path d="M10 33c4-8 7 4 11-3s6-2 9-6" fill="none" stroke="#4c8dff" strokeWidth={3} />
        <path
          d="M27 6h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-5 4v-4h-2a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"
          fill="#2de2e6"
        />
        <path d="M32.5 10.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5" fill="none" strokeWidth={2} />
        <path d="M33 37l9-9 4 4-9 9-5 1z" fill="#ffd23f" />
        <path d="M42 28l2-2a2 2 0 0 1 3 0l1 1a2 2 0 0 1 0 3l-2 2" fill="#ff7eb6" />
      </g>
      <circle cx={35} cy={16.8} r={1.4} fill={OUT} />
    </svg>
  );
}

/** The drawer's pencil badge. */
export function PencilIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g stroke={OUT} strokeWidth={2} strokeLinejoin="round">
        <path d="M4 16L15 5l4 4L8 20l-5 1z" fill="#ffd23f" />
        <path d="M15 5l2-2a1.5 1.5 0 0 1 2 0l2 2a1.5 1.5 0 0 1 0 2l-2 2" fill="#ff7eb6" />
        <path d="M4 16l4 4" fill="none" />
      </g>
    </svg>
  );
}

export function CheckIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx={12} cy={12} r={10} fill="#3ec46d" stroke={OUT} strokeWidth={2} />
      <path
        d="M7 12.5l3.2 3.2L17 9"
        fill="none"
        stroke="#fff"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EraserIcon({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">
        <path d="M14 4l6 6-9 9H6l-3-3z" fill="#ff7eb6" />
        <path d="M8.5 9.5l6 6" fill="none" />
        <path d="M11 19h9" fill="none" />
      </g>
    </svg>
  );
}

export function UndoIcon({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M9 6L4 11l5 5M4 11h10a6 6 0 0 1 0 12h-3"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(0 -3)"
      />
    </svg>
  );
}

export function TrashIcon({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
      </g>
    </svg>
  );
}

export function EyeIcon({ size = 18, off = false }: IconProps & { off?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
        <circle cx={12} cy={12} r={3} />
        {off && <path d="M4 20L20 4" />}
      </g>
    </svg>
  );
}

export function FlagIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
      </g>
    </svg>
  );
}
