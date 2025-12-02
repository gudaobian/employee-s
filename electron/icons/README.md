# Linux Tray and Window Icons

This directory contains icon files used by the Electron application on Linux platforms.

## Required Files

### Tray Icons (System Tray)

| File Name | Size | Description |
|-----------|------|-------------|
| `tray-icon-light.png` | 24x24 or 22x22 | Light theme tray icon (for dark panels) |
| `tray-icon-dark.png` | 24x24 or 22x22 | Dark theme tray icon (for light panels) |

### Window Icons (Taskbar and Title Bar)

| File Name | Size | Description |
|-----------|------|-------------|
| `icon.png` | 256x256 | Default application icon |
| `icon-256x256.png` | 256x256 | High resolution icon |
| `icon-128x128.png` | 128x128 | Medium resolution icon |
| `icon-64x64.png` | 64x64 | Standard resolution icon |
| `icon-48x48.png` | 48x48 | Small resolution icon |
| `icon-32x32.png` | 32x32 | Smaller resolution icon |
| `icon-16x16.png` | 16x16 | Minimum resolution icon |

## Icon Requirements

### Tray Icons
- **Format**: PNG with transparent background
- **Style**: Single color, simple design that adapts to system theme
- **Size**: 22x22 or 24x24 pixels (depends on DE panel height)
- **Light icon**: White or light gray foreground for dark system themes
- **Dark icon**: Black or dark gray foreground for light system themes

### Window Icons
- **Format**: PNG with transparent background or solid background
- **Style**: Full color, detailed icon suitable for taskbars and window decorations
- **Sizes**: Multiple sizes for different contexts (see table above)

## Generating Icons

### From SVG Source
If you have an SVG source file, you can generate all required sizes:

```bash
# Install ImageMagick if not present
sudo apt install imagemagick

# Generate window icons from SVG
for size in 256 128 64 48 32 16; do
    convert -background transparent -resize ${size}x${size} icon.svg icon-${size}x${size}.png
done

# Create default icon
cp icon-256x256.png icon.png

# Generate tray icons (single color)
convert -background transparent -resize 24x24 -colorspace Gray tray-icon.svg tray-icon-dark.png
convert -background transparent -resize 24x24 -negate tray-icon-dark.png tray-icon-light.png
```

### From Existing PNG
```bash
# Generate smaller sizes from 256x256 source
for size in 128 64 48 32 16; do
    convert icon-256x256.png -resize ${size}x${size} icon-${size}x${size}.png
done
```

## Desktop Environment Notes

### GNOME
- GNOME 3.26+ removed native tray support
- Requires AppIndicator extension: [AppIndicator Support](https://extensions.gnome.org/extension/615/appindicator-support/)
- Tray icons may not appear without this extension

### KDE Plasma
- Full native tray support
- Supports both legacy tray and SNI (StatusNotifierItem)
- All icon sizes work correctly

### XFCE
- Full native tray support via xfce4-panel
- Standard tray icon behavior

### Other Desktop Environments
- Most DEs support standard X11 system tray
- Wayland support varies by compositor

## Troubleshooting

### Tray Icon Not Appearing
1. Check if desktop environment supports system tray
2. For GNOME, install AppIndicator extension
3. Verify icon file exists and is valid PNG

### Icon Appears Blurry
1. Ensure icon matches panel size (usually 22x22 or 24x24)
2. Use vector-based source for generating icons
3. Avoid upscaling small icons

### Icon Colors Wrong
1. Check if using correct theme variant (light vs dark)
2. Verify icon has transparent background
3. Test with system theme changes

## File Placeholders

Until production icons are created, the application will fall back to programmatically generated icons. To enable file-based icons:

1. Create icon files following specifications above
2. Place them in this directory
3. Restart the application

The application automatically detects and uses icons from this directory when present.
