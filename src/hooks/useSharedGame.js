import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot, runTransaction, updateDoc } from "firebase/firestore";
import { getDb } from "../firebase";
import { boardFromString, stringFromBoard } from "../game/boardCodec";
import { EMPTY_BOARD_STRING } from "../game/constants";
import { calculateWinner, xIsNextForMove } from "../game/logic";
import { getOrCreateClientId } from "../lib/clientId";

const GAME_COLLECTION = "games";
/** Stale ping before an *unfilled* seat is considered free (pre‑roster). */
const LOBBY_STALE_MS = 45_000;
/** If a seated player’s ping is older than this while both are assigned, they forfeit. */
const MATCH_DISCONNECT_MS = 16_000;
const HEARTBEAT_MS = 4000;

export const initialGamePayload = () => ({
  history: [EMPTY_BOARD_STRING],
  currentMove: 0,
  xPlayer: null,
  oPlayer: null,
  xPingAt: null,
  oPingAt: null,
  matchEnded: false,
  matchWinner: null,
  endedReason: null,
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
    matchEnded: Boolean(raw?.matchEnded),
    matchWinner: raw?.matchWinner ?? null,
    endedReason: raw?.endedReason ?? null,
  };
}

function seatIsLive(pingAt, maxAgeMs = LOBBY_STALE_MS) {
  if (typeof pingAt !== "number" || Number.isNaN(pingAt)) return false;
  return Date.now() - pingAt < maxAgeMs;
}

/** @typedef {{ kind: 'play' | 'nav' | 'reset'; history: string[]; currentMove: number; matchEnded?: boolean; matchWinner?: string | null; endedReason?: string | null }} PendingOverlay */

function mergeWithPending(base, pending) {
  if (!base) return null;
  if (!pending) return base;
  const merged = {
    ...base,
    history: pending.history,
    currentMove: pending.currentMove,
  };
  if (pending.matchEnded !== undefined) merged.matchEnded = pending.matchEnded;
  if (pending.matchWinner !== undefined) merged.matchWinner = pending.matchWinner;
  if (pending.endedReason !== undefined) merged.endedReason = pending.endedReason;
  return merged;
}

/**
 * @param {ReturnType<typeof normalizeRemote> | null} remoteNorm
 * @param {PendingOverlay | null} p
 */
