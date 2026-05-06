// Mechanical transformer: convert files that import the static `colors`
// from theme.ts to consume it via `useTheme()` instead, with styles
// hoisted into a `makeStyles(colors: ThemeColors)` factory called via
// `useMemo` at the top of every function-component body.
//
// Run from the repo root: `node scripts/dark-mode-sweep.mjs path/to/file.tsx`
// Mutates files in place.
import fs from 'fs';
import path from 'path';

if (process.argv.length < 3) {
  console.error('usage: node dark-mode-sweep.mjs <files...>');
  process.exit(1);
}

const files = process.argv.slice(2);
let touched = 0;
let skipped = [];

for (const filePath of files) {
  const resolved = path.resolve(filePath);
  let src = fs.readFileSync(resolved, 'utf8');

  // ── 1. Theme import: drop static `colors`, add `useTheme` ──────────────
  // Match a single import block that pulls colors from `..theme`.
  const importRe = /import\s*\{\s*([^}]+?)\s*\}\s*from\s*('[^']*\/theme'|"[^"]*\/theme");/;
  const m = src.match(importRe);
  if (!m) {
    skipped.push(`${filePath} :: no theme import found`);
    continue;
  }
  const names = m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!names.includes('colors')) {
    skipped.push(`${filePath} :: theme import has no \`colors\` (already migrated?)`);
    continue;
  }
  const newNames = names.filter((n) => n !== 'colors');
  if (!newNames.includes('useTheme')) newNames.unshift('useTheme');
  // Preserve existing newlines/formatting roughly: 4-name single-line, more = multi-line
  const replacementImport =
    newNames.length <= 4
      ? `import { ${newNames.join(', ')} } from ${m[2]};`
      : `import {\n  ${newNames.join(',\n  ')},\n} from ${m[2]};`;
  // Add ThemeColors type import on the next line (only if not already there)
  const themeColorsImport = `import type { ThemeColors } from ${m[2]};`;
  if (!src.includes(themeColorsImport)) {
    src = src.replace(importRe, `${replacementImport}\n${themeColorsImport}`);
  } else {
    src = src.replace(importRe, replacementImport);
  }

  // ── 2. Ensure useMemo is in the React imports ──────────────────────────
  // Match `import React, { ... } from 'react';` OR `import { ... } from 'react';`
  const reactRe = /import\s+(React,\s*)?\{\s*([^}]*?)\s*\}\s*from\s*('react'|"react");/;
  const r = src.match(reactRe);
  if (r) {
    const reactNames = r[2]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!reactNames.includes('useMemo')) {
      reactNames.push('useMemo');
      const lead = r[1] || '';
      const replReact = `import ${lead}{ ${reactNames.join(', ')} } from ${r[3]};`;
      src = src.replace(reactRe, replReact);
    }
  }

  // ── 3. Wrap `const styles = StyleSheet.create({...});` in makeStyles ───
  // Replace the open. The content inside stays unchanged.
  const stylesOpenRe = /^const\s+styles\s*=\s*StyleSheet\.create\(\{/m;
  if (!stylesOpenRe.test(src)) {
    skipped.push(`${filePath} :: no top-level \`const styles = StyleSheet.create\``);
    continue;
  }
  src = src.replace(
    stylesOpenRe,
    'function makeStyles(colors: ThemeColors) {\n  return StyleSheet.create({'
  );
  // Append `\n}` to the file end so the makeStyles function closes after
  // the styles object (the styles are guaranteed to be the last top-level
  // statement — verified by survey). Trim trailing whitespace first.
  src = src.replace(/\s+$/, '') + '\n}\n';

  // ── 4. Inject useTheme + useMemo into each function-component body ─────
  // Heuristic: a function-component is a function declaration with a
  // PascalCase name whose body is a multiline block. We don't try to
  // detect "returns JSX" — we inject into every PascalCase function and
  // accept that pure utility helpers should be exceedingly rare with a
  // PascalCase name (and would have been flagged below). After conversion
  // we run tsc; if any plain helpers got the treatment, the compiler
  // will yell about an unused var or hooks-rule violation we can fix.
  //
  // Match `[export ]function FooBar(...) {\n` then insert at next line.
  // Capture trailing whitespace of the opening so we preserve indentation.
  src = src.replace(
    /^((?:export\s+)?function\s+[A-Z][A-Za-z0-9_]*[\s\S]*?\)\s*(?::\s*[^{]+)?\s*\{)\n/gm,
    (match, header) => {
      // Skip the makeStyles factory itself (it's not a component).
      if (/function\s+makeStyles\b/.test(header)) return match;
      return `${match}  const { colors } = useTheme();\n  const styles = useMemo(() => makeStyles(colors), [colors]);\n`;
    }
  );

  fs.writeFileSync(resolved, src, 'utf8');
  touched++;
}

console.log(`touched=${touched}`);
if (skipped.length) {
  console.log('skipped:');
  for (const s of skipped) console.log(`  ${s}`);
}
