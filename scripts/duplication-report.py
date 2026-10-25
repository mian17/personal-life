#!/usr/bin/env python3
"""Approximate SonarQube CPD over product code, for before/after comparison.

Community Edition keeps one analysis per project and only scans `dev`, so the
server cannot show a branch's duplication figure before merge. This script is the
inspectable substitute: same algorithm on two trees, printed comparison.

It is deliberately simpler than SonarQube's CPD (which also ignores imports and
merges overlapping windows). Read it as a relative measure, never as the server's
number.

Usage:
    python3 scripts/duplication-report.py <tree-a> [<tree-b>]

With one tree it prints that tree's duplicate blocks. With two it prints both
counts plus the blocks that appear in only one, so a regression is visible.
"""

from __future__ import annotations

import hashlib
import sys
from collections import defaultdict
from pathlib import Path

# A block is a run of this many consecutive code lines, matching CPD's default.
WINDOW = 10

# Mirrors sonar.cpd.exclusions plus build output and vendored code.
SKIP_DIRS = {
    'node_modules', '.git', '.next', 'dist', 'coverage', '.pi', 'pictures',
    'docs', 'test', 'tests', '__tests__', '.turbo',
}
EXTS = {'.ts', '.tsx', '.js', '.jsx', '.mjs', '.css'}


def is_comment(line: str) -> bool:
    stripped = line.strip()
    return stripped.startswith(('//', '*', '/*', '*/')) or stripped == ''


def normalize(line: str) -> str:
    return ' '.join(line.split())


def product_files(root: Path):
    for path in root.rglob('*'):
        if not path.is_file() or path.suffix not in EXTS:
            continue
        if set(path.parts) & SKIP_DIRS:
            continue
        name = path.name
        if ('.test.' in name or '.spec.' in name or '.e2e-spec.' in name
                or name.endswith('.d.ts')):
            continue
        yield path


def code_lines(path: Path):
    """(line_number, normalized_text) for code lines; comments and blanks dropped."""
    return [
        (number, normalize(raw))
        for number, raw in enumerate(path.read_text(errors='replace').splitlines(), 1)
        if not is_comment(raw)
    ]


def duplicate_blocks(root: Path):
    """{sha1 of window text: [(relative path, first line, last line), ...]}."""
    windows: defaultdict[str, list[tuple[Path, int, int]]] = defaultdict(list)
    scanned = 0
    for path in product_files(root):
        scanned += 1
        lines = code_lines(path)
        for start in range(len(lines) - WINDOW + 1):
            chunk = lines[start:start + WINDOW]
            text = '\n'.join(norm for _, norm in chunk)
            windows[hashlib.sha1(text.encode()).hexdigest()].append(
                (path.relative_to(root), chunk[0][0], chunk[-1][0])
            )
    cross_file = {
        digest: locs
        for digest, locs in windows.items()
        if len({str(path) for path, _, _ in locs}) > 1
    }
    return scanned, cross_file


def describe(root: Path, limit: int = 40) -> dict[str, str]:
    scanned, blocks = duplicate_blocks(root)
    print(f'{root}: {scanned} product files, {len(blocks)} duplicate {WINDOW}-line blocks')
    for digest in sorted(blocks, key=lambda d: str(blocks[d][0][0])):
        locs = blocks[digest]
        shown = ' | '.join(f'{path}:{start}-{end}' for path, start, end in locs[:4])
        print(f'  {shown}')
    if len(blocks) > limit:
        print(f'  ... and {len(blocks) - limit} more')
    return {
        digest: ' | '.join(f'{path}:{start}-{end}' for path, start, end in locs[:4])
        for digest, locs in blocks.items()
    }


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__.strip())
        return 2

    before = describe(Path(argv[1]))
    if len(argv) < 3:
        return 0

    after = describe(Path(argv[2]))
    print()
    print(f'baseline {len(before)} blocks -> after {len(after)} blocks '
          f'({len(before) - len(after)} fewer)')

    introduced = sorted(set(after) - set(before))
    print(f'blocks present only after: {len(introduced)}')
    for digest in introduced:
        print(f'  NEW {after[digest]}')
    return 1 if introduced else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
