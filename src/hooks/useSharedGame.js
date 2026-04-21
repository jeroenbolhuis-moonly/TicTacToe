import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot, runTransaction, updateDoc } from "firebase/firestore";
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

/** @typedef {{ kind: 'play' | 'nav' | 'reset'; history: string[]; currentMove: number }} PendingOverlay */

function mergeWithPending(base, pending) {
  if (!base) return null;
  if (!pending) return base;
  return {
    ...base,
    history: pending.history,
    currentMove: pending.currentMove,
  };
}

/**
 * @param {ReturnType<typeof normalizeRemote> | null} remoteNorm
 * @param {PendingOverlay | null} p
 */
function isPendingSatisfied(remoteNorm, p) {
  if (!p) return true;
  if (!remoteNorm) return false;
  const lenR = remoteNorm.history.length;
  const lenP = p.history.length;
  const prefixMatch =
    lenP <= lenR && p.history.every((v, i) => remoteNorm.history[i] === v);

  if (lenR > lenP) {
    if (p.kind === "reset") return false;
    if (p.kind === "play" && prefixMatch) return true;
    if (p.kind === "nav") return true;
    return false;
  }
  if (lenR < lenP) return false;
  const histEq = remoteNorm.history.every((h, i) => h === p.history[i]);
  if (!histEq) return true;
  return remoteNorm.currentMove === p.currentMove;
}

/**
 * @param {string | null} roomCode Firestore document id for this private lobby
 */
export function useSharedGame(roomCode) {
  const db = getDb();
  const clientId = useMemo(() => getOrCreateClientId(), []);
  const [raw, setRaw] = useState(null);
  const [pending, setPending] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [writeError, setWriteError] = useState(null);
  const [roomMissing, setRoomMissing] = useState(false);
  const claimStarted = useRef(false);
  const latestServerRef = useRef(null);
  const overlayLock = useRef(false);

  useEffect(() => {
    if (!pending) overlayLock.current = false;
  }, [pending]);

  const remote = useMemo(() => {
    const base = raw ? normalizeRemote(raw) : null;
    return mergeWithPending(base, pending);
  }, [raw, pending]);

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
    setPending(null);
    setLoadError(null);
    latestServerRef.current = null;

    const ref = doc(db, GAME_COLLECTION, roomCode);
    const unsub = onSnapshot(
      ref,
      { includeMetadataChanges: true },
      (snap) => {
        setLoadError(null);
        if (!snap.exists()) {
          latestServerRef.current = null;
          setRaw(null);
          setPending(null);
          setRoomMissing(true);
          return;
        }
        const data = snap.data();
        const normalized = normalizeRemote(data);
        latestServerRef.current = normalized;
        setRaw(data);
        setPending((prev) => {
          if (!prev) return null;
          return isPendingSatisfied(normalized, prev) ? null : prev;
        });
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
      if (!db || !roomCode || !myRole) return;
      if (overlayLock.current || pending) return;
      if (!canPlay || currentSquares[index]) return;

      const d = latestServerRef.current;
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
      const nextMove = nextHist.length - 1;

      overlayLock.current = true;
      setWriteError(null);
      setPending({
        kind: "play",
        history: nextHist,
        currentMove: nextMove,
      });

      const ref = doc(db, GAME_COLLECTION, roomCode);
      try {
        await updateDoc(ref, {
          history: nextHist,
          currentMove: nextMove,
        });
      } catch (e) {
        setPending(null);
        setWriteError(e.message || "Move failed");
      }
    },
    [
      db,
      roomCode,
      myRole,
      canPlay,
      currentSquares,
      pending,
    ]
  );

  const goToMove = useCallback(
    async (moveIndex) => {
      if (!db || !myRole || !roomCode) return;
      if (overlayLock.current || pending) return;
      const d = latestServerRef.current;
      if (!d) return;
      if (moveIndex < 0 || moveIndex >= d.history.length) return;

      overlayLock.current = true;
      setWriteError(null);
      setPending({
        kind: "nav",
        history: d.history,
        currentMove: moveIndex,
      });

      const ref = doc(db, GAME_COLLECTION, roomCode);
      try {
        await updateDoc(ref, { currentMove: moveIndex });
      } catch (e) {
        setPending(null);
        setWriteError(e.message || "Could not jump in history");
      }
    },
    [db, myRole, roomCode, pending]
  );

  const reset = useCallback(async () => {
    if (!db || !myRole || !roomCode) return;
    if (overlayLock.current || pending) return;

    const nextHist = [EMPTY_BOARD_STRING];
    overlayLock.current = true;
    setWriteError(null);
    setPending({
      kind: "reset",
      history: nextHist,
      currentMove: 0,
    });

    const ref = doc(db, GAME_COLLECTION, roomCode);
    try {
      await updateDoc(ref, {
        history: nextHist,
        currentMove: 0,
      });
    } catch (e) {
      setPending(null);
      setWriteError(e.message || "Reset failed");
    }
  }, [db, myRole, roomCode, pending]);

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
