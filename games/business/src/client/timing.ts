/** Client hop time, a little under the server's hold per hop (140 ms) so the board never lags. */
export const HOP_MS = { full: 130, lite: 70, reduced: 0 } as const;
