#!/usr/bin/env python3
"""Extract an image-based MOBI into individually loadable WebP pages."""

from __future__ import annotations

import argparse
import io
from pathlib import Path
import re
import sys

from PIL import Image


IMAGE_TAG = re.compile(rb"<img\b[^>]*\brecindex\s*=\s*['\"](\d+)['\"]", re.IGNORECASE)
IMAGE_SIGNATURES = (b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"GIF87a", b"GIF89a")


def read_records(source: bytes) -> list[bytes]:
    if len(source) < 78:
        raise ValueError("文件不是有效的 Palm/MOBI 数据库。")

    record_count = int.from_bytes(source[76:78], "big")
    table_end = 78 + record_count * 8
    if not record_count or table_end > len(source):
        raise ValueError("MOBI 记录目录不完整。")

    starts = [int.from_bytes(source[78 + index * 8:82 + index * 8], "big") for index in range(record_count)]
    if starts != sorted(starts) or starts[0] < table_end or starts[-1] >= len(source):
        raise ValueError("MOBI 记录偏移无效。")

    ends = starts[1:] + [len(source)]
    return [source[start:end] for start, end in zip(starts, ends)]


def decompress_palmdoc(data: bytes, expected_length: int) -> bytes:
    output = bytearray()
    cursor = 0

    while cursor < len(data) and len(output) < expected_length:
        value = data[cursor]
        cursor += 1

        if value == 0:
            output.append(0)
        elif value <= 8:
            output.extend(data[cursor:cursor + value])
            cursor += value
        elif value <= 0x7F:
            output.append(value)
        elif value <= 0xBF:
            if cursor >= len(data):
                break
            pair = ((value & 0x3F) << 8) | data[cursor]
            cursor += 1
            distance = pair >> 3
            length = (pair & 0x07) + 3
            if not distance or distance > len(output):
                raise ValueError("MOBI 正文包含无效的回溯引用。")
            for _ in range(length):
                output.append(output[-distance])
        else:
            output.extend((0x20, value ^ 0x80))

    return bytes(output[:expected_length])


def extract_pages(records: list[bytes]) -> list[bytes]:
    palm_header = records[0]
    if len(palm_header) < 280 or palm_header[16:20] != b"MOBI":
        raise ValueError("文件中没有可识别的 MOBI 头。")
    if int.from_bytes(palm_header[12:14], "big") != 0:
        raise ValueError("该 MOBI 带有加密标记，不能直接转换。")
    if int.from_bytes(palm_header[0:2], "big") != 2:
        raise ValueError("当前转换器只处理 PalmDOC 压缩的 MOBI。")

    text_record_count = int.from_bytes(palm_header[8:10], "big")
    text_length = int.from_bytes(palm_header[4:8], "big")
    text_record_size = int.from_bytes(palm_header[10:12], "big")
    if text_record_count < 1 or 1 + text_record_count > len(records):
        raise ValueError("MOBI 正文记录目录无效。")
    if text_length < 1 or text_record_size < 1:
        raise ValueError("MOBI 正文长度无效。")

    html_parts = []
    remaining_length = text_length
    for index in range(1, 1 + text_record_count):
        expected_length = min(text_record_size, remaining_length)
        part = decompress_palmdoc(records[index], expected_length)
        if len(part) != expected_length:
            raise ValueError("MOBI 正文数据不完整。")
        html_parts.append(part)
        remaining_length -= expected_length
    if remaining_length:
        raise ValueError("MOBI 正文数据不完整。")

    references = [int(value) for value in IMAGE_TAG.findall(b"".join(html_parts))]
    if not references:
        raise ValueError("没有在 MOBI 正文中找到漫画页图片。")

    image_records = [
        index for index, record in enumerate(records)
        if record.startswith(IMAGE_SIGNATURES)
    ]
    if not image_records:
        raise ValueError("没有找到 MOBI 图片资源。")

    first_reference = min(references)
    first_image_record = image_records[0]
    record_offset = first_image_record - first_reference
    if not all(
        0 <= reference + record_offset < len(records)
        and records[reference + record_offset].startswith(IMAGE_SIGNATURES)
        for reference in references
    ):
        raise ValueError("无法将 MOBI 图片引用映射到页面资源。")

    return [records[reference + record_offset] for reference in references]


def save_page(image_data: bytes, destination: Path) -> None:
    with Image.open(io.BytesIO(image_data)) as image:
        if getattr(image, "is_animated", False):
            image.seek(0)

        if image.mode == "L":
            converted = image.copy()
        elif image.mode in ("RGBA", "LA") or "transparency" in image.info:
            converted = image.convert("RGBA")
        else:
            converted = image.convert("RGB")

        converted.save(destination, format="WEBP", quality=86, method=6)


def write_pages(pages: list[bytes], destination: Path) -> int:
    destination.mkdir(parents=True, exist_ok=True)
    total_bytes = 0

    for index, page in enumerate(pages, start=1):
        output = destination / ("page-" + str(index).zfill(3) + ".webp")
        save_page(page, output)
        total_bytes += output.stat().st_size

    return total_bytes


def main() -> int:
    parser = argparse.ArgumentParser(description="将漫画 MOBI 拆为可按页加载的 WebP 图片")
    parser.add_argument("source", type=Path, help="输入的 MOBI 文件")
    parser.add_argument("destination", type=Path, help="输出的页面目录")
    args = parser.parse_args()

    try:
        records = read_records(args.source.read_bytes())
        pages = extract_pages(records)
        total_bytes = write_pages(pages, args.destination)
    except (OSError, ValueError) as error:
        print("转换失败：" + str(error), file=sys.stderr)
        return 1

    size_mib = total_bytes / (1024 * 1024)
    print("已转换 " + str(len(pages)) + " 页：" + str(args.destination) + "（" + format(size_mib, ".1f") + " MiB）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
