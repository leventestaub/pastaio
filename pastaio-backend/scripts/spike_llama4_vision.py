"""Spike: does Llama 4 Scout (via Groq) classify pasta well enough?

Pre-deciding the swap from Qwen3-VL to Llama 4 Scout means knowing if
the new model clears the 70% top-1 accuracy bar on your KB vocabulary.

USAGE (default: KaggleHub cache, 1 image per class):
    pip install groq
    $env:GROQ_API_KEY = "gsk_..."
    python scripts/spike_llama4_vision.py

Bigger run (5 per class):
    python scripts/spike_llama4_vision.py --limit-per-class 5

Custom path:
    python scripts/spike_llama4_vision.py --images-dir D:/some/other/path

The KaggleHub layout for zibranzarif/pasta-shape-dataset is nested:
versions/1/<shape>/<shape>/*.jpg. The class lookup tries both that and
the flatter versions/1/<shape>/*.jpg layout.

Note on small samples: with 1 image per class, accuracy resolution is
~20pp. A clean run is a smoke test. Bump --limit-per-class to 5+ for
a real signal before deciding the swap.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
from collections import defaultdict
from pathlib import Path


def _import_groq():
    try:
        from groq import Groq
        return Groq
    except ImportError:
        print("Missing dependency. Run: pip install groq", file=sys.stderr)
        sys.exit(1)


# Mirror of the KB vocabulary. Keep in sync with pastaio-kb/source/shapes.yaml.
KB_SHAPES = ["bucatini", "orecchiette", "penne", "spaghetti", "trofie"]

MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"

DEFAULT_DATASET_DIR = (
    Path.home()
    / ".cache"
    / "kagglehub"
    / "datasets"
    / "zibranzarif"
    / "pasta-shape-dataset"
    / "versions"
    / "1"
)

PROMPT = f"""You are a pasta shape identifier. Look at the image and identify which pasta shape it shows.

You MUST choose from this list of valid pasta shapes:
{", ".join(KB_SHAPES)}

Return JSON with these fields:
- shape: the most likely shape from the list above (string)
- confidence: how confident you are, 0.0 to 1.0 (number)

