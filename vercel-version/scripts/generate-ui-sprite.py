#!/usr/bin/env python3
"""Build the shared UI sprite atlas from the named source artwork.

Add future UI images to SOURCES below, then run `npm run sprites`.
The walking strip is split into its three animation frames automatically.

体积守则（首屏最快的实际做法）：
  1. 源图按「页面最大展示宽度的 2 倍」等比缩小 —— 2x 屏上本来也只采样到
     这么多像素，多出来的部分只会拖慢下载。展示宽度见 MAX_WIDTH。
  2. 输出有损 WebP（quality 见 QUALITY，可用 SPRITE_QUALITY 环境变量覆盖）。
     无损 WebP 会把渐变和脏色一并写进去，是首屏最大的单个文件。
  3. 已经没有渲染点的图直接从 SOURCES 里删掉，别留着当死重。

哪些图不能缩：KEEP_NATIVE —— 滑索条按容器宽度铺满、弹窗线稿 cover 整个面板，
两者在 2x 屏上都需要原生分辨率。
"""

import os
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets/ui-sprite-sources"
OUTPUTS = {
    "core": ROOT / "public/images/ui-sprite.webp",
    "roleplay": ROOT / "public/images/ui-sprite-roleplay.webp",
    "decor": ROOT / "public/images/ui-sprite-decor.webp",
}
GENERATED_TS = ROOT / "src/components/uiSprite.generated.ts"
ATLAS_WIDTH = 1024
PADDING = 4
QUALITY = int(os.environ.get("SPRITE_QUALITY", "88"))

SOURCES = {
    # 「联络」既是底栏道具槽图标（展示 20px），源图却有 512px 宽 —— 见 MAX_WIDTH。
    "dispatch": "联络.png",
    "home": "兵团驻地.png",
    "game-watermelon": "合成大西皮.png",
    "restaurant": "巨树餐厅.png",
    "nav-companion": "底部行走小人2.png",
    "game-hange": "拯救韩吉.png",
    "game-lihan": "利了个韩.png",
    "back-to-top": "向上按钮.png",
    "volume": "音量按钮.png",
    "button-wide": "button.宽png.png",
    "levi-peek": "利威尔趴趴.png",
    "hange-peek": "韩吉趴趴.png",
    "tea-party": "兵长茶会.png",
    "zipline-strip": "滑索小队.png",
    "cinema": "观影厅.png",
    "login-key": "登录键.png",
    "popup-sketch-1": "弹窗线稿1.png",
    "popup-sketch-2": "弹窗线稿2.png",
}

# 语C (roleplay) cast. Produced by scripts/prepare-roleplay-portraits.py, which
# emits one full-body illustration (`char-<slug>`) and one square head close-up
# (`char-<slug>-head`) per character. The card column uses the full body; the
# 44px circular avatars need the head crop, since cropping a tall figure into a
# circle would land on the torso.
ROLEPLAY_SLUGS = [
    "armin", "historia", "eren", "levi", "jean", "mikasa",
    "sasha", "connie", "erwin", "reiner", "hange", "annie",
]
for _slug in ROLEPLAY_SLUGS:
    SOURCES[f"char-{_slug}"] = f"角色-{_slug}.png"
    SOURCES[f"char-{_slug}-head"] = f"头像-{_slug}.png"

# 每个 key 在页面上的「最大展示宽度」（CSS px）。雪碧图按 2 倍设备像素准备，
# 所以源图宽于 width × 2 就要缩。数值来源是各消费组件的 width prop / 容器类名。
# 数值 = 最大展示宽度 × 2（2x 设备像素）× 安全系数。
# 安全系数不可省：底栏图标与游戏圆章都带 group-hover:scale-110，回到顶部按钮
# hover:scale-105，只按静态尺寸取整会正好卡在物理像素上，放大时就会发虚。
MAX_WIDTH = {
    # 底栏 4 个道具槽图标：width 22 + 激活 scale-110 ⇒ 24.2 CSS px
    "home": 56,
    "restaurant": 56,
    "tea-party": 56,
    "dispatch": 56,
    # 首页三个游戏圆章：width 44 / 52 / 52，容器均带 group-hover:scale-110
    "game-watermelon": 104,
    "game-hange": 120,
    "game-lihan": 120,
    # 悬浮小按钮：音量 44（只缩不小）、回到顶部 52 + hover:scale-105、登录键 72、
    # 宽药丸 80、影视厅弹窗 88、靠墙小人 16
    "volume": 88,
    "back-to-top": 112,
    "login-key": 144,
    "button-wide": 160,
    "cinema": 176,
    "nav-companion": 44,
    # 趴趴小人：利威尔 42、韩吉 40
    "levi-peek": 84,
    "hange-peek": 80,
    # 行走小人：size=26 ⇒ spriteWidth = 26 × 0.62 ≈ 16 CSS px
    "walk-1": 44,
    "walk-2": 44,
    "walk-3": 44,
    # 语C 立绘卡片区最多 md:w-40 = 160 CSS px（含 8% 内边距与 hover 115%）
    "char-body": 320,
    # 语C 头像最大 w-11 = 44 CSS px 的圆形，选中时 scale-105
    "char-head": 96,
}

