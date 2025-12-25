#!/usr/bin/env python3
"""
创建系统托盘图标
- macOS: Template Image (黑白, 16x16 和 32x32)
- Windows: 彩色图标 (16x16)
"""
from PIL import Image, ImageDraw
import os

def create_macos_tray_icon(size, output_path):
    """
    创建 macOS 托盘图标 (Template Image)
    黑色图标，透明背景
    """
    # 创建透明背景
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 绘制简单的人形图标
    # 圆形头部
    head_radius = size // 5
    head_center = size // 2
    draw.ellipse(
        [head_center - head_radius, size // 3 - head_radius,
         head_center + head_radius, size // 3 + head_radius],
        fill=(0, 0, 0, 255)
    )

    # 身体（矩形）
    body_width = size // 3
    body_height = size // 3
    body_left = (size - body_width) // 2
    body_top = size // 2
    draw.rectangle(
        [body_left, body_top, body_left + body_width, body_top + body_height],
        fill=(0, 0, 0, 255)
    )

    img.save(output_path, 'PNG')
    print(f"✅ macOS 托盘图标已创建: {os.path.basename(output_path)} ({size}x{size})")

def create_windows_tray_icon(output_path):
    """
    创建 Windows 托盘图标 (彩色, 16x16)
    """
    size = 16
    # 创建蓝色背景
    img = Image.new('RGBA', (size, size), (65, 105, 225, 255))  # 蓝色
    draw = ImageDraw.Draw(img)

    # 绘制白色人形图标
    # 圆形头部
    head_radius = size // 5
    head_center = size // 2
    draw.ellipse(
        [head_center - head_radius, size // 3 - head_radius,
         head_center + head_radius, size // 3 + head_radius],
        fill=(255, 255, 255, 255)
    )

    # 身体（矩形）
    body_width = size // 3
    body_height = size // 3
    body_left = (size - body_width) // 2
    body_top = size // 2
    draw.rectangle(
        [body_left, body_top, body_left + body_width, body_top + body_height],
        fill=(255, 255, 255, 255)
    )

    img.save(output_path, 'PNG')
    print(f"✅ Windows 托盘图标已创建: {os.path.basename(output_path)} (16x16)")

if __name__ == '__main__':
    # 当前目录
    current_dir = os.path.dirname(os.path.abspath(__file__))

    print("📦 开始创建系统托盘图标...\n")

    # macOS 托盘图标 (Template Image)
    print("🍎 macOS 托盘图标:")
    create_macos_tray_icon(16, os.path.join(current_dir, 'trayTemplate.png'))
    create_macos_tray_icon(32, os.path.join(current_dir, 'trayTemplate@2x.png'))

    # Windows 托盘图标
    print("\n🪟 Windows 托盘图标:")
    create_windows_tray_icon(os.path.join(current_dir, 'tray-icon.png'))

    print("\n✅ 所有托盘图标创建完成！")
    print("\n📝 使用说明:")
    print("  macOS: trayTemplate.png 和 trayTemplate@2x.png (黑白)")
    print("  Windows: tray-icon.png (彩色)")
