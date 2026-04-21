import { boardFromString } from "../game/boardCodec";

/**
 * For history index `move` (>= 1), returns which cell was filled and with X or O.
 * @param {string[]} history
 * @param {number} move
 * @returns {{ index: number, symbol: 'X' | 'O' } | null}
 */
export function placementAtMove(history, move) {
  if (!history || move < 1 || move >= history.length) return null;
  const prev = boardFromString(history[move - 1]);
  const cur = boardFromString(history[move]);
  for (let i = 0; i < 9; i += 1) {
    if (prev[i] !== cur[i]) {
      const symbol = cur[i];
      if (symbol === "X" || symbol === "O") return { index: i, symbol };
      return null;
    }
  }
  return null;
}
