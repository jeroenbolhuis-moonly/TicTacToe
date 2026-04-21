import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  doc,
  onSnapshot,
  runTransaction,
  updateDoc,
} from "firebase/firestore";
import { getDb } from "../firebase";
import { boardFromString, stringFromBoard } from "../game/boardCodec";
import { EMPTY_BOARD_STRING } from "../game/constants";
import { calculateWinner, xIsNextForMove } from "../game/logic";
import { getOrCreateClientId } from "../lib/clientId";

const GAME_COLLECTION = "games";
const SEAT_STALE_MS = 45_000;
const HEARTBEAT_MS = 12_000;

export const initialGamePayload = () => ({
  history: [EMPTY_BOARD_STRING],
  currentMove: 0,
  xPlayer: null,
  oPlayer: null,
  xPingAt: null,
  oPingAt: null,
});

function normalizeRemote(raw) {
  const history = Array.isArray(raw?.history) ? raw.history : null;
  const currentMove =
    typeof raw?.currentMove === "number" && raw.currentMove >= 0
      ? raw.currentMove
      : 0;
  if (!history || !history.length) return null;
  const safeMove = Math.min(currentMove, history.length - 1);
  return {
    history,
    currentMove: safeMove,
    xPlayer: raw?.xPlayer ?? null,
    oPlayer: raw?.oPlayer ?? null,
    xPingAt: typeof raw?.xPingAt === "number" ? raw.xPingAt : null,
    oPingAt: typeof raw?.oPingAt === "number" ? raw.oPingAt : null,
  };
}

function seatIsLive(pingAt) {
  if (typeof pingAt !== "number" || Number.isNaN(pingAt)) return false;
  return Date.now() - pingAt < SEAT_STALE_MS;
}

/**
 * @param {string | null} roomCode Firestore document id for this private lobby
 */
