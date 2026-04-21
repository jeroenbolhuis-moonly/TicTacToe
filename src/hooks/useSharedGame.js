import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  doc,
  onSnapshot,
  runTransaction,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getDb } from "../firebase";
import { boardFromString, stringFromBoard } from "../game/boardCodec";
import { EMPTY_BOARD_STRING } from "../game/constants";
import { calculateWinner, xIsNextForMove } from "../game/logic";
import { getOrCreateClientId } from "../lib/clientId";

const GAME_COLLECTION = "games";
const GAME_ID = "default";

const initialPayload = () => ({
  history: [EMPTY_BOARD_STRING],
  currentMove: 0,
  xPlayer: null,
  oPlayer: null,
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
  };
}

export function useSharedGame() {
  const db = getDb();
  const clientId = useMemo(() => getOrCreateClientId(), []);
  const [raw, setRaw] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [writeError, setWriteError] = useState(null);
  const claimStarted = useRef(false);

  const remote = raw ? normalizeRemote(raw) : null;

  const historyBoards = useMemo(() => {
    if (!remote) return [];
    return remote.history.map(boardFromString);
  }, [remote]);

  const currentSquares = historyBoards[remote?.currentMove ?? 0] ?? Array(9).fill(null);
  const xIsNext = xIsNextForMove(remote?.currentMove ?? 0);

  const myRole = useMemo(() => {
    if (!remote) return null;
    if (remote.xPlayer === clientId) return "X";
    if (remote.oPlayer === clientId) return "O";
    return null;
  }, [remote, clientId]);

  const seatFull =
    remote &&
    remote.xPlayer &&
    remote.oPlayer &&
    !myRole;

  useEffect(() => {
    if (!db) return undefined;

    const ref = doc(db, GAME_COLLECTION, GAME_ID);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setLoadError(null);
        if (!snap.exists()) {
          void setDoc(ref, initialPayload(), { merge: true });
          return;
        }
        setRaw(snap.data());
      },
      (err) => {
        setLoadError(err.message || "Could not load game");
      }
    );
    return () => unsub();
  }, [db]);

  useEffect(() => {
    if (!db || !remote || claimStarted.current) return;
    if (myRole) return;
    if (seatFull) return;

    claimStarted.current = true;
    const ref = doc(db, GAME_COLLECTION, GAME_ID);

    void runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) return;
      const d = snap.data();
      const x = d.xPlayer ?? null;
      const o = d.oPlayer ?? null;
      if (x === clientId || o === clientId) return;
      if (!x) {
        transaction.update(ref, { xPlayer: clientId });
        return;
      }
      if (!o && x !== clientId) {
        transaction.update(ref, { oPlayer: clientId });
      }
    }).catch(() => {
      claimStarted.current = false;
    });
  }, [db, remote, myRole, seatFull, clientId]);

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
      if (!db || !remote || !canPlay) return;
      if (currentSquares[index]) return;
      setWriteError(null);
      const ref = doc(db, GAME_COLLECTION, GAME_ID);
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
    [db, remote, canPlay, myRole, currentSquares]
  );

  const goToMove = useCallback(
    async (moveIndex) => {
      if (!db || !remote || !myRole) return;
      if (moveIndex < 0 || moveIndex >= remote.history.length) return;
      setWriteError(null);
      const ref = doc(db, GAME_COLLECTION, GAME_ID);
      try {
        await updateDoc(ref, { currentMove: moveIndex });
      } catch (e) {
        setWriteError(e.message || "Could not jump in history");
      }
    },
    [db, remote, myRole]
  );

  const reset = useCallback(async () => {
    if (!db || !myRole) return;
    setWriteError(null);
    const ref = doc(db, GAME_COLLECTION, GAME_ID);
    try {
      await updateDoc(ref, {
        history: [EMPTY_BOARD_STRING],
        currentMove: 0,
      });
    } catch (e) {
      setWriteError(e.message || "Reset failed");
    }
  }, [db, myRole]);

  return {
    loading: Boolean(db) && raw === null && !loadError,
    configured: Boolean(db),
    loadError,
    writeError,
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
  };
}
