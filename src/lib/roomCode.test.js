import {
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from "./roomCode";

describe("normalizeRoomCode", () => {
  it("strips separators and uppercases", () => {
    expect(normalizeRoomCode(" ab-12 3x ")).toBe("AB123X");
  });

  it("returns empty for non-strings", () => {
    expect(normalizeRoomCode(null)).toBe("");
    expect(normalizeRoomCode(undefined)).toBe("");
  });
});

describe("isValidRoomCode", () => {
  it("accepts six alphanumeric characters", () => {
    expect(isValidRoomCode("ABC12X")).toBe(true);
  });

  it("rejects wrong lengths", () => {
    expect(isValidRoomCode("ABC")).toBe(false);
    expect(isValidRoomCode("ABCDEFG")).toBe(false);
  });

  it("rejects empty", () => {
    expect(isValidRoomCode("")).toBe(false);
  });
});

describe("generateRoomCode", () => {
  it("produces valid codes of default length", () => {
    const code = generateRoomCode();
    expect(isValidRoomCode(code)).toBe(true);
  });

  it("respects custom length", () => {
    expect(generateRoomCode(4).length).toBe(4);
  });
});
