import { EMPTY_BOARD_STRING } from "../game/constants";
import { stringFromBoard } from "../game/boardCodec";
import { placementAtMove } from "./placementAtMove";

describe("placementAtMove", () => {
  it("returns null for start index", () => {
    const h = [EMPTY_BOARD_STRING, "X........"];
    expect(placementAtMove(h, 0)).toBeNull();
  });

  it("finds X at first move", () => {
    const h = [EMPTY_BOARD_STRING, "X........"];
    expect(placementAtMove(h, 1)).toEqual({ index: 0, symbol: "X" });
  });

  it("finds O on second move", () => {
    const h = [
      EMPTY_BOARD_STRING,
      "X........",
      stringFromBoard(["X", "O", null, null, null, null, null, null, null]),
    ];
    expect(placementAtMove(h, 2)).toEqual({ index: 1, symbol: "O" });
  });
});
