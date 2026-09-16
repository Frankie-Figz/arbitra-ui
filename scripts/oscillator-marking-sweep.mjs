// The sentinel sweep, as a runnable harness.
//
// INVARIANT A and INVARIANT B are both statements about what reaches the DOM,
// and neither can be settled by reading source. So this plants a unique sentinel
// at EVERY string leaf the manifest classifies, checks that the shared gate
// still accepts the block, and — given the HTML that block rendered to — reports
// which sentinels reached the DOM, whether each one landed inside a node marked
// `data-producer`, and whether that node had an ancestor bearing a counter-claim.
//
// The target is zero unmarked producer strings in the DOM, and zero sentinels
// from a path classified `opaque` reaching it at all.
//
//   1. node scripts/oscillator-marking-sweep.mjs plant  <block.json> <out-dir>
//   2. copy <out-dir>/projection.json over app/data/oscillator-alpha-watch.json,
//      npm run build, render the worker to <out-dir>/rendered.html, restore
//   3. node scripts/oscillator-marking-sweep.mjs grep   <out-dir>
//
// tests/oscillator-watch.test.mjs holds the same two invariants against the
// SHIPPED render on every `npm test`, without a rebuild; this harness is how the
// exhaustive, every-leaf version gets run when the classification changes.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  IDENTIFIER_SETS,
  OSCILLATOR_STRING_MANIFEST,
  isProducerValue,
} from "./oscillator-vocabulary.mjs";
import { oscillatorWatchHonestyViolation } from "./oscillator-honesty.mjs";

const pad = (value) => String(value).padStart(4, "0");

/**
 * A sentinel that satisfies `declared`, or null where the class admits none.
 *
 * A closed set admits one only because the sweep also declares it: the point of
 * a sentinel at an `id:` path is to prove the value is MARKED where it renders,
 * not to prove the gate can be got past.
 */
function sentinelFor(declared, index) {
  const tag = `zqs${pad(index)}zq`;
  if (declared == null) return null;
  if (declared === "opaque") return { value: tag, tag, declares: null };
  if (declared === "timestamp") {
    // Rendered through the date formatter, so this must not appear verbatim.
    // If it does, a timestamp is being echoed raw and is an unmarked string.
    const stamp = `2099-01-01T00:00:00.${pad(index)}Z`;
    return { value: stamp, tag: stamp, declares: null };
  }
  if (declared.startsWith("enum:")) return null;
  if (declared.startsWith("member:")) return null;
  if (declared.startsWith("id:")) {
    const set = declared.slice("id:".length);
    const shape = IDENTIFIER_SETS[set];
    if (shape == null) return null;
    if (set === "asset") return { value: `ZQS${pad(index)}ZQ`, tag: `ZQS${pad(index)}ZQ`, declares: set };
    if (set === "timeframe") return { value: `${1000 + index}h`, tag: `${1000 + index}h`, declares: set };
    if (set === "version") return { value: `9.${index}.0`, tag: `9.${index}.0`, declares: null };
    if (set === "runId") return { value: `deadbeef${pad(index)}`, tag: `deadbeef${pad(index)}`, declares: null };
    if (set === "registryId") return { value: `zqs-${pad(index)}-zq`, tag: `zqs-${pad(index)}-zq`, declares: set };
    return { value: tag, tag, declares: set };
  }
  if (declared.startsWith("coded:") || declared === "fragment" || declared === "caveat") {
    return { value: { quoted: tag }, tag, declares: null };
  }
  return null;
}

/** Plant a sentinel at every classified leaf of `block`, in place. */
export function plantSentinels(block) {
  const planted = [];
  // The watch id is a JOIN key: the gate cross-references the live lane and the
  // ledger against the roster, so one sentinel per VALUE keeps the block whole.
  const joined = new Map();
  let index = 0;
  const visit = (value, path, parent, key) => {
    if (value == null || typeof value === "number" || typeof value === "boolean") return;
    if (typeof value === "string" || isProducerValue(value)) {
      const declared = Object.hasOwn(OSCILLATOR_STRING_MANIFEST, path)
        ? OSCILLATOR_STRING_MANIFEST[path]
        : null;
      let made = sentinelFor(declared, index);
      if (made != null && path.endsWith("watchId") && typeof value === "string") {
        if (!joined.has(value)) joined.set(value, made);
        made = joined.get(value);
      }
      if (made != null) {
        parent[key] = made.value;
        if (made.declares != null) {
          const members = block.vocabulary?.[made.declares];
          if (Array.isArray(members) && !members.includes(made.value)) members.push(made.value);
        }
      }
      planted.push({ path, declared, index, tag: made?.tag ?? null });
      index += 1;
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, at) => visit(entry, `${path}[]`, value, at));
      return;
    }
    if (typeof value === "object") {
      for (const [name, entry] of Object.entries(value)) {
        visit(entry, path.length > 0 ? `${path}.${name}` : name, value, name);
      }
    }
  };
  // The declared vocabulary is not a value: planting into it would be planting
  // into the block's own statement of what it may print. It is walked last, and
  // only so the members the sweep added above are counted.
  visit(block, "", null, null);
  return planted;
}

// ── The DOM half ─────────────────────────────────────────────────────────────

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/**
 * Walk `html` once, reporting the open-element stack at every text run.
 *
 * @param {string} html
 * @param {(text: string, stack: {name: string, attrs: string}[], at: number) => void} onText
 */
