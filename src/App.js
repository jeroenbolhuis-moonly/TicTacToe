import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
const COPY_ACK_MS = 1600;

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

/** Match finished — single headline (no separate “Match over”). */
function buildEndgameHeadline({
  matchEnded,
  endedReason,
  matchWinner,
  winner,
  myRole,
  isSpectator,
}) {
  if (!matchEnded) return null;

  if (matchWinner === "draw") {
    return endedReason === "disconnect"
      ? "Draw — both players disconnected"
      : "Draw";
  }

  const neutral = () => {
    if (winner === "X" || winner === "O") {
      if (endedReason === "forfeit") return `${winner} wins — opponent left`;
      if (endedReason === "disconnect")
        return `${winner} wins — opponent disconnected`;
      return `${winner} wins`;
    }
    return "Game over";
  };

  if (isSpectator || !myRole) return neutral();

  const iWon = winner === myRole;
  const iLost = Boolean(winner && winner !== myRole);

  if (iWon) {
    if (endedReason === "forfeit") return "You win — opponent left the game";
    if (endedReason === "disconnect")
      return "You win — opponent disconnected";
    return "You win";
  }
  if (iLost) {
    if (endedReason === "forfeit") return "You left — opponent wins";
    if (endedReason === "disconnect")
      return "You lost — you were disconnected";
    return "You lost";
  }

  return neutral();
}

/**
 * @returns {{ primary: string; secondary: string | null; tone: 'accent' | 'success' | 'muted' | 'danger' }}
 */
function getHeaderPresentation({
  matchEnded,
  endedReason,
  matchWinner,
  winner,
  xIsNext,
  myRole,
  isSpectator,
  bothRosterFilled,
  canPlay,
}) {
  if (matchEnded) {
    const primary = buildEndgameHeadline({
      matchEnded,
      endedReason,
      matchWinner,
      winner,
      myRole,
      isSpectator,
    });
    const secondary = isSpectator
      ? "Spectating — this match has ended."
      : null;
    const iWon = myRole && winner === myRole && matchWinner !== "draw";
    const iLost = myRole && winner && winner !== myRole;
    const tone = matchWinner === "draw"
      ? "muted"
      : iWon
        ? "success"
        : iLost
          ? "danger"
          : "muted";
    return { primary: primary ?? "Game over", secondary, tone };
  }

  if (isSpectator) {
    const mover = xIsNext ? "X" : "O";
    return {
      primary: `${mover} to move`,
      secondary: "You’re spectating — only the two seated players can move.",
      tone: "muted",
    };
  }

  if (!myRole) {
    return {
      primary: "Claiming a seat…",
      secondary: "Hang on while we reserve your spot.",
      tone: "muted",
    };
  }

  if (!bothRosterFilled) {
    return {
      primary: "Waiting for opponent",
      secondary: "Share the room code so someone can take the other seat.",
      tone: "muted",
    };
  }

  if (canPlay) {
    return { primary: "Your turn", secondary: null, tone: "accent" };
  }

  return { primary: "Opponent’s turn", secondary: null, tone: "muted" };
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
  const [roomCopied, setRoomCopied] = useState(false);
  const copyAckTimerRef = useRef(null);

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
    bothRosterFilled,
  } = useSharedGame(roomCode);

  useEffect(() => {
    setSpectatorViewMove(null);
  }, [roomCode, historyBoards.length, currentMove, isSpectator]);

  useEffect(() => {
    setRoomCopied(false);
    if (copyAckTimerRef.current != null) {
      window.clearTimeout(copyAckTimerRef.current);
      copyAckTimerRef.current = null;
    }
  }, [roomCode]);

  useEffect(() => {
    return () => {
      if (copyAckTimerRef.current != null) {
        window.clearTimeout(copyAckTimerRef.current);
        copyAckTimerRef.current = null;
      }
    };
  }, []);

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

  const header = getHeaderPresentation({
    matchEnded,
    endedReason,
    matchWinner,
    winner,
    xIsNext,
    myRole,
    isSpectator,
    bothRosterFilled,
    canPlay,
  });

  const headlineColor =
    header.tone === "accent"
      ? c.accent
      : header.tone === "success"
        ? c.statusSuccess
        : header.tone === "danger"
          ? c.danger
          : c.textMuted;

  const handleLeave = async () => {
    await releaseSeat();
    onLeaveRoom();
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setRoomCopied(true);
      if (copyAckTimerRef.current != null) {
        window.clearTimeout(copyAckTimerRef.current);
      }
      copyAckTimerRef.current = window.setTimeout(() => {
        setRoomCopied(false);
        copyAckTimerRef.current = null;
      }, COPY_ACK_MS);
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

        <div style={styles.headerToolbar}>
          <div style={styles.roomPill}>
            <span style={styles.roomPillLabel}>Room</span>
            <div style={styles.roomPillCodeRow}>
              <span style={styles.roomPillCode} aria-label="Room code">
                {roomCode}
              </span>
              <button
                type="button"
                className="room-copy-btn"
                style={styles.roomCopyIconBtn}
                aria-label="Copy room code"
                title="Copy room code"
                onClick={() => void copyCode()}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden
                >
                  <rect
                    x="9"
                    y="9"
                    width="13"
                    height="13"
                    rx="2"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {roomCopied ? (
                <span
                  role="status"
                  aria-live="polite"
                  style={styles.roomCopyFeedback}
                >
                  Copied!
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            style={styles.toolbarBtnDanger}
            onClick={() => void handleLeave()}
          >
            Leave room
          </button>
        </div>

        <p style={{ ...styles.headline, color: headlineColor }}>{header.primary}</p>
        {header.secondary ? (
          <p style={{ ...styles.hint, marginTop: "8px", marginBottom: 0 }}>
            {header.secondary}
          </p>
        ) : null}
        {writeError ? (
          <p style={{ ...styles.hint, color: c.danger, marginTop: "10px" }}>
            {writeError}
          </p>
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
