import { gameStyles } from "../ui/gameStyles";

export default function Square({ value, onClick, isWinningSquare, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        ...gameStyles.square,
        color: value === "X" ? "#3b82f6" : "#ef4444",
        backgroundColor: isWinningSquare ? "#fefce8" : "#fff",
        borderColor: isWinningSquare ? "#facc15" : "#e2e8f0",
        opacity: disabled && !value ? 0.55 : 1,
        cursor: disabled && !value ? "default" : "pointer",
      }}
    >
      {value}
    </button>
  );
}
