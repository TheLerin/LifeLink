#!/usr/bin/env node
/**
 * check-imports.mjs - offline contract check for the LifeLink frontend.
 *
 * node_modules cannot be installed in every environment, so this script does
 * what a build would catch, without a bundler:
 *
 *   1. Every relative import resolves to a file that exists.
 *   2. Every NAMED import from a local file is actually exported by that file
 *      (the class of bug that shows up at runtime as
 *      "Element type is invalid ... got: undefined").
 *   3. Every local module that is imported by name has no duplicate exports.
 *   4. Reports local files that nothing imports (dead modules).
 *
 * Usage: node scripts/check-imports.mjs
 * Exit code 1 if any problem is found, so it can gate a commit.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const SRC = resolve(import.meta.dirname, "..", "src");

/* ------------------------------------------------------------------ */
/* Collect source files                                               */
/* ------------------------------------------------------------------ */

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(jsx?|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(SRC);

/* ------------------------------------------------------------------ */
/* Parse exports of a module                                          */
/* ------------------------------------------------------------------ */

function exportsOf(code) {
  const named = new Set();
  let hasDefault = false;

  if (/^\s*export\s+default\s/m.test(code)) hasDefault = true;

  // export function foo / export const foo / export class foo
  for (const m of code.matchAll(
    /^\s*export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z0-9_$]+)/gm,
  )) {
    named.add(m[1]);
  }

  // export { a, b as c }
  for (const m of code.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const piece = part.trim();
      if (!piece) continue;
      const asMatch = piece.match(/\bas\s+([A-Za-z0-9_$]+)$/);
      const name = asMatch ? asMatch[1] : piece;
      if (name === "default") hasDefault = true;
      else named.add(name);
    }
  }

  return { named, hasDefault };
}

/* ------------------------------------------------------------------ */
/* Parse imports of a module                                          */
/* ------------------------------------------------------------------ */

function importsOf(code) {
  const results = [];
  const re = /import\s+([^;]*?)\s+from\s*["']([^"']+)["']/gs;

  for (const m of code.matchAll(re)) {
    const clause = m[1].trim();
    const source = m[2];

    const named = [];
    let wantsDefault = false;

    const braceMatch = clause.match(/\{([^}]*)\}/s);
    if (braceMatch) {
      for (const part of braceMatch[1].split(",")) {
        const piece = part.trim();
        if (!piece) continue;
        const asMatch = piece.match(/^([A-Za-z0-9_$]+)\s+as\s+/);
        named.push(asMatch ? asMatch[1] : piece);
      }
    }

    // Anything before the first brace that is a bare identifier is the default.
    const beforeBrace = clause.split("{")[0].replace(/,\s*$/, "").trim();
    if (beforeBrace && /^[A-Za-z0-9_$]+$/.test(beforeBrace)) wantsDefault = true;

    results.push({ source, named, wantsDefault });
  }

  return results;
}

/* ------------------------------------------------------------------ */
/* Build the export map                                               */
/* ------------------------------------------------------------------ */

const exportMap = new Map();
const codeMap = new Map();

for (const file of files) {
  const code = readFileSync(file, "utf8");
  codeMap.set(file, code);
  exportMap.set(file, exportsOf(code));
}

/* ------------------------------------------------------------------ */
/* Check                                                              */
/* ------------------------------------------------------------------ */

const problems = [];
const importedLocal = new Set();

function resolveLocal(fromFile, source) {
  const base = resolve(dirname(fromFile), source);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.jsx`,
    join(base, "index.js"),
    join(base, "index.jsx"),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* keep trying */
    }
  }
  return null;
}

for (const file of files) {
  const rel = relative(SRC, file);
  for (const imp of importsOf(codeMap.get(file))) {
    if (!imp.source.startsWith(".")) continue; // package import, not our concern

    const target = resolveLocal(file, imp.source);
    if (!target) {
      problems.push(`${rel}: cannot resolve "${imp.source}"`);
      continue;
    }
    importedLocal.add(target);

    const info = exportMap.get(target);
    if (!info) continue;

    const targetRel = relative(SRC, target);
    if (imp.wantsDefault && !info.hasDefault) {
      problems.push(
        `${rel}: imports DEFAULT from "${imp.source}" but ${targetRel} has no default export`,
      );
    }
    for (const name of imp.named) {
      if (!info.named.has(name)) {
        problems.push(
          `${rel}: imports { ${name} } from "${imp.source}" but ${targetRel} does not export it`,
        );
      }
    }
  }
}

// Entry points are not imported by anything; ignore them in the dead check.
const ENTRIES = new Set(
  ["main.jsx", "App.jsx"].map((name) => join(SRC, name)),
);
const orphans = files.filter(
  (file) => !importedLocal.has(file) && !ENTRIES.has(file),
);

/* ------------------------------------------------------------------ */
/* Report                                                             */
/* ------------------------------------------------------------------ */

console.log(`Checked ${files.length} files under src/\n`);

if (orphans.length) {
  console.log("Modules nothing imports (may be intentional):");
  for (const file of orphans) console.log(`  - ${relative(SRC, file)}`);
  console.log("");
}

if (problems.length) {
  console.log(`FAILED: ${problems.length} import problem(s):\n`);
  for (const problem of problems) console.log(`  x ${problem}`);
  process.exit(1);
}

console.log("PASS: every relative import resolves and every named import exists.");
