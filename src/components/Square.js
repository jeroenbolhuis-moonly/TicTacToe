export default function Square({
  value,
  onClick,
  isWinningSquare,
  disabled,
  squareBaseStyle,
  colors,
}) {
  const c = colors;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        ...squareBaseStyle,
        color: value === "X" ? c.pieceX : value === "O" ? c.pieceO : c.textMuted,
        backgroundColor: isWinningSquare ? c.winSquareBg : c.squareBg,
        borderColor: isWinningSquare ? c.winSquareBorder : c.squareBorder,
        opacity: disabled && !value ? 0.55 : 1,
        cursor: disabled && !value ? "default" : "pointer",
      }}
    >
      {value}
    </button>
  );
}
