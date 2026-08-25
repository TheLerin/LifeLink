#!/usr/bin/env node
/**
 * check-syntax.mjs - offline delimiter/balance check for the LifeLink frontend.
 *
 * The npm registry is unreachable in this environment, so `vite build` cannot
 * run and .jsx files cannot be handed to a real parser. `node --check` covers
 * the plain .js files; this script covers the .jsx ones by doing the single most
 * valuable thing a parser would do - proving that every (, [ and { is closed in
 * the right order.
 *
 * To do that without a JSX grammar it tokenizes just enough JavaScript to know
 * what to ignore:
 *
 *   - // line comments and slash-star block comments
 *   - "double quoted" strings
 *   - `template literals`, including nested ${ ... } which may contain JSX
 *   - /regex/ literals, whose character classes may contain quotes
 *   - 'single quoted' strings, but ONLY where an expression can legally begin
 *
 * That last rule matters. JSX body text is not a string literal, so prose like
 *   <p>the doctor's note</p>
 * would otherwise open a phantom string at the apostrophe and swallow real
 * braces. A quote is therefore only treated as a delimiter when the previous
 * non-space character is one where a value can start ( = : , ( [ { etc. ), which
 * is true for code and false for an apostrophe inside a word.
 *
 * This is a lint, not a parser: it cannot detect a bad expression. It reliably
 * detects the mistake that actually happens when hand-editing large JSX trees -
 * a dropped or surplus closing delimiter.
 *
 * Usage: node scripts/check-syntax.mjs [--verbose]
 * Exit code 1 if any file is unbalanced.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
const VERBOSE = process.argv.includes("--verbose");

const OPEN = { "(": ")", "[": "]", "{": "}" };
const CLOSE = { ")": "(", "]": "[", "}": "{" };

/** Characters after which a quote starts a string rather than being an apostrophe. */
const EXPRESSION_START = new Set([
  "=", "(", "[", "{", ",", ":", ";", "+", "-", "*", "/", "%",
  "&", "|", "!", "?", "<", ">", "~", "^", "\n", undefined,
]);

/**
 * Characters after which a slash begins a REGEX rather than a division.
 *
 * Deliberately narrower than EXPRESSION_START: "<" and ">" are excluded because
 * in JSX they mean a closing tag (`</div>`), not a comparison.
 */
const REGEX_PREV = new Set([
  "=", "(", "[", "{", ",", ":", ";", "+", "-", "*", "%",
  "&", "|", "!", "?", "~", "^", "\n", undefined,
]);

/** Keywords after which a slash begins a regex, e.g. `return /x/.test(s)`. */
const REGEX_KEYWORD =
  /\b(return|typeof|case|in|of|do|else|yield|await|delete|void|instanceof)\s*$/;

