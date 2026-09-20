#!/usr/bin/env python3
"""Run recovered news scripts on Python 3.9 with postponed annotations."""

import __future__
import sys
from pathlib import Path


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: run_legacy_news.py <script> [args...]")

    target = Path(sys.argv[1]).resolve()
    sys.argv = [str(target), *sys.argv[2:]]
    sys.path.insert(0, str(target.parent))
    source = target.read_text(encoding="utf-8-sig")
    code = compile(
        source,
        str(target),
        "exec",
        flags=__future__.annotations.compiler_flag,
        dont_inherit=True,
    )
    namespace = {
        "__name__": "__main__",
        "__file__": str(target),
        "__package__": None,
        "__cached__": None,
    }
    exec(code, namespace)


if __name__ == "__main__":
    main()
