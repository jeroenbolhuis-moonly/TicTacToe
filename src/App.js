import { useCallback, useEffect, useMemo, useState } from "react";
import Square from "./components/Square";
import Lobby from "./components/Lobby";
import MoveHistoryThumbnail from "./components/MoveHistoryThumbnail";
import { isFirebaseConfigured } from "./firebase";
import { calculateWinner } from "./game/logic";
import { useSharedGame } from "./hooks/useSharedGame";
import { usePrefersDark } from "./hooks/usePrefersDark";
import { isValidRoomCode } from "./lib/roomCode";
import { placementAtMove } from "./lib/placementAtMove";
import { createGameStyles } from "./ui/gameStyles";

const ROOM_STORAGE_KEY = "ttt-private-room-code";

function readStoredRoomCode() {
  try {
    const raw = sessionStorage.getItem(ROOM_STORAGE_KEY);
    if (raw && isValidRoomCode(raw)) return raw;
  } catch {
    /* ignore */
  }
  return null;
}

function persistRoomCode(code) {
  try {
    if (code) sessionStorage.setItem(ROOM_STORAGE_KEY, code);
    else sessionStorage.removeItem(ROOM_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function buildStatus({
  matchEnded,
  endedReason,
  matchWinner,
  winner,
  isDraw,
  xIsNext,
}) {
  if (matchEnded) {
    if (matchWinner === "draw") {
      return endedReason === "disconnect"
        ? "Draw — both players disconnected"
        : "Draw";
    }
    if (winner) {
      if (endedReason === "forfeit") return `Winner: ${winner} (opponent left)`;
      if (endedReason === "disconnect")
        return `Winner: ${winner} (opponent disconnected)`;
      return `Winner: ${winner}`;
    }
  }
  if (isDraw) return "Draw";
  if (winner) return `Winner: ${winner}`;
  return `Next: ${xIsNext ? "X" : "O"}`;
}

/** @param {{ styles: ReturnType<typeof createGameStyles> }} props */
function ConfigHint({ styles }) {
  const c = styles.colors;
  return (
    <div style={styles.container}>
      <div style={styles.errorBox}>
        <strong>Firebase is not configured.</strong>
        <p style={{ margin: "12px 0 0", fontWeight: 500 }}>
          Create a <code style={{ color: c.textMuted }}>.env</code> file in the
          project root with <code style={{ color: c.textMuted }}>REACT_APP_FIREBASE_*</code>{" "}
          keys from your Firebase project (Web app config), enable Firestore,
          then restart <code style={{ color: c.textMuted }}>npm start</code>.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const isDark = usePrefersDark();
  const styles = useMemo(() => createGameStyles(isDark), [isDark]);

  if (!isFirebaseConfigured()) {
    return <ConfigHint styles={styles} />;
  }

  return <MultiplayerApp styles={styles} />;
}

/** @param {{ styles: ReturnType<typeof createGameStyles> }} props */
function MultiplayerApp({ styles }) {
  const [roomCode, setRoomCode] = useState(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setRoomCode(readStoredRoomCode());
    setHydrated(true);
  }, []);

  const enterRoom = useCallback((code) => {
    setRoomCode(code);
    persistRoomCode(code);
  }, []);

  const leaveRoom = useCallback(() => {
    setRoomCode(null);
    persistRoomCode(null);
  }, []);

  if (!hydrated) {
    return (
      <div style={styles.container}>
        <p style={{ color: styles.colors.textMuted, fontWeight: 600 }}>
          Loading…
        </p>
      </div>
    );
  }

  if (!roomCode) {
    return <Lobby styles={styles} onEnterRoom={enterRoom} />;
  }

  return (
    <GameScreen styles={styles} roomCode={roomCode} onLeaveRoom={leaveRoom} />
  );
}

/** @param {{ styles: ReturnType<typeof createGameStyles>; roomCode: string; onLeaveRoom: () => void }} props */
function GameScreen({ styles, roomCode, onLeaveRoom }) {
  const c = styles.colors;
  const [spectatorViewMove, setSpectatorViewMove] = useState(null);

  const {
    loading,
    loadError,
    writeError,
    roomMissing,
    historyBoards,
    historyStrings,
    currentMove,
    currentSquares,
    winner,
    winningLine,
    isDraw,
    xIsNext,
    myRole,
    isSpectator,
    canPlay,
    play,
    goToMove,
    reset,
    releaseSeat,
    matchEnded,
    matchWinner,
    endedReason,
  } = useSharedGame(roomCode);

  useEffect(() => {
    setSpectatorViewMove(null);
  }, [roomCode, historyBoards.length, currentMove, isSpectator]);

  const effectiveMove =
    isSpectator && spectatorViewMove != null
      ? spectatorViewMove
      : currentMove;

  const displaySquares = isSpectator
    ? historyBoards[effectiveMove] ?? Array(9).fill(null)
    : currentSquares;

  const displayWinningLine = isSpectator
    ? calculateWinner(displaySquares)?.line
    : winningLine;

  const status = buildStatus({
    matchEnded,
    endedReason,
    matchWinner,
    winner,
    isDraw,
    xIsNext,
  });

  const roleLine = matchEnded
    ? isSpectator
      ? "Match over — you are watching as a spectator."
      : myRole
        ? "Match over."
        : "Match over — you are watching as a spectator."
    : isSpectator
      ? "You are watching — two players are seated; seats stay locked."
      : myRole
        ? `You are ${myRole}`
        : "Claiming a seat…";

  const statusColor = winner || (matchEnded && matchWinner && matchWinner !== "draw")
    ? c.statusSuccess
    : isDraw
      ? c.textMuted
      : c.textMuted;

  const handleLeave = async () => {
    await releaseSeat();
    onLeaveRoom();
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
    } catch {
      /* ignore */
    }
  };

  const thumbColors = {
    pieceX: c.pieceX,
    pieceO: c.pieceO,
    border: c.border,
    cellBg: c.squareBg,
    muted: c.textMuted,
  };

  if (loadError) {
    return (
      <div style={styles.container}>
        <div style={styles.errorBox}>{loadError}</div>
      </div>
    );
  }

  if (roomMissing) {
    return (
      <div style={styles.container}>
        <div style={styles.errorBox}>
          <strong>This room no longer exists.</strong>
          <p style={{ margin: "12px 0 0", fontWeight: 500 }}>
            The host may have left, or the code was removed.
          </p>
          <button
            type="button"
            style={{ ...styles.secondaryBtn, marginTop: "16px" }}
            onClick={() => onLeaveRoom()}
          >
            Back to lobby
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <p style={{ color: c.textMuted, fontWeight: 600 }}>Connecting…</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Tic-Tac-Toe</h1>
        <div style={styles.roomPill}>
          <span>Room</span>
          <span aria-label="Room code">{roomCode}</span>
        </div>
        <button type="button" style={styles.textBtn} onClick={() => void copyCode()}>
          Copy room code
        </button>
        <button type="button" style={styles.textBtn} onClick={() => void handleLeave()}>
          Leave room
        </button>
        <div
          style={{
            ...styles.status,
            color: statusColor,
          }}
        >
          {status}
        </div>
        <p style={styles.hint}>{roleLine}</p>
        {writeError ? (
          <p style={{ ...styles.hint, color: c.danger }}>{writeError}</p>
        ) : null}
      </header>

      <div style={styles.board}>
        {displaySquares.map((square, i) => (
          <Square
            key={i}
            value={square}
            disabled={isSpectator || !canPlay || Boolean(square)}
            onClick={() => play(i)}
            isWinningSquare={displayWinningLine?.includes(i)}
            squareBaseStyle={styles.square}
            colors={c}
          />
        ))}
      </div>

      <div style={styles.controls}>
        <button
          type="button"
          style={{
            ...styles.resetBtn,
            opacity: myRole && !isSpectator ? 1 : 0.45,
            cursor: myRole && !isSpectator ? "pointer" : "not-allowed",
          }}
          disabled={!myRole || isSpectator}
          onClick={() => reset()}
        >
          Reset game
        </button>
      </div>

      <div style={styles.historySection}>
        <p style={styles.historyTitle}>Move history</p>
        <div style={styles.historyGrid}>
          {historyBoards.map((_, move) => {
            const placement =
              move > 0 ? placementAtMove(historyStrings, move) : null;
            const meta =
              move === 0
                ? "Start"
                : placement
                  ? `${placement.symbol} · #${move}`
                  : `Move ${move}`;
            const isActive = move === effectiveMove;
            return (
              <div key={move} style={styles.historyItem}>
                <span style={styles.historyMeta}>{meta}</span>
                <button
                  type="button"
                  disabled={!isSpectator && !myRole}
                  title={
                    isSpectator
                      ? "Preview this position (local)"
                      : "Show this position"
                  }
                  style={{
                    ...styles.historyBtn,
                    outline: isActive ? `2px solid ${c.historyActiveBg}` : "none",
                    opacity: !isSpectator && !myRole ? 0.45 : 1,
                    cursor:
                      isSpectator || myRole ? "pointer" : "not-allowed",
                  }}
                  onClick={() => {
                    if (isSpectator) setSpectatorViewMove(move);
                    else if (myRole) void goToMove(move);
                  }}
                >
                  <MoveHistoryThumbnail
                    history={historyStrings}
                    moveIndex={move}
                    colors={thumbColors}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
