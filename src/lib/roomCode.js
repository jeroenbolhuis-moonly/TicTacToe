/** Crockford base32 without I/L/O/U for readable codes */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTVWXYZ";
const DEFAULT_LENGTH = 6;

function randomChar() {
  const i = Math.floor(Math.random() * ALPHABET.length);
  return ALPHABET[i];
}

export function generateRoomCode(length = DEFAULT_LENGTH) {
  let out = "";
  for (let n = 0; n < length; n += 1) out += randomChar();
  return out;
}

/** Normalize user input to a canonical room id (uppercase, strip separators). */
export function normalizeRoomCode(raw) {
  if (raw == null || typeof raw !== "string") return "";
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export function isValidRoomCode(code) {
  if (!code || typeof code !== "string") return false;
  if (code.length !== DEFAULT_LENGTH) return false;
  return /^[0-9A-Z]+$/.test(code);
}
