import { useCallback, useEffect, useState } from "react";
import Square from "./components/Square";
import Lobby from "./components/Lobby";
import { isFirebaseConfigured } from "./firebase";
import { useSharedGame } from "./hooks/useSharedGame";
import { isValidRoomCode } from "./lib/roomCode";
import { gameStyles } from "./ui/gameStyles";

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

function ConfigHint() {
  return (
    <div style={gameStyles.container}>
      <div style={gameStyles.errorBox}>
        <strong>Firebase is not configured.</strong>
        <p style={{ margin: "12px 0 0", fontWeight: 500 }}>
          Create a <code>.env</code> file in the project root with{" "}
          <code>REACT_APP_FIREBASE_*</code> keys from your Firebase project
          (Web app config), enable Firestore, then restart{" "}
          <code>npm start</code>.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  if (!isFirebaseConfigured()) {
    return <ConfigHint />;
  }

  return <MultiplayerApp />;
}

function MultiplayerApp() {
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
      <div style={gameStyles.container}>
        <p style={{ color: "#64748b", fontWeight: 600 }}>Loading…</p>
      </div>
    );
  }

  if (!roomCode) {
    return <Lobby onEnterRoom={enterRoom} />;
  }

  return (
    <GameScreen roomCode={roomCode} onLeaveRoom={leaveRoom} />
  );
}

function GameScreen({ roomCode, onLeaveRoom }) {
  const {
    loading,
    loadError,
    writeError,
    roomMissing,
    historyBoards,
    currentMove,
    currentSquares,
    winner,
    winningLine,
    isDraw,
    xIsNext,
    myRole,
    seatFull,
    canPlay,
    play,
    goToMove,
    reset,
    releaseSeat,
  } = useSharedGame(roomCode);

  const status = winner
    ? `Winner: ${winner}`
    : isDraw
      ? "Draw"
      : `Next Player: ${xIsNext ? "X" : "O"}`;

  const roleLine = seatFull
    ? "Table full — two others are playing (read-only)."
    : myRole
      ? `You are ${myRole}`
      : "Claiming a seat…";

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

  if (loadError) {
    return (
      <div style={gameStyles.container}>
        <div style={gameStyles.errorBox}>{loadError}</div>
      </div>
    );
  }

  if (roomMissing) {
    return (
      <div style={gameStyles.container}>
        <div style={gameStyles.errorBox}>
          <strong>This room no longer exists.</strong>
          <p style={{ margin: "12px 0 0", fontWeight: 500 }}>
            The host may have left, or the code was removed.
          </p>
          <button
            type="button"
            style={{ ...gameStyles.secondaryBtn, marginTop: "16px" }}
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
      <div style={gameStyles.container}>
        <p style={{ color: "#64748b", fontWeight: 600 }}>Connecting…</p>
      </div>
    );
  }

  return (
    <div style={gameStyles.container}>
      <header style={gameStyles.header}>
        <h1 style={gameStyles.title}>Tic-Tac-Toe</h1>
        <div style={gameStyles.roomPill}>
          <span>Room</span>
          <span aria-label="Room code">{roomCode}</span>
        </div>
        <button type="button" style={gameStyles.textBtn} onClick={() => void copyCode()}>
          Copy room code
        </button>
        <button type="button" style={gameStyles.textBtn} onClick={() => void handleLeave()}>
          Leave room
        </button>
        <div
          style={{
            ...gameStyles.status,
            color: winner ? "#16a34a" : "#64748b",
          }}
        >
          {status}
        </div>
        <p style={gameStyles.hint}>{roleLine}</p>
        {writeError ? (
          <p style={{ ...gameStyles.hint, color: "#b91c1c" }}>{writeError}</p>
        ) : null}
      </header>

      <div style={gameStyles.board}>
        {currentSquares.map((square, i) => (
          <Square
            key={i}
            value={square}
            disabled={!canPlay || Boolean(square)}
            onClick={() => play(i)}
            isWinningSquare={winningLine?.includes(i)}
          />
        ))}
      </div>

      <div style={gameStyles.controls}>
        <button
          type="button"
          style={{
            ...gameStyles.resetBtn,
            opacity: myRole ? 1 : 0.45,
            cursor: myRole ? "pointer" : "not-allowed",
          }}
          disabled={!myRole}
          onClick={() => reset()}
        >
          Reset Game
        </button>
      </div>

      <div style={gameStyles.historySection}>
        <p style={gameStyles.historyTitle}>Move History</p>
        <div style={gameStyles.historyGrid}>
          {historyBoards.map((_, move) => (
            <button
              type="button"
              key={move}
              disabled={!myRole}
              style={{
                ...gameStyles.historyBtn,
                backgroundColor:
                  move === currentMove ? "#334155" : "#f1f5f9",
                color: move === currentMove ? "#fff" : "#475569",
                opacity: myRole ? 1 : 0.45,
                cursor: myRole ? "pointer" : "not-allowed",
              }}
              onClick={() => goToMove(move)}
            >
              {move === 0 ? "Start" : move}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
