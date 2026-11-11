"""Cache tiktoken's public, hash-verified encoding data before offline tests."""

import os
from pathlib import Path

import tiktoken


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    os.environ.setdefault("TIKTOKEN_CACHE_DIR", str(root / ".cache/tiktoken"))
    tiktoken.get_encoding("o200k_base")
    print("Tokenizer data is ready. No model requests or credentials were used.")


if __name__ == "__main__":
    main()
