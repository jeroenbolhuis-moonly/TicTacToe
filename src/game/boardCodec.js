/** Firestore-friendly board: 9 chars, '.' = empty */
export function boardFromString(s) {
  if (!s || s.length !== 9) return Array(9).fill(null);
  return s.split("").map((c) => (c === "." ? null : c));
}

export function stringFromBoard(board) {
  return board.map((c) => (c == null ? "." : c)).join("");
}
