import type { Room } from './types';

/**
 * Where rooms live. v1 keeps them in process memory; the interface exists so
 * a shared store can replace it when the server scales past one instance
 * (see docs/decisions/ADR-005).
 */
export interface RoomStore {
  get(id: string): Room | undefined;
  getByCode(code: string): Room | undefined;
  hasCode(code: string): boolean;
  add(room: Room): void;
  remove(id: string): void;
  all(): Room[];
  count(): number;
}

export class InMemoryRoomStore implements RoomStore {
  private readonly byId = new Map<string, Room>();
  private readonly byCode = new Map<string, Room>();

  get(id: string): Room | undefined {
    return this.byId.get(id);
  }

  getByCode(code: string): Room | undefined {
    return this.byCode.get(code);
  }

  hasCode(code: string): boolean {
    return this.byCode.has(code);
  }

  add(room: Room): void {
    this.byId.set(room.id, room);
    if (room.code) this.byCode.set(room.code, room);
  }

  remove(id: string): void {
    const room = this.byId.get(id);
    if (!room) return;
    this.byId.delete(id);
    if (room.code) this.byCode.delete(room.code);
  }

  all(): Room[] {
    return [...this.byId.values()];
  }

  count(): number {
    return this.byId.size;
  }
}
