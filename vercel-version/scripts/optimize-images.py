#!/usr/bin/env python3
"""图片优化脚本：将 PNG 转换为 WebP 格式"""
import os
from pathlib import Path
from PIL import Image

def convert_png_to_webp(png_path, quality=85):
    """将 PNG 转换为 WebP"""
    try:
        img = Image.open(png_path)
        if img.mode in ('RGBA', 'LA', 'P'):
            img = img.convert('RGBA')
        else:
            img = img.convert('RGB')
        
        webp_path = png_path.with_suffix('.webp')
        img.save(webp_path, 'WEBP', quality=quality, method=6)
        
        original_size = png_path.stat().st_size
        new_size = webp_path.stat().st_size
        reduction = (1 - new_size / original_size) * 100
        
        print(f"✓ {png_path.name}: {original_size//1024}KB → {new_size//1024}KB ({reduction:.1f}% reduction)")
        return True
    except Exception as e:
        print(f"✗ {png_path.name}: {e}")
        return False

def main():
    # 导航栏 PNG 文件
    nav_dir = Path('/Users/luna/Downloads/levihan/vercel-version/public/images/nav')
    png_files = list(nav_dir.glob('*.png'))
    
    print(f"Found {len(png_files)} PNG files to convert:")
    print("=" * 50)
    
    converted = 0
    for png_file in png_files:
        if convert_png_to_webp(png_file):
            converted += 1
    
    print("=" * 50)
    print(f"Converted {converted}/{len(png_files)} files successfully")

if __name__ == '__main__':
    main()