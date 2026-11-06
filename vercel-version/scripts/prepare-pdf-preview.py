#!/usr/bin/env python3
"""Render each PDF page as a WebP image for the existing manga reader."""

from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import tempfile

from PIL import Image
from pypdf import PdfReader


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('pdf', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--max-side', type=int, default=1600)
    args = parser.parse_args()

    page_count = len(PdfReader(args.pdf).pages)
    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='pdf-preview-') as temp_dir:
        prefix = Path(temp_dir) / 'page'
        subprocess.run(
            ['pdftoppm', '-png', '-scale-to', str(args.max_side), str(args.pdf), str(prefix)],
            check=True,
        )
        pages = sorted(Path(temp_dir).glob('page-*.png'))
        if len(pages) != page_count:
            raise RuntimeError(f'PDF has {page_count} pages but rendered {len(pages)}')

        for number, page in enumerate(pages, 1):
            target = args.output / f'page-{number:03d}.webp'
            with Image.open(page) as image:
                image.save(target, 'WEBP', quality=82, method=6)
            page.unlink()
            if number % 25 == 0 or number == page_count:
                print(f'{number}/{page_count} pages converted', flush=True)


if __name__ == '__main__':
    main()
