"""Export deterministic Pydantic OpenAPI/tool schemas; JSON is valid YAML 1.2."""

import argparse
import sys
from pathlib import Path

from onholidai_agent.models.contracts import exported_files


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--output-root", type=Path)
    arguments = parser.parse_args()
    root = arguments.output_root or Path(__file__).resolve().parents[2]
    drift: list[str] = []
    for path, content in exported_files(root).items():
        if arguments.check:
            if not path.exists() or path.read_text(encoding="utf-8") != content:
                drift.append(str(path.relative_to(root)))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8", newline="\n")
    if drift:
        print("Agent contract drift: " + ", ".join(drift), file=sys.stderr)
        raise SystemExit(1)
    print("Agent contracts checked." if arguments.check else "Agent contracts exported.")


if __name__ == "__main__":
    main()
