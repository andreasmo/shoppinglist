// Liest Menge und Name aus einer Eingabe wie „2 Milch“, „Milch 2x“ oder „Tomaten 500g“.

export interface ParsedInput {
  name: string;
  qty: string;
}

const UNIT = "(?:g|kg|ml|l|stk|stück|dosen?|pck|packungen?|flaschen?|x|×)";
const leadingCount = /^(\d+)\s*[x×]?\s+(.+)$/i;
const leadingAmount = new RegExp(`^(\\d+(?:[.,]\\d+)?\\s*${UNIT})\\s+(.+)$`, "i");
// Hinten nur mit Einheit, damit „Sonnencreme LSF 50“ ein Name bleibt.
const trailingAmount = new RegExp(`^(.+?)\\s+(\\d+(?:[.,]\\d+)?\\s*${UNIT})$`, "i");

function capitalize(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase("de") + s.slice(1) : s;
}

function tidyQty(q: string): string {
  const t = q.trim().replace(/\s+/g, " ");
  if (/^\d+$/.test(t)) return `${t}×`;
  return t.replace(/^(\d+)\s*[x×]$/i, "$1×");
}

export function parseInput(text: string): ParsedInput {
  const t = text.trim().replace(/\s+/g, " ");
  let m = t.match(leadingAmount);
  if (m) return { name: capitalize(m[2]), qty: tidyQty(m[1]) };
  m = t.match(leadingCount);
  if (m) return { name: capitalize(m[2]), qty: tidyQty(m[1]) };
  m = t.match(trailingAmount);
  if (m) return { name: capitalize(m[1]), qty: tidyQty(m[2]) };
  return { name: capitalize(t), qty: "" };
}
