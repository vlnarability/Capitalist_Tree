import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src', import.meta.url));

// Match `import ... from 'X'` and `import 'X'` statements only — comments
// are not flagged.
const FORBIDDEN_IMPORTS: readonly RegExp[] = [
  /^\s*import\s+[^;]*from\s+['"]next(?:\/[^'"]*)?['"]/m,
  /^\s*import\s+[^;]*from\s+['"]react(?:\/[^'"]*)?['"]/m,
  /^\s*import\s+[^;]*from\s+['"]react-dom(?:\/[^'"]*)?['"]/m,
  /^\s*import\s+[^;]*from\s+['"]@reduxjs\/[^'"]*['"]/m,
  /^\s*import\s+[^;]*from\s+['"]idb(?:\/[^'"]*)?['"]/m,
  // Relative path that escapes up into the web app.
  /^\s*import\s+[^;]*from\s+['"]\.\.\/\.\.\/\.\.\/apps\/[^'"]*['"]/m,
  // `@/...` is the web app's path alias — should never resolve here.
  /^\s*import\s+[^;]*from\s+['"]@\/[^'"]*['"]/m,
];

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      walk(p, acc);
    } else if (p.endsWith('.ts')) {
      acc.push(p);
    }
  }
  return acc;
}

describe('import boundary (TDD §3): packages/simulation/src', () => {
  it('contains no imports from next/react/react-dom/@reduxjs/idb or the web app', () => {
    const files = walk(root);
    expect(files.length).toBeGreaterThan(0);
    const violations: { file: string; matches: RegExp[] }[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const matches = FORBIDDEN_IMPORTS.filter((re) => re.test(content));
      if (matches.length > 0) {
        violations.push({ file: relative(root, file), matches });
      }
    }
    if (violations.length > 0) {
      console.error('Import boundary violations:', violations);
    }
    expect(violations).toEqual([]);
  });
});
