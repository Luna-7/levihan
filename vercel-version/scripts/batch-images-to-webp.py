#!/usr/bin/env python3
"""Batch-convert local images to WebP without changing the originals.

AI usage:
    python3 scripts/batch-images-to-webp.py INPUT_DIR
    python3 scripts/batch-images-to-webp.py INPUT_DIR --max-side 1600 --quality 82
    python3 scripts/batch-images-to-webp.py INPUT_DIR OUTPUT_DIR

The output keeps the input directory structure. Existing WebP files are skipped
unless --overwrite is given. This script only works on local files; it never uploads.
Requires Pillow with WebP support: python3 -m pip install Pillow
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys

from PIL import Image, ImageOps, features


SOURCE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}


def convert(source: Path, target: Path, quality: int, max_side: int | None) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + ".tmp")

    try:
        with Image.open(source) as original:
            image = ImageOps.exif_transpose(original)
            if max_side and max(image.size) > max_side:
                image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)

            if image.mode == "P" and "transparency" in image.info:
                image = image.convert("RGBA")
            elif image.mode in {"RGBA", "LA"}:
                image = image.convert("RGBA")
            elif image.mode not in {"RGB", "L"}:
                image = image.convert("RGB")

            image.save(temporary, format="WEBP", quality=quality, method=6)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="批量将本地图片转换为 WebP，保留原图和目录结构")
    parser.add_argument("source", type=Path, help="输入图片目录")
    parser.add_argument(
        "destination",
        type=Path,
        nargs="?",
        help="输出目录；省略时在输入目录中新建 webp 文件夹",
    )
    parser.add_argument("--quality", type=int, default=82, help="有损质量 1–100，默认 82")
    parser.add_argument("--max-side", type=int, help="可选：最长边像素数，等比缩小，不放大")
    parser.add_argument("--overwrite", action="store_true", help="覆盖已存在的输出文件")
    parser.add_argument("--dry-run", action="store_true", help="只列出计划转换的文件")
    args = parser.parse_args()

    if not args.source.is_dir():
        parser.error("输入目录不存在")
    if not 1 <= args.quality <= 100:
        parser.error("--quality 必须在 1–100 之间")
    if args.max_side is not None and args.max_side < 1:
        parser.error("--max-side 必须大于 0")
    if not features.check("webp"):
        parser.error("当前 Pillow 没有 WebP 编码支持")

    source_root = args.source.resolve()
    destination_root = (args.destination or source_root / "webp").resolve()
    if source_root == destination_root:
        parser.error("输入和输出目录必须不同，以免覆盖原图")

    sources = sorted(
        path for path in source_root.rglob("*")
        if path.is_file() and path.suffix.lower() in SOURCE_EXTENSIONS
        and destination_root not in path.parents
    )
    if not sources:
        print("未找到可转换的 PNG、JPEG、BMP 或 TIFF 图片")
        return 0

    targets: dict[Path, Path] = {}
    for source in sources:
        target = destination_root / source.relative_to(source_root).with_suffix(".webp")
        if target in targets:
            parser.error(f"输出文件名冲突：{targets[target]} 与 {source} 都会生成 {target}")
        targets[target] = source

    converted = skipped = failed = input_bytes = output_bytes = 0
    for source in sources:
        target = destination_root / source.relative_to(source_root).with_suffix(".webp")
        if target.exists() and not args.overwrite:
            skipped += 1
            print(f"跳过已存在：{target}")
            continue
        if args.dry_run:
            print(f"计划转换：{source} -> {target}")
            continue
        try:
            convert(source, target, args.quality, args.max_side)
        except (OSError, ValueError) as error:
            failed += 1
            print(f"转换失败：{source}：{error}", file=sys.stderr)
            continue
        converted += 1
        input_bytes += source.stat().st_size
        output_bytes += target.stat().st_size
        print(f"已转换：{target}")

    if args.dry_run:
        print(f"计划转换 {len(sources) - skipped} 张，跳过 {skipped} 张")
    else:
        print(
            f"完成：{converted} 张，跳过 {skipped} 张，失败 {failed} 张；"
            f"源文件 {input_bytes / 1024 / 1024:.1f} MiB，WebP {output_bytes / 1024 / 1024:.1f} MiB"
        )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