function isPendingSatisfied(remoteNorm, p) {
  if (!p) return true;
  if (!remoteNorm) return false;

  if (p.matchEnded !== undefined) {
    if (remoteNorm.matchEnded !== p.matchEnded) return false;
    if (p.matchEnded) {
      if (remoteNorm.matchWinner !== p.matchWinner) return false;
      if (remoteNorm.endedReason !== p.endedReason) return false;
    }
  }

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

  const historyStrings = remote?.history ?? [];

  const currentSquares =
    historyBoards[remote?.currentMove ?? 0] ?? Array(9).fill(null);
  const xIsNext = xIsNextForMove(remote?.currentMove ?? 0);

  const bothRosterFilled = Boolean(remote?.xPlayer && remote?.oPlayer);
  const xSeatLiveLobby = Boolean(remote?.xPlayer) && seatIsLive(remote?.xPingAt ?? null, LOBBY_STALE_MS);
  const oSeatLiveLobby = Boolean(remote?.oPlayer) && seatIsLive(remote?.oPingAt ?? null, LOBBY_STALE_MS);

  const myRole = useMemo(() => {
    if (!remote) return null;
    if (remote.xPlayer === clientId) return "X";
    if (remote.oPlayer === clientId) return "O";
    return null;
  }, [remote, clientId]);

  const isSpectator = Boolean(bothRosterFilled && !myRole);

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
    if (bothRosterFilled) return;

    claimStarted.current = true;
    const ref = doc(db, GAME_COLLECTION, roomCode);
    const now = Date.now();

    void runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) return;
      const d = normalizeRemote(snap.data());
      if (!d) return;

      if (d.xPlayer && d.oPlayer) return;

      const x = d.xPlayer ?? null;
      const o = d.oPlayer ?? null;
      const xLive = Boolean(x) && seatIsLive(d.xPingAt, LOBBY_STALE_MS);
      const oLive = Boolean(o) && seatIsLive(d.oPingAt, LOBBY_STALE_MS);

      if (x === clientId || o === clientId) return;
      if (x && o) return;

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
  }, [db, remote, myRole, bothRosterFilled, clientId, roomCode]);

  useEffect(() => {
    if (!db || !roomCode || !myRole || remote?.matchEnded) return undefined;
    const ref = doc(db, GAME_COLLECTION, roomCode);
    const field = myRole === "X" ? "xPingAt" : "oPingAt";

    const ping = () => {
      void updateDoc(ref, { [field]: Date.now() }).catch(() => {});
    };

    ping();
    const id = window.setInterval(ping, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [db, roomCode, myRole, remote?.matchEnded]);

  useEffect(() => {
    if (!db || !roomCode) return undefined;
    const ref = doc(db, GAME_COLLECTION, roomCode);

    const tick = () => {
      const d = latestServerRef.current;
      if (!d?.xPlayer || !d?.oPlayer || d.matchEnded) return;
      const xLive = seatIsLive(d.xPingAt, MATCH_DISCONNECT_MS);
      const oLive = seatIsLive(d.oPingAt, MATCH_DISCONNECT_MS);
      if (xLive && oLive) return;

      void runTransaction(db, async (transaction) => {
        const snap = await transaction.get(ref);
        if (!snap.exists()) return;
        const cur = normalizeRemote(snap.data());
        if (!cur || cur.matchEnded) return;
        if (!cur.xPlayer || !cur.oPlayer) return;

        const xl = seatIsLive(cur.xPingAt, MATCH_DISCONNECT_MS);
        const ol = seatIsLive(cur.oPingAt, MATCH_DISCONNECT_MS);
        if (xl && ol) return;

        if (!xl && !ol) {
          transaction.update(ref, {
            matchEnded: true,
            matchWinner: "draw",
            endedReason: "disconnect",
          });
          return;
        }
        if (!xl) {
          transaction.update(ref, {
            matchEnded: true,
            matchWinner: "O",
            endedReason: "disconnect",
          });
          return;
        }
        if (!ol) {
          transaction.update(ref, {
            matchEnded: true,
            matchWinner: "X",
            endedReason: "disconnect",
          });
        }
      }).catch(() => {});
    };

    const id = window.setInterval(tick, 1500);
    return () => window.clearInterval(id);
  }, [db, roomCode]);

  const boardResult = calculateWinner(currentSquares);
  const boardWinner = boardResult?.winner;
  const boardIsDraw = !boardWinner && currentSquares.every(Boolean);

  const matchEnded = Boolean(remote?.matchEnded);
  const matchWinner = remote?.matchWinner ?? null;
  const endedReason = remote?.endedReason ?? null;

  const winner = matchEnded
    ? matchWinner === "X" || matchWinner === "O"
      ? matchWinner
      : null
    : boardWinner;

  const isDraw = matchEnded
    ? matchWinner === "draw"
    : boardIsDraw;

  const isMyTurn =
    myRole &&
    ((myRole === "X" && xIsNext) || (myRole === "O" && !xIsNext));

  const canPlay =
    Boolean(myRole) &&
    !isSpectator &&
    !matchEnded &&
    isMyTurn &&
    !boardWinner &&
    Boolean(remote);

  const play = useCallback(
    async (index) => {
      if (!db || !roomCode || !myRole) return;
      if (overlayLock.current || pending) return;
      if (!canPlay || currentSquares[index]) return;

      const d = latestServerRef.current;
      if (!d || d.matchEnded) return;

      const squares = boardFromString(d.history[d.currentMove]);
      const turn = xIsNextForMove(d.currentMove);
      const expected = turn ? "X" : "O";
      if (myRole !== expected) return;

      const w0 = calculateWinner(squares)?.winner;
      if (w0 || squares[index]) return;

      const next = squares.slice();
      next[index] = expected;
      const nextHist = [
        ...d.history.slice(0, d.currentMove + 1),
        stringFromBoard(next),
      ];
      const nextMove = nextHist.length - 1;

      const nw = calculateWinner(next)?.winner;
      const nd = !nw && next.every((cell) => Boolean(cell));

      /** @type {PendingOverlay} */
      const optimistic = {
        kind: "play",
        history: nextHist,
        currentMove: nextMove,
      };
      if (nw) {
        optimistic.matchEnded = true;
        optimistic.matchWinner = nw;
        optimistic.endedReason = "board";
      } else if (nd) {
        optimistic.matchEnded = true;
        optimistic.matchWinner = "draw";
        optimistic.endedReason = "draw";
      }

      overlayLock.current = true;
      setWriteError(null);
      setPending(optimistic);

      const ref = doc(db, GAME_COLLECTION, roomCode);
      const patch = {
        history: nextHist,
        currentMove: nextMove,
      };
      if (nw) {
        patch.matchEnded = true;
        patch.matchWinner = nw;
        patch.endedReason = "board";
      } else if (nd) {
        patch.matchEnded = true;
        patch.matchWinner = "draw";
        patch.endedReason = "draw";
      }

      try {
        await updateDoc(ref, patch);
      } catch (e) {
        setPending(null);
        setWriteError(e.message || "Move failed");
      }
    },
    [db, roomCode, myRole, canPlay, currentSquares, pending]
  );

  const goToMove = useCallback(
    async (moveIndex) => {
      if (!db || !myRole || !roomCode || isSpectator) return;
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
    [db, myRole, roomCode, pending, isSpectator]
  );

  const reset = useCallback(async () => {
    if (!db || !myRole || !roomCode || isSpectator) return;
    if (overlayLock.current || pending) return;

    const nextHist = [EMPTY_BOARD_STRING];
    overlayLock.current = true;
    setWriteError(null);
    setPending({
      kind: "reset",
      history: nextHist,
      currentMove: 0,
      matchEnded: false,
      matchWinner: null,
      endedReason: null,
    });

    const ref = doc(db, GAME_COLLECTION, roomCode);
    try {
      await updateDoc(ref, {
        history: nextHist,
        currentMove: 0,
        matchEnded: false,
        matchWinner: null,
        endedReason: null,
      });
    } catch (e) {
      setPending(null);
      setWriteError(e.message || "Reset failed");
    }
  }, [db, myRole, roomCode, pending, isSpectator]);

  const releaseSeat = useCallback(async () => {
    if (!db || !roomCode || !myRole) return;
    const ref = doc(db, GAME_COLLECTION, roomCode);
    const d = latestServerRef.current;
    const bothSeated = Boolean(d?.xPlayer && d?.oPlayer);

    if (bothSeated && !d?.matchEnded) {
      const other = myRole === "X" ? "O" : "X";
      try {
        await updateDoc(ref, {
          matchEnded: true,
          matchWinner: other,
          endedReason: "forfeit",
        });
      } catch {
        /* best-effort */
      }
      return;
    }

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
    historyStrings,
    currentMove: remote?.currentMove ?? 0,
    currentSquares,
    xIsNext,
    winner,
    winningLine: boardResult?.line ?? null,
    isDraw,
    myRole,
    isSpectator,
    bothRosterFilled,
    canPlay,
    play,
    goToMove,
    reset,
    releaseSeat,
    matchEnded,
    matchWinner,
    endedReason,
  };
}
