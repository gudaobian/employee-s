#!/usr/bin/env python3
"""
给图标添加圆角
"""
import os
from PIL import Image, ImageDraw

def add_rounded_corners(input_path, output_path, radius_ratio=0.18):
    """
    给图片添加圆角

    Args:
        input_path: 输入图片路径
        output_path: 输出图片路径
        radius_ratio: 圆角半径占图片尺寸的比例 (0.0-0.5)
    """
    # 打开图片
    img = Image.open(input_path).convert("RGBA")
    width, height = img.size

    # 计算圆角半径
    radius = int(min(width, height) * radius_ratio)

    # 创建一个圆角遮罩
    mask = Image.new('L', (width, height), 0)
    draw = ImageDraw.Draw(mask)

    # 绘制圆角矩形遮罩
    draw.rounded_rectangle(
        [(0, 0), (width, height)],
        radius=radius,
        fill=255
    )

    # 创建输出图像
    output = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    output.paste(img, (0, 0))
    output.putalpha(mask)

    # 保存
    output.save(output_path, 'PNG')
    print(f"✅ {os.path.basename(output_path)} - 已添加圆角 (半径: {radius}px)")

def process_iconset(iconset_dir, output_dir=None):
    """
    处理整个 iconset 目录
    """
    if output_dir is None:
        output_dir = iconset_dir.replace('.iconset', '-rounded.iconset')

    # 创建输出目录
    os.makedirs(output_dir, exist_ok=True)

    # 处理所有 PNG 文件
    png_files = [f for f in os.listdir(iconset_dir) if f.endswith('.png')]

    print(f"📦 开始处理 {len(png_files)} 个图标文件...")
    print(f"输入目录: {iconset_dir}")
    print(f"输出目录: {output_dir}\n")

    for filename in sorted(png_files):
        input_path = os.path.join(iconset_dir, filename)
        output_path = os.path.join(output_dir, filename)
        add_rounded_corners(input_path, output_path)

    print(f"\n✅ 所有图标处理完成！")
    return output_dir

if __name__ == '__main__':
    import sys

    if len(sys.argv) < 2:
        print("用法: python3 add-rounded-corners.py <iconset目录>")
        print("示例: python3 add-rounded-corners.py icon.iconset")
        sys.exit(1)

    iconset_dir = sys.argv[1]

    if not os.path.isdir(iconset_dir):
        print(f"❌ 错误: 目录不存在: {iconset_dir}")
        sys.exit(1)

    output_dir = process_iconset(iconset_dir)

    print(f"\n📝 下一步:")
    print(f"1. 使用以下命令生成 .icns 文件:")
    print(f"   iconutil -c icns {output_dir} -o icon-rounded.icns")
    print(f"2. 替换原图标文件")
