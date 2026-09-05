// Build-time freshness warning for the bundled oscillator-alpha-watch projection.
//
// `app/data/oscillator-alpha-watch.json` is IMPORTED INTO THE BUNDLE, not fetched
// at runtime, so `npm run build` ships whatever it said when the build ran. A
// stale bundle is never presented as current — the honesty gate refuses it and
// the section is replaced by a withheld notice — but that is a surprising thing
// to discover in production when the only cause is a deploy that skipped
// `npm run sync:data`.
//
// Runs as npm's `prebuild`, so it fires on every `npm run build` without changing
// the build command. It NEVER fails the build: a warning that can break a deploy
// is worse than the staleness it warns about.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { projectionDigest } from "./oscillator-watch.mjs";

const STALE_AFTER_HOURS = 24;

const uiRoot = fileURLToPath(new URL("../", import.meta.url));
const bundledPath = resolve(uiRoot, "app", "data", "oscillator-alpha-watch.json");

function warn(lines) {
  const width = Math.max(...lines.map((line) => line.length));
  const rule = "─".repeat(width + 2);
  process.stderr.write(`\n┌${rule}┐\n`);
  for (const line of lines) process.stderr.write(`│ ${line.padEnd(width)} │\n`);
  process.stderr.write(`└${rule}┘\n\n`);
}

try {
  if (!existsSync(bundledPath)) {
    warn([
      "oscillator alpha watch: app/data/oscillator-alpha-watch.json is missing.",
      "The section will render its withheld notice.",
      "Run `npm run sync:data` before `npm run build`.",
    ]);
  } else {
    const block = JSON.parse(await readFile(bundledPath, "utf8"));
    if (block.available === false) {
      warn([
        "oscillator alpha watch: the bundled projection is a REFUSAL, not a roster.",
        `reason: ${String(block.reason ?? "unstated").slice(0, 90)}`,
        "The section will render its withheld notice. Run `npm run sync:data`.",
      ]);
    } else {
      // N5 residual. Freshness used to be keyed on run IDENTITY, and two trees
      // that agree on runId, generatedAt, evaluatorVersion and cells[0].watchId
      // can still differ in content. The projection carries a digest of its own
      // content; a projection edited after the sync wrote it no longer matches.
      const digest = projectionDigest(block);
      if (block.projectionSha256 == null) {
        warn([
          "oscillator alpha watch: the bundled projection carries no content digest.",
          "Nothing downstream can tell which projection a build consumed.",
          "Run `npm run sync:data` to regenerate it.",
        ]);
      } else if (block.projectionSha256 !== digest) {
        warn([
          "oscillator alpha watch: the bundled projection does not match its own digest.",
          `stated ${String(block.projectionSha256).slice(0, 16)}, content hashes to ${digest.slice(0, 16)}.`,
          "It was edited after the sync wrote it. Run `npm run sync:data`.",
        ]);
      }
      const generated = Date.parse(block.generatedAt ?? "");
      if (Number.isFinite(generated)) {
        const hours = (Date.now() - generated) / 3_600_000;
        if (hours > STALE_AFTER_HOURS) {
          warn([
            "oscillator alpha watch: the bundled projection is "
            + `${Math.floor(hours)}h old (${block.generatedAt}).`,
            "It is bundled at BUILD time, so this build ships that run.",
            "Run `npm run sync:data` before `npm run build` on every deploy.",
          ]);
        }
      }
    }
  }
} catch (error) {
  warn([
    "oscillator alpha watch: could not check the bundled projection.",
    String(error?.message ?? error).slice(0, 90),
  ]);
}

// Always succeed. This is a notice, not a gate.
process.exit(0);