export function useSharedGame(roomCode) {
  const db = getDb();
  const clientId = useMemo(() => getOrCreateClientId(), []);
  const [raw, setRaw] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [writeError, setWriteError] = useState(null);
  const [roomMissing, setRoomMissing] = useState(false);
  const claimStarted = useRef(false);

  const remote = raw ? normalizeRemote(raw) : null;

  const historyBoards = useMemo(() => {
    if (!remote) return [];
    return remote.history.map(boardFromString);
  }, [remote]);

  const currentSquares =
    historyBoards[remote?.currentMove ?? 0] ?? Array(9).fill(null);
  const xIsNext = xIsNextForMove(remote?.currentMove ?? 0);

  const xSeatLive =
    Boolean(remote?.xPlayer) && seatIsLive(remote?.xPingAt ?? null);
  const oSeatLive =
    Boolean(remote?.oPlayer) && seatIsLive(remote?.oPingAt ?? null);

  const myRole = useMemo(() => {
    if (!remote) return null;
    if (remote.xPlayer === clientId) return "X";
    if (remote.oPlayer === clientId) return "O";
    return null;
  }, [remote, clientId]);

  const seatFull = Boolean(
    remote && xSeatLive && oSeatLive && !myRole
  );

  useEffect(() => {
    claimStarted.current = false;
  }, [roomCode]);

  useEffect(() => {
    if (!db || !roomCode) return undefined;

    setRoomMissing(false);
    setRaw(null);
    setLoadError(null);

    const ref = doc(db, GAME_COLLECTION, roomCode);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setLoadError(null);
        if (!snap.exists()) {
          setRaw(null);
          setRoomMissing(true);
          return;
        }
        setRaw(snap.data());
      },
      (err) => {
        setLoadError(err.message || "Could not load game");
      }
    );
    return () => unsub();
  }, [db, roomCode]);

  useEffect(() => {
    if (!db || !remote || !roomCode || claimStarted.current) return;
    if (myRole) return;
    if (seatFull) return;

    claimStarted.current = true;
    const ref = doc(db, GAME_COLLECTION, roomCode);
    const now = Date.now();

    void runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) return;
      const d = normalizeRemote(snap.data());
      if (!d) return;

      const x = d.xPlayer ?? null;
      const o = d.oPlayer ?? null;
      const xLive = Boolean(x) && seatIsLive(d.xPingAt);
      const oLive = Boolean(o) && seatIsLive(d.oPingAt);

      if (x === clientId || o === clientId) return;
      if (xLive && oLive) return;

      if (!xLive) {
        transaction.update(ref, { xPlayer: clientId, xPingAt: now });
        return;
      }
      if (!oLive && x !== clientId && xLive) {
        transaction.update(ref, { oPlayer: clientId, oPingAt: now });
      }
    }).catch(() => {
      claimStarted.current = false;
    });
  }, [db, remote, myRole, seatFull, clientId, roomCode]);

  useEffect(() => {
    if (!db || !roomCode || !myRole) return undefined;
    const ref = doc(db, GAME_COLLECTION, roomCode);
    const field = myRole === "X" ? "xPingAt" : "oPingAt";

    const ping = () => {
      void updateDoc(ref, { [field]: Date.now() }).catch(() => {});
    };

    ping();
    const id = window.setInterval(ping, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [db, roomCode, myRole]);

  const result = calculateWinner(currentSquares);
  const winner = result?.winner;
  const isDraw = !winner && currentSquares.every(Boolean);

  const isMyTurn =
    myRole &&
    ((myRole === "X" && xIsNext) || (myRole === "O" && !xIsNext));

  const canPlay =
    Boolean(myRole) && isMyTurn && !winner && Boolean(remote);

  const play = useCallback(
    async (index) => {
      if (!db || !remote || !roomCode || !canPlay) return;
      if (currentSquares[index]) return;
      setWriteError(null);
      const ref = doc(db, GAME_COLLECTION, roomCode);
      try {
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(ref);
          if (!snap.exists()) return;
          const d = normalizeRemote(snap.data());
          if (!d) return;

          const squares = boardFromString(d.history[d.currentMove]);
          const turn = xIsNextForMove(d.currentMove);
          const expected = turn ? "X" : "O";
          if (myRole !== expected) return;

          const w = calculateWinner(squares)?.winner;
          if (w || squares[index]) return;

          const next = squares.slice();
          next[index] = expected;
          const nextHist = [
            ...d.history.slice(0, d.currentMove + 1),
            stringFromBoard(next),
          ];
          transaction.update(ref, {
            history: nextHist,
            currentMove: nextHist.length - 1,
          });
        });
      } catch (e) {
        setWriteError(e.message || "Move failed");
      }
    },
    [db, remote, canPlay, myRole, currentSquares, roomCode]
  );

  const goToMove = useCallback(
    async (moveIndex) => {
      if (!db || !remote || !myRole || !roomCode) return;
      if (moveIndex < 0 || moveIndex >= remote.history.length) return;
      setWriteError(null);
      const ref = doc(db, GAME_COLLECTION, roomCode);
      try {
        await updateDoc(ref, { currentMove: moveIndex });
      } catch (e) {
        setWriteError(e.message || "Could not jump in history");
      }
    },
    [db, remote, myRole, roomCode]
  );

  const reset = useCallback(async () => {
    if (!db || !myRole || !roomCode) return;
    setWriteError(null);
    const ref = doc(db, GAME_COLLECTION, roomCode);
    try {
      await updateDoc(ref, {
        history: [EMPTY_BOARD_STRING],
        currentMove: 0,
      });
    } catch (e) {
      setWriteError(e.message || "Reset failed");
    }
  }, [db, myRole, roomCode]);

  const releaseSeat = useCallback(async () => {
    if (!db || !roomCode || !myRole) return;
    const ref = doc(db, GAME_COLLECTION, roomCode);
    const patch =
      myRole === "X"
        ? { xPlayer: null, xPingAt: null }
        : { oPlayer: null, oPingAt: null };
    try {
      await updateDoc(ref, patch);
    } catch {
      /* best-effort when leaving */
    }
  }, [db, roomCode, myRole]);

  const loading =
    Boolean(db) &&
    Boolean(roomCode) &&
    raw === null &&
    !loadError &&
    !roomMissing;

  return {
    loading,
    configured: Boolean(db),
    loadError,
    writeError,
    roomMissing,
    roomCode,
    historyBoards,
    currentMove: remote?.currentMove ?? 0,
    currentSquares,
    xIsNext,
    winner,
    winningLine: result?.line,
    isDraw,
    myRole,
    seatFull,
    canPlay,
    play,
    goToMove,
    reset,
    releaseSeat,
  };
}