function isRegexPosition(code, i, prevSignificant) {
  if (REGEX_PREV.has(prevSignificant)) return true;
  return REGEX_KEYWORD.test(code.slice(Math.max(0, i - 16), i));
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(jsx?|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Scan one file, returning a list of problems.
 * Uses an explicit stack so a mismatch reports the line it happened on.
 */
function checkFile(code) {
  const problems = [];
  const stack = [];

  // Template-literal nesting: each entry is the stack depth at which the
  // enclosing `${` was opened, so we know when the literal resumes.
  const templateDepths = [];

  let line = 1;
  let i = 0;
  let prevSignificant; // last non-whitespace char, for the apostrophe rule

  const n = code.length;

  while (i < n) {
    const ch = code[i];
    const next = code[i + 1];

    if (ch === "\n") {
      line += 1;
      prevSignificant = "\n";
      i += 1;
      continue;
    }

    // ---- comments ----
    if (ch === "/" && next === "/") {
      while (i < n && code[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(code[i] === "*" && code[i + 1] === "/")) {
        if (code[i] === "\n") line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }

    // ---- regex literal ----
    // A slash here is either division, a regex, or JSX punctuation. The tricky
    // cases are `</div>` and a self-closing `/>` sitting on its own line, both of
    // which look like an expression start; requiring that the next character is
    // not ">" rules them out, and REGEX_PREV already rules out "<".
    if (
      ch === "/" &&
      next !== ">" &&
      next !== "/" &&
      next !== "*" &&
      isRegexPosition(code, i, prevSignificant)
    ) {
      i += 1;
      let inClass = false;
      while (i < n) {
        const c = code[i];
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === "\n") {
          line += 1; // unterminated regex; keep line numbers honest
          break;
        }
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) {
          i += 1;
          break;
        }
        i += 1;
      }
      // Skip trailing flags (g, i, m, s, u, y).
      while (i < n && /[a-z]/.test(code[i])) i += 1;
      prevSignificant = "/regex/";
      continue;
    }

    // ---- double-quoted string ----
    if (ch === '"') {
      i += 1;
      while (i < n && code[i] !== '"') {
        if (code[i] === "\\") i += 1;
        else if (code[i] === "\n") line += 1; // unterminated, but keep counting
        i += 1;
      }
      i += 1;
      prevSignificant = '"';
      continue;
    }

    // ---- single-quoted string, only where a value may begin ----
    if (ch === "'" && EXPRESSION_START.has(prevSignificant)) {
      i += 1;
      while (i < n && code[i] !== "'") {
        if (code[i] === "\\") i += 1;
        else if (code[i] === "\n") line += 1;
        i += 1;
      }
      i += 1;
      prevSignificant = "'";
      continue;
    }

    // ---- template literal ----
    if (ch === "`") {
      i += 1;
      while (i < n) {
        if (code[i] === "\\") {
          i += 2;
          continue;
        }
        if (code[i] === "\n") line += 1;
        if (code[i] === "`") {
          i += 1;
          break;
        }
        // ${ ... } re-enters real code, which may itself contain a template.
        if (code[i] === "$" && code[i + 1] === "{") {
          stack.push({ char: "{", line });
          templateDepths.push(stack.length);
          i += 2;
          break;
        }
        i += 1;
      }
      prevSignificant = "`";
      continue;
    }

    // ---- delimiters ----
    if (OPEN[ch]) {
      stack.push({ char: ch, line });
      prevSignificant = ch;
      i += 1;
      continue;
    }

    if (CLOSE[ch]) {
      const top = stack.pop();
      if (!top) {
        problems.push(`line ${line}: unexpected closing "${ch}"`);
      } else if (top.char !== CLOSE[ch]) {
        problems.push(
          `line ${line}: closing "${ch}" does not match "${top.char}" opened on line ${top.line}`,
        );
      }

      // Closing the brace of a `${ ... }` resumes the template literal.
      if (
        ch === "}" &&
        templateDepths.length &&
        templateDepths[templateDepths.length - 1] === stack.length + 1
      ) {
        templateDepths.pop();
        i += 1;
        // Continue scanning the rest of the template string.
        while (i < n) {
          if (code[i] === "\\") {
            i += 2;
            continue;
          }
          if (code[i] === "\n") line += 1;
          if (code[i] === "`") {
            i += 1;
            break;
          }
          if (code[i] === "$" && code[i + 1] === "{") {
            stack.push({ char: "{", line });
            templateDepths.push(stack.length);
            i += 2;
            break;
          }
          i += 1;
        }
        prevSignificant = "`";
        continue;
      }

      prevSignificant = ch;
      i += 1;
      continue;
    }

    if (!/\s/.test(ch)) prevSignificant = ch;
    i += 1;
  }

  for (const open of stack) {
    problems.push(`line ${open.line}: "${open.char}" is never closed`);
  }

  return problems;
}

/* ------------------------------------------------------------------ */

const files = walk(SRC);
let failed = 0;

for (const file of files) {
  const problems = checkFile(readFileSync(file, "utf8"));
  const rel = relative(ROOT, file);
  if (problems.length) {
    failed += 1;
    console.log(`FAIL ${rel}`);
    for (const problem of problems.slice(0, 5)) console.log(`   ${problem}`);
  } else if (VERBOSE) {
    console.log(`ok   ${rel}`);
  }
}

console.log(
  `\nchecked ${files.length} files, ${failed} unbalanced.` +
    (failed ? "" : " Every delimiter opens and closes in order."),
);

process.exit(failed ? 1 : 0);
