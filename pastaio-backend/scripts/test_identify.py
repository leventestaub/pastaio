"""Identify a pasta shape from a local image, bypassing the phone.

Usage:
    python scripts/test_identify.py path/to/image.jpg
    python scripts/test_identify.py path/to/image.jpg --model qwen3-vl:8b

Run with PASTAIO_VISION_BACKEND=ollama already set (or it'll silently use
the stub and you'll wonder why the answer is always orecchiette).

This bypasses FastAPI entirely — instantiates the client directly. Useful
for iterating on the prompt or sampling params without restarting uvicorn.
"""
import argparse
import asyncio
import os
import sys
from pathlib import Path


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path, help="Path to image file")
    parser.add_argument(
        "--model",
        default=os.getenv("PASTAIO_OLLAMA_VLM_MODEL", "qwen3-vl:4b"),
        help="Ollama model name (default: qwen3-vl:4b)",
    )
    parser.add_argument(
        "--host",
        default=os.getenv("PASTAIO_OLLAMA_HOST", "http://localhost:11434"),
    )
    args = parser.parse_args()

    if not args.image.exists():
        print(f"file not found: {args.image}", file=sys.stderr)
        sys.exit(1)

    # Lazy import so the script doesn't require the ollama package unless run.
    from app.clients.ollama_vision_client import OllamaVisionClient

    client = OllamaVisionClient(model=args.model, host=args.host)
    image_bytes = args.image.read_bytes()

    print(f"identifying {args.image} with {args.model}...")
    result = await client.identify(image_bytes)
    print()
    print(f"  shape:        {result.shape}")
    print(f"  confidence:   {result.confidence:.2f}")
    print(f"  latency:      {result.latency_ms} ms")
    if result.alternatives:
        print(f"  alternatives:")
        for shape, conf in result.alternatives:
            print(f"    - {shape}: {conf:.2f}")


if __name__ == "__main__":
    asyncio.run(main())
