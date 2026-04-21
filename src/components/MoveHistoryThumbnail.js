import { boardFromString } from "../game/boardCodec";
import { placementAtMove } from "../lib/placementAtMove";

const GRID = 3;
const GAP = 1;

/**
 * @param {object} props
 * @param {string[]} props.history
 * @param {number} props.moveIndex
 * @param {{ pieceX: string; pieceO: string; border: string; muted: string; cellBg: string }} props.colors
 */
export default function MoveHistoryThumbnail({ history, moveIndex, colors }) {
  const board = boardFromString(history[moveIndex] ?? "");
  const placement = moveIndex > 0 ? placementAtMove(history, moveIndex) : null;

  const cells = [];
  for (let i = 0; i < 9; i += 1) {
    const v = board[i];
    const isNew = placement && placement.index === i;
    const opacity =
      v && !isNew ? 0.38 : 1;
    const color =
      v === "X"
        ? colors.pieceX
        : v === "O"
          ? colors.pieceO
          : "transparent";
    cells.push(
      <div
        key={i}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "7px",
          fontWeight: 800,
          color,
          opacity: v ? opacity : 1,
          backgroundColor: colors.cellBg,
          border: `1px solid ${colors.border}`,
          borderRadius: "2px",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        {v ?? ""}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${GRID}, 10px)`,
        gridTemplateRows: `repeat(${GRID}, 10px)`,
        gap: `${GAP}px`,
      }}
    >
      {cells}
    </div>
  );
}