export function walkHtml(html, onText) {
  const stack = [];
  let index = 0;
  while (index < html.length) {
    const next = html.indexOf("<", index);
    if (next < 0) {
      onText(html.slice(index), stack, index);
      break;
    }
    if (next > index) onText(html.slice(index, next), stack, index);
    if (html.startsWith("<!--", next)) {
      const close = html.indexOf("-->", next);
      index = close < 0 ? html.length : close + 3;
      continue;
    }
    const close = html.indexOf(">", next);
    if (close < 0) break;
    const raw = html.slice(next + 1, close);
    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim().toLowerCase();
      for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
        if (stack[depth].name === name) {
          stack.length = depth;
          break;
        }
      }
    } else {
      const match = /^([a-zA-Z][a-zA-Z0-9-]*)([\s\S]*)$/.exec(raw);
      if (match != null) {
        const name = match[1].toLowerCase();
        const attrs = match[2];
        if (!VOID_TAGS.has(name) && !attrs.trimEnd().endsWith("/")) {
          stack.push({ name, attrs });
        } else {
          onText("", [...stack, { name, attrs }], next);
        }
      }
    }
    index = close + 1;
  }
}

const hasAttr = (stack, attr) => stack.some((entry) => entry.attrs.includes(attr));

/**
 * For each sentinel: did it reach the DOM, inside a marked node, under a bearer?
 *
 * @param {string} section the rendered oscillator section
 * @param {{path: string, declared: string|null, tag: string|null}[]} planted
 */
export function gradeSentinels(section, planted) {
  const state = new Map();
  walkHtml(section, (text, stack) => {
    if (text.length === 0) return;
    const marked = hasAttr(stack, "data-producer");
    const borne = hasAttr(stack, "data-bears-authority");
    for (const entry of planted) {
      if (entry.tag == null || !text.includes(entry.tag)) continue;
      const row = state.get(entry.tag) ?? { inDom: false, marked: true, borne: true };
      row.inDom = true;
      row.marked = row.marked && marked;
      row.borne = row.borne && borne;
      state.set(entry.tag, row);
    }
  });
  const seen = new Set();
  const rows = [];
  for (const entry of planted) {
    if (entry.tag == null || seen.has(entry.tag)) continue;
    seen.add(entry.tag);
    const row = state.get(entry.tag) ?? { inDom: false, marked: null, borne: null };
    rows.push({ ...entry, ...row });
  }
  return rows;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "plant") {
    const [blockPath, outDir] = rest;
    const block = JSON.parse(await readFile(blockPath, "utf8"));
    const planted = plantSentinels(block);
    const violation = oscillatorWatchHonestyViolation(block);
    await mkdir(outDir, { recursive: true });
    await writeFile(resolve(outDir, "projection.json"), `${JSON.stringify(block, null, 2)}\n`, "utf8");
    await writeFile(resolve(outDir, "planted.json"), JSON.stringify(planted, null, 1), "utf8");
    const byClass = new Map();
    for (const entry of planted) {
      const key = entry.declared ?? "UNCLASSIFIED";
      const row = byClass.get(key) ?? { leaves: 0, planted: 0 };
      row.leaves += 1;
      if (entry.tag != null) row.planted += 1;
      byClass.set(key, row);
    }
    for (const [key, row] of [...byClass].sort()) {
      process.stdout.write(
        `  ${key.padEnd(26)} leaves ${String(row.leaves).padStart(4)}  planted ${String(row.planted).padStart(4)}\n`,
      );
    }
    process.stdout.write(`string leaves ${planted.length}\n`);
    process.stdout.write(`gate ${violation ?? "ACCEPT"}\n`);
  } else if (mode === "grep") {
    const [outDir] = rest;
    const html = await readFile(resolve(outDir, "rendered.html"), "utf8");
    const planted = JSON.parse(await readFile(resolve(outDir, "planted.json"), "utf8"));
    const anchor = html.indexOf('id="oscillator-watch"');
    const section = anchor < 0 ? html : html.slice(html.lastIndexOf("<section", anchor));
    const rows = gradeSentinels(section, planted);
    const inDom = rows.filter((row) => row.inDom);
    const unmarked = inDom.filter((row) => !row.marked);
    const unborne = inDom.filter((row) => !row.borne);
    const opaqueInDom = inDom.filter((row) => row.declared === "opaque");
    const byPath = new Map();
    for (const row of inDom) {
      const key = `${row.declared}  ${row.path}`;
      const cell = byPath.get(key) ?? { n: 0, marked: 0, borne: 0 };
      cell.n += 1;
      if (row.marked) cell.marked += 1;
      if (row.borne) cell.borne += 1;
      byPath.set(key, cell);
    }
    for (const [key, cell] of [...byPath].sort()) {
      const flag = cell.marked === cell.n && cell.borne === cell.n ? "marked+borne" : "UNMARKED    ";
      process.stdout.write(`  ${flag} ${String(cell.n).padStart(4)}  ${key}\n`);
    }
    process.stdout.write(`sentinels planted   ${rows.length}\n`);
    process.stdout.write(`reached the DOM     ${inDom.length}\n`);
    process.stdout.write(`unmarked in the DOM ${unmarked.length}\n`);
    process.stdout.write(`unborne in the DOM  ${unborne.length}\n`);
    process.stdout.write(`opaque in the DOM   ${opaqueInDom.length}\n`);
    for (const row of [...unmarked, ...opaqueInDom].slice(0, 20)) {
      process.stdout.write(`  ! ${row.declared} ${row.path} ${row.tag}\n`);
    }
  } else {
    process.stdout.write("usage: oscillator-marking-sweep.mjs plant <block.json> <out-dir> | grep <out-dir>\n");
  }
}
