// Chat word filter. Banned words are masked, never deleted: first and
// last letter kept with stars between ("f**k"), words of two letters or
// fewer become all stars, whole-word matches only, case-insensitive
// with the kept letters preserving their original casing. The shape of
// the sentence survives without the word being printed.
//
// The list ships in server/assets/banned-words.txt; a copy the operator
// puts at data/banned-words.txt takes precedence, so edits live in the
// data volume and survive updates.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const DEFAULT_LIST = path.join(
  path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "banned-words.txt");

let matcher = null;

function loadWords() {
  const custom = path.join(config.dataDir, "banned-words.txt");
  const file = fs.existsSync(custom) ? custom : DEFAULT_LIST;
  const words = fs.readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !l.startsWith("#"));
  if (words.length === 0) return null;
  const escaped = words
    .sort((a, b) => b.length - a.length) // longest first so "fucking" wins over "fuck"
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![\\p{L}\\p{N}])(${escaped.join("|")})(?![\\p{L}\\p{N}])`, "giu");
}

export function maskWord(word) {
  if (word.length <= 2) return "*".repeat(word.length);
  return word[0] + "*".repeat(word.length - 2) + word[word.length - 1];
}

export function filterText(text) {
  if (matcher === null) matcher = loadWords() || false;
  if (!matcher) return text;
  matcher.lastIndex = 0;
  return text.replace(matcher, (w) => maskWord(w));
}

// Test hook: forget the cached list so a different data dir applies
export function reloadWords() {
  matcher = null;
}
