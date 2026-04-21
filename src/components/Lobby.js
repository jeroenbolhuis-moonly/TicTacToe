import { useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "../firebase";
import { initialGamePayload } from "../hooks/useSharedGame";
import {
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from "../lib/roomCode";

const GAME_COLLECTION = "games";
const MAX_CREATE_ATTEMPTS = 12;

/** @param {{ styles: ReturnType<typeof import("../ui/gameStyles").createGameStyles>; onEnterRoom: (code: string) => void }} props */
export default function Lobby({ styles, onEnterRoom }) {
  const db = getDb();
  const [joinInput, setJoinInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const c = styles.colors;

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
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Tic-Tac-Toe</h1>
        <p style={styles.hint}>
          Private rooms: two players lock in as X and O; anyone else with the
          link can watch. Share the code with your opponent and spectators.
        </p>
      </header>

      <div style={styles.lobbyCard}>
        <button
          type="button"
          style={{
            ...styles.primaryBtn,
            opacity: busy ? 0.65 : 1,
            cursor: busy ? "wait" : "pointer",
          }}
          disabled={busy}
          onClick={() => void handleHost()}
        >
          Host a game
        </button>
        <p style={styles.lobbyDivider}>or join with a code</p>
        <form onSubmit={(ev) => void handleJoin(ev)} style={styles.joinRow}>
          <input
            type="text"
            name="room"
            autoComplete="off"
            spellCheck={false}
            placeholder="ROOM CODE"
            value={joinInput}
            onChange={(ev) => setJoinInput(ev.target.value.toUpperCase())}
            style={styles.codeInput}
            maxLength={12}
            disabled={busy}
          />
          <button
            type="submit"
            style={{
              ...styles.secondaryBtn,
              opacity: busy ? 0.65 : 1,
              cursor: busy ? "wait" : "pointer",
            }}
            disabled={busy}
          >
            Join
          </button>
        </form>
        {error ? (
          <p style={{ ...styles.hint, color: c.danger, marginTop: "12px" }}>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
