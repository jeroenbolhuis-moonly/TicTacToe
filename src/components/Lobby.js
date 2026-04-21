import { useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "../firebase";
import { initialGamePayload } from "../hooks/useSharedGame";
import {
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from "../lib/roomCode";
import { gameStyles } from "../ui/gameStyles";

const GAME_COLLECTION = "games";
const MAX_CREATE_ATTEMPTS = 12;

export default function Lobby({ onEnterRoom }) {
  const db = getDb();
  const [joinInput, setJoinInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleHost = async () => {
    if (!db) return;
    setError(null);
    setBusy(true);
    try {
      for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
        const code = generateRoomCode();
        const ref = doc(db, GAME_COLLECTION, code);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(ref, initialGamePayload());
          onEnterRoom(code);
          return;
        }
      }
      setError("Could not allocate a room code. Try again.");
    } catch (e) {
      setError(e.message || "Could not create a room");
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!db) return;
    setError(null);
    const code = normalizeRoomCode(joinInput);
    if (!isValidRoomCode(code)) {
      setError("Enter a 6-character room code (letters and digits).");
      return;
    }
    setBusy(true);
    try {
      const ref = doc(db, GAME_COLLECTION, code);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        setError("No game exists for that code.");
        return;
      }
      onEnterRoom(code);
    } catch (err) {
      setError(err.message || "Could not join");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={gameStyles.container}>
      <header style={gameStyles.header}>
        <h1 style={gameStyles.title}>Tic-Tac-Toe</h1>
        <p style={gameStyles.hint}>
          Private rooms only: share the code with one other player. There is no
          public game list.
        </p>
      </header>

      <div style={gameStyles.lobbyCard}>
        <button
          type="button"
          style={{
            ...gameStyles.primaryBtn,
            opacity: busy ? 0.65 : 1,
            cursor: busy ? "wait" : "pointer",
          }}
          disabled={busy}
          onClick={() => void handleHost()}
        >
          Host a game
        </button>
        <p style={gameStyles.lobbyDivider}>or join with a code</p>
        <form onSubmit={(ev) => void handleJoin(ev)} style={gameStyles.joinRow}>
          <input
            type="text"
            name="room"
            autoComplete="off"
            spellCheck={false}
            placeholder="ROOM CODE"
            value={joinInput}
            onChange={(ev) => setJoinInput(ev.target.value.toUpperCase())}
            style={gameStyles.codeInput}
            maxLength={12}
            disabled={busy}
          />
          <button
            type="submit"
            style={{
              ...gameStyles.secondaryBtn,
              opacity: busy ? 0.65 : 1,
              cursor: busy ? "wait" : "pointer",
            }}
            disabled={busy}
          >
            Join
          </button>
        </form>
        {error ? (
          <p style={{ ...gameStyles.hint, color: "#b91c1c", marginTop: "12px" }}>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
