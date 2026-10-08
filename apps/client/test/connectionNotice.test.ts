import { describe, expect, it } from 'vitest';
import { connectionNotice } from '../src/platform/connectionNotice';

const base = {
  connection: 'connecting',
  slow: false,
  unreachable: false,
  serverRestarting: false,
  offline: false,
} as const;

describe('connection banner notice', () => {
  it('says nothing once connected', () => {
    expect(connectionNotice({ ...base, connection: 'connected' }, false)).toBeNull();
    expect(connectionNotice({ ...base, connection: 'connected' }, true)).toBeNull();
  });

  it('shows plain connecting / reconnecting before the slow threshold', () => {
    expect(connectionNotice(base, false)).toBe('connecting');
    expect(connectionNotice({ ...base, connection: 'reconnecting' }, true)).toBe('reconnecting');
  });

  it('in production: waking up first, then not responding after the wake-up window', () => {
    expect(connectionNotice({ ...base, slow: true }, false)).toBe('waking');
    expect(connectionNotice({ ...base, slow: true, unreachable: true }, false)).toBe('unreachable');
  });

  it('a lost connection says "reconnecting", never that the server is waking up (Phase 11)', () => {
    const lost = { ...base, connection: 'reconnecting' } as const;
    expect(connectionNotice({ ...lost, slow: true }, false)).toBe('reconnecting');
    expect(connectionNotice({ ...lost, slow: true, unreachable: true }, false)).toBe('unreachable');
  });

  it('says "offline" while the device has no network (airplane mode)', () => {
    expect(connectionNotice({ ...base, connection: 'reconnecting', offline: true }, false)).toBe(
      'offline',
    );
    expect(connectionNotice({ ...base, slow: true, unreachable: true, offline: true }, true)).toBe(
      'offline',
    );
    expect(connectionNotice({ ...base, connection: 'connected', offline: true }, false)).toBeNull();
  });

  it('in development: says the local server is not running instead of waking up', () => {
    expect(connectionNotice({ ...base, slow: true }, true)).toBe('devServerDown');
    expect(connectionNotice({ ...base, slow: true, unreachable: true }, true)).toBe(
      'devServerDown',
    );
  });

  it('keeps the displaced and restarting notices first', () => {
    expect(connectionNotice({ ...base, connection: 'displaced', slow: true }, true)).toBe(
      'displaced',
    );
    expect(connectionNotice({ ...base, serverRestarting: true, slow: true }, false)).toBe(
      'restarting',
    );
  });
});