# 满铺展示，不能缩：滑索条按展示区高度等比铺满、弹窗线稿 cover 整个面板。
KEEP_NATIVE = {"zipline-strip", "popup-sketch-1", "popup-sketch-2"}


def cap_for(name: str):
    """返回该 key 的宽度上限（设备像素），None 表示保持原图。"""
    if name in KEEP_NATIVE:
        return None
    if name in MAX_WIDTH:
        return MAX_WIDTH[name]
    if name.startswith("char-"):
        return MAX_WIDTH["char-head" if name.endswith("-head") else "char-body"]
    return None


def fit_to_cap(image: Image.Image, cap):
    if not cap or image.width <= cap:
        return image
    height = max(1, round(image.height * cap / image.width))
    return image.resize((cap, height), Image.LANCZOS)


def load_sprites():
    sprites = []
    for name, filename in SOURCES.items():
        image = Image.open(SOURCE_DIR / filename).convert("RGBA")
        sprites.append((name, fit_to_cap(image, cap_for(name))))
    walking = Image.open(SOURCE_DIR / "底部行走小人.png").convert("RGBA")
    # Transparent gaps in the supplied strip separate these three poses.
    for index, bounds in enumerate(((0, 0, 92, 170), (114, 0, 209, 170), (243, 0, 335, 170)), 1):
        name = f"walk-{index}"
        sprites.append((name, fit_to_cap(walking.crop(bounds), cap_for(name))))
    return sprites


def pack(sprites):
    placed = {}
    x = y = row_height = PADDING
    for name, image in sorted(sprites, key=lambda item: item[1].height, reverse=True):
        width, height = image.size
        if x + width + PADDING > ATLAS_WIDTH:
            x = PADDING
            y += row_height + PADDING
            row_height = 0
        placed[name] = (x, y, image)
        x += width + PADDING
        row_height = max(row_height, height)
    return placed, y + row_height + PADDING


def sheet_for(name: str) -> str:
    if name.startswith("char-"):
        return "roleplay"
    if name.startswith("popup-sketch-") or name == "zipline-strip":
        return "decor"
    return "core"


def main():
    entries = []
    sizes = []
    sprites = load_sprites()
    for sheet, output in OUTPUTS.items():
        placed, atlas_height = pack([(name, image) for name, image in sprites if sheet_for(name) == sheet])
        atlas = Image.new("RGBA", (ATLAS_WIDTH, atlas_height), (0, 0, 0, 0))
        for name, (x, y, image) in placed.items():
            atlas.alpha_composite(image, (x, y))
            entries.append(f"  '{name}': {{ sheet: '{sheet}', x: {x}, y: {y}, width: {image.width}, height: {image.height} }},")
        output.parent.mkdir(parents=True, exist_ok=True)
        atlas.save(output, "WEBP", quality=QUALITY, alpha_quality=90, method=6, smart_subsample=True)
        sizes.append(f"  {sheet}: {{ width: {ATLAS_WIDTH}, height: {atlas_height} }},")
        print(f"Generated {output.relative_to(ROOT)} ({ATLAS_WIDTH}x{atlas_height}, {output.stat().st_size / 1024:.0f}KB)")

    GENERATED_TS.write_text(
        "// Generated by scripts/generate-ui-sprite.py. Do not edit by hand.\n"
        "export const UI_SPRITE_SIZES = {\n" + "\n".join(sizes) + "\n} as const;\n"
        "export const UI_SPRITES = {\n" + "\n".join(entries) + "\n} as const;\n"
        "export type UiSpriteName = keyof typeof UI_SPRITES;\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
