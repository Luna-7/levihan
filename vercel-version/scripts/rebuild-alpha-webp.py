#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把「带 alpha 的原始 PNG」重新编码成 WebP，且**必须保住透明度**。

背景（2026-09-20 事故）
----------------------
header.webp / nav-bar.webp 之前是用 `img.convert('RGB')` 转出来的 —— alpha 通道被直接丢掉，
透明区被拍平成实心底：
  · header.png 的透明区存的是纯白 (255,255,255, σ=0)，拍平后底部渐隐变成一条白底硬边；
  · 导航栏.png 的透明区存的是近白 (252,250,247) 但 σ=16.8 的脏噪声，拍平后这块噪声
    被当成真实颜色编码，叠加 WebP 4:2:0 色度子采样 ⇒ 边缘出现彩噪 / 马赛克块。

解法两步
--------
1) alpha bleed（渗色）：把不透明像素的 RGB 向外"膨胀"填满 a==0 的区域。
   只填 a==0，绝不动 0<a<255 的半透明像素（它们的 RGB 是真实混合色，有语义）。
   这样透明区 RGB 不再是垃圾值，4:2:0 子采样就不会把杂色渗到边缘。
2) 用 RGBA 保存，quality 管 RGB、alpha_quality 管 alpha 通道。
   alpha_quality=100 ⇒ alpha 无损，硬边不会被量化出锯齿。

用法
----
    /Users/luna/.workbuddy/binaries/python/envs/default/bin/python \
        scripts/rebuild-alpha-webp.py            # 跑下面 JOBS 里登记的任务

新增任务：往 JOBS 里加一项。
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC_LIB = Path.home() / "Downloads" / "素材库" / "png" / "UI库"

# 渗色半径（像素）。WebP 4:2:0 的最大块是 16px 宏块 / 色度 8px，
# 渗 8px 足够把整个块内部填满真实颜色，再大只是白白增大体积。
BLEED_RADIUS = 8


def alpha_bleed(rgba: np.ndarray, radius: int = BLEED_RADIUS) -> np.ndarray:
    """把不透明像素的 RGB 向外膨胀，填满 a==0 区域（alpha 本身不变）。"""
    out = rgba.copy()
    a = out[:, :, 3]
    filled = a > 0                      # 已经有颜色的像素（RGB 可信）
    for _ in range(radius):
        if filled.all():
            break
        # 四邻域膨胀：把已知像素的 RGB 推到相邻的 a==0 像素上
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            src = np.roll(filled, (dy, dx), axis=(0, 1))
            dst = (~filled) & src
            if not dst.any():
                continue
            out[: dst.shape[0], : dst.shape[1], :3][dst] = np.roll(
                out[:, :, :3], (dy, dx), axis=(0, 1)
            )[dst]
            filled = filled | dst
    return out


def rebuild(src: Path, dst: Path, crop=None, resize=None,
            quality=88, alpha_quality=100, method=6):
    im = Image.open(src)
    if im.mode not in ("RGBA", "LA") and not (im.mode == "P" and "transparency" in im.info):
        raise SystemExit(f"[跳过] {src.name} 源图本身没有 alpha（mode={im.mode}），无需本脚本处理")
    im = im.convert("RGBA")
    if crop:
        im = im.crop(crop)
    if resize:
        im = im.resize(resize, Image.Resampling.LANCZOS)

    arr = np.asarray(im)
    before_zero = int((arr[:, :, 3] == 0).sum())
    arr = alpha_bleed(arr)
    im2 = Image.fromarray(arr, "RGBA")

    dst.parent.mkdir(parents=True, exist_ok=True)
    im2.save(dst, "WEBP", quality=quality, alpha_quality=alpha_quality, method=method, exact=False)

    # 回读自检：输出必须真的带 alpha，且透明像素数量与源一致
    chk = Image.open(dst).convert("RGBA")
    ca = np.asarray(chk)[:, :, 3]
    ok = (int((ca == 0).sum()) == before_zero)
    print(f"  {dst.name:<20} {im.size[0]}x{im.size[1]}  "
          f"源 {src.stat().st_size // 1024}KB → {dst.stat().st_size // 1024}KB  "
          f"透明像素 {before_zero} → {int((ca == 0).sum())}  "
          f"{'✓ alpha 保住' if ok else '✗ alpha 丢失!'}")
    if not ok:
        raise SystemExit(f"[失败] {dst} 输出丢了 alpha 通道")
    return dst.stat().st_size


# ── 任务表：源 → 目标 -------------------------------------------------------
# crop 用 (left, top, right, bottom)
JOBS = [
    dict(
        src=SRC_LIB / "导航栏.png",
        dst=ROOT / "public/images/nav-bar.webp",
        # 保持线上既有几何 1242×331，不引发布局回归
    ),
    dict(
        src=SRC_LIB / "header.png",
        dst=ROOT / "public/images/header.webp",
        # 线上 header.webp 是源图顶部 871 行的裁剪（实测平均差 2.98），
        # 沿用同一裁剪以保证宽高比不变 ⇒ 不改版式。
        crop=(0, 0, 1242, 871),
    ),
]


if __name__ == "__main__":
    print("Pillow", Image.__version__)
    total = 0
    for job in JOBS:
        src = job.pop("src")
        dst = job.pop("dst")
        if not src.exists():
            print(f"  ✗ 源图不存在: {src}")
            continue
        total += rebuild(src, dst, **job)
    print(f"合计 {total // 1024}KB")
