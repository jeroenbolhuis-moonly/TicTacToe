import { WINNING_LINES } from "./constants";

export function calculateWinner(squares) {
  for (const [a, b, c] of WINNING_LINES) {
    if (
      squares[a] &&
      squares[a] === squares[b] &&
      squares[a] === squares[c]
    ) {
      return { winner: squares[a], line: [a, b, c] };
    }
  }
  return null;
}

export function xIsNextForMove(currentMove) {
  return currentMove % 2 === 0;
}
