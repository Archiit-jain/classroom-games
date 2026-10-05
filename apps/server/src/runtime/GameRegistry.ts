import type { AnyGameModule } from '@cg/game-sdk';
import type { GameInfo } from '@cg/protocol';

/** gameId → GameModule. Every registration is checked for an internally consistent manifest. */
export class GameRegistry {
  private readonly games = new Map<string, AnyGameModule>();

  register(game: AnyGameModule): this {
    const { id, players, sync, publicMatch } = game.manifest;
    if (!/^[a-z0-9-]{2,32}$/.test(id)) throw new Error(`Invalid game id "${id}"`);
    if (this.games.has(id)) throw new Error(`Game "${id}" is already registered`);
    if (players.min < 1 || players.max < players.min)
      throw new Error(`Game "${id}": bad player range`);
    if (publicMatch.targetPlayers < players.min || publicMatch.targetPlayers > players.max) {
      throw new Error(`Game "${id}": publicMatch.targetPlayers outside the player range`);
    }
    // A public match never starts with one human, and never needs more humans than its target.
    if (publicMatch.minHumans < 2 || publicMatch.minHumans > publicMatch.targetPlayers) {
      throw new Error(`Game "${id}": publicMatch.minHumans must be 2…targetPlayers`);
    }
    if (publicMatch.enabled && !game.manifest.bots.supported) {
      throw new Error(`Game "${id}": public play needs bots to fill empty seats`);
    }
    if (sync === 'STREAMED' && !game.stream)
      throw new Error(`Game "${id}" is STREAMED but has no stream module`);
    const defaults = game.settingsSchema.safeParse(game.defaultSettings);
    if (!defaults.success) throw new Error(`Game "${id}": defaultSettings fail its own schema`);
    this.games.set(id, game);
    return this;
  }

  get(id: string): AnyGameModule | undefined {
    return this.games.get(id);
  }

  infos(): GameInfo[] {
    return [...this.games.values()].map((g) => ({
      id: g.manifest.id,
      minPlayers: g.manifest.players.min,
      maxPlayers: g.manifest.players.max,
      supportsBots: g.manifest.bots.supported,
      defaultSettings: g.defaultSettings,
      publicMatch: { ...g.manifest.publicMatch },
    }));
  }

  /** Games offered in public play, in catalogue (registration) order. */
  publicGames(): AnyGameModule[] {
    return [...this.games.values()].filter((g) => g.manifest.publicMatch.enabled);
  }
}
