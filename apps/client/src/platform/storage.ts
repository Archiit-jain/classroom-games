/** Storage access that never throws (private mode, blocked site data, etc.). */
function safe(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export const storage = {
  get(key: string, kind: 'local' | 'session' = 'local'): string | null {
    try {
      return safe(kind)?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key: string, value: string, kind: 'local' | 'session' = 'local'): void {
    try {
      safe(kind)?.setItem(key, value);
    } catch {
      /* storage unavailable: the app still works, it just won't remember */
    }
  },
};

export const KEYS = {
  token: 'cg.token',
  nickname: 'cg.nickname',
  hidden: 'cg.hiddenPlayers',
} as const;