If the image does not show pasta, or shows a pasta shape not in the list, pick the closest visual match from the list and lower the confidence accordingly. Do not invent shape names. Do not include any text outside the JSON object."""


def _b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def classify(client, image_path: Path) -> dict:
    encoded = _b64(image_path)
    suffix = image_path.suffix.lower().lstrip(".")
    if suffix == "jpg":
        suffix = "jpeg"
    data_url = f"data:image/{suffix};base64,{encoded}"

    start = time.monotonic()
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
        response_format={"type": "json_object"},
        temperature=0.1,
        max_tokens=200,
    )
    latency_ms = int((time.monotonic() - start) * 1000)

    text = response.choices[0].message.content or ""
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return {
            "predicted": None,
            "confidence": 0.0,
            "latency_ms": latency_ms,
            "raw": text,
            "parse_error": True,
        }

    return {
        "predicted": str(data.get("shape", "")).strip().lower(),
        "confidence": float(data.get("confidence", 0.0)),
        "latency_ms": latency_ms,
        "raw": text,
        "parse_error": False,
    }


def find_class_dir(root: Path, shape: str) -> Path | None:
    """Find the directory containing images for a shape.

    Tries, in order:
      1. root/<shape>/<shape>/    (KaggleHub nested layout)
      2. root/<shape>/            (flat layout)
      3. capitalized variants of both

    Returns the first one that exists AND contains image files.
    """
    candidates = [
        root / shape / shape,
        root / shape,
        root / shape.capitalize() / shape.capitalize(),
        root / shape.capitalize(),
    ]
    for c in candidates:
        if not c.is_dir():
            continue
        # Confirm it actually has images, not just subdirs.
        has_images = any(
            p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")
            for p in c.iterdir()
            if p.is_file()
        )
        if has_images:
            return c
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--images-dir",
        type=Path,
        default=DEFAULT_DATASET_DIR,
        help=f"Dataset root (default: {DEFAULT_DATASET_DIR})",
    )
    parser.add_argument(
        "--limit-per-class",
        type=int,
        default=1,
        help="Cap images per class (default: 1, smoke test)",
    )
    args = parser.parse_args()

    if not args.images_dir.exists():
        print(f"Not found: {args.images_dir}", file=sys.stderr)
        sys.exit(1)

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        print("Set GROQ_API_KEY env var", file=sys.stderr)
        sys.exit(1)

    Groq = _import_groq()
    client = Groq(api_key=api_key)

    by_class: dict[str, list[Path]] = {}
    for shape in KB_SHAPES:
        class_dir = find_class_dir(args.images_dir, shape)
        if class_dir is None:
            print(f"  (skip) {shape}: no images found", file=sys.stderr)
            continue
        images = sorted(
            p for p in class_dir.iterdir()
            if p.is_file() and p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")
        )
        if args.limit_per_class:
            images = images[: args.limit_per_class]
        if images:
            by_class[shape] = images

    if not by_class:
        print(f"No KB shapes found under {args.images_dir}", file=sys.stderr)
        existing = sorted(p.name for p in args.images_dir.iterdir() if p.is_dir())
        print(f"Top-level subdirs: {existing}", file=sys.stderr)
        sys.exit(1)

    total_images = sum(len(v) for v in by_class.values())
    print(f"Classifying {total_images} images across {len(by_class)} classes")
    print(f"Model: {MODEL}")
    print(f"Source: {args.images_dir}\n")

    confusion: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    latencies: list[int] = []
    parse_errors = 0
    out_of_vocab = 0

    for truth, images in by_class.items():
        for image_path in images:
            result = classify(client, image_path)
            latencies.append(result["latency_ms"])
            predicted = result["predicted"]

            if result["parse_error"]:
                parse_errors += 1
                print(
                    f"  {truth}/{image_path.name}: PARSE ERROR "
                    f"({result['latency_ms']}ms): {result['raw'][:60]!r}"
                )
                continue

            if predicted not in KB_SHAPES:
                out_of_vocab += 1
                print(
                    f"  {truth}/{image_path.name}: OUT-OF-VOCAB "
                    f"'{predicted}' ({result['latency_ms']}ms)"
                )
                continue

            confusion[truth][predicted] += 1
            mark = "✓" if predicted == truth else "✗"
            print(
                f"  {truth}/{image_path.name}: {mark} {predicted} "
                f"({result['confidence']:.2f}, {result['latency_ms']}ms)"
            )

    # Per-class accuracy.
    print("\n" + "=" * 60)
    print("Per-class accuracy")
    print("=" * 60)
    correct_total = 0
    seen_total = 0
    for truth, images in by_class.items():
        n = len(images)
        correct = confusion[truth].get(truth, 0)
        correct_total += correct
        seen_total += n
        pct = 100.0 * correct / n if n else 0
        print(f"  {truth:14s}  {correct:3d}/{n:3d}  ({pct:5.1f}%)")

    overall = 100.0 * correct_total / seen_total if seen_total else 0
    print(f"\n  Overall: {correct_total}/{seen_total} ({overall:.1f}%)")
    print(f"  Threshold for production swap: 70%")
    print(f"  {'PASS' if overall >= 70 else 'FAIL'}")
    if seen_total < 25:
        print(
            f"  NOTE: only {seen_total} samples — "
            "rerun with --limit-per-class 5+ before deciding."
        )

    # Confusion matrix.
    print("\n" + "=" * 60)
    print("Confusion matrix (rows=truth, cols=predicted)")
    print("=" * 60)
    header = "  truth\\pred    " + "  ".join(f"{s[:8]:>8s}" for s in KB_SHAPES)
    print(header)
    for truth in KB_SHAPES:
        if truth not in by_class:
            continue
        row = f"  {truth:14s}"
        for pred in KB_SHAPES:
            count = confusion[truth].get(pred, 0)
            row += f"  {count:>8d}"
        print(row)

    # Operational stats.
    print("\n" + "=" * 60)
    print("Operational")
    print("=" * 60)
    if latencies:
        latencies.sort()
        median = latencies[len(latencies) // 2]
        p95 = latencies[int(len(latencies) * 0.95)] if len(latencies) > 1 else latencies[0]
        print(f"  latency median: {median} ms")
        print(f"  latency p95:    {p95} ms")
        print(f"  latency max:    {max(latencies)} ms")
    print(f"  parse errors:   {parse_errors}")
    print(f"  out-of-vocab:   {out_of_vocab}")


if __name__ == "__main__":
    main()