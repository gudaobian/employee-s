#!/bin/bash
# Generate icon sizes for Linux from source image
#
# Usage: ./generate-linux-icons.sh [source-icon.png]
#
# This script generates various icon sizes required for Linux desktop applications.
# It supports both ImageMagick (convert) and FFmpeg as image processing backends.
#
# The output follows the freedesktop.org icon theme specification.

set -e

# Default source icon locations to check
DEFAULT_ICONS=(
    "electron/icons/icon.png"
    "assets/icons/icon.png"
    "resources/icons/icon.png"
    "icon.png"
)

# Output directory
OUTPUT_DIR="build/icons"

# Icon sizes required by freedesktop.org specification
SIZES="16 24 32 48 64 128 256 512 1024"

# ANSI colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Find the source icon
find_source_icon() {
    local source="$1"

    if [ -n "$source" ] && [ -f "$source" ]; then
        echo "$source"
        return 0
    fi

    for icon in "${DEFAULT_ICONS[@]}"; do
        if [ -f "$icon" ]; then
            echo "$icon"
            return 0
        fi
    done

    return 1
}

# Detect available image processing tool
detect_image_tool() {
    if command -v magick &> /dev/null; then
        echo "magick"
    elif command -v convert &> /dev/null; then
        echo "convert"
    elif command -v ffmpeg &> /dev/null; then
        echo "ffmpeg"
    else
        echo "none"
    fi
}

# Resize image using ImageMagick (magick command - v7+)
resize_with_magick() {
    local src="$1"
    local dest="$2"
    local size="$3"

    magick "$src" -resize "${size}x${size}" -gravity center -background none -extent "${size}x${size}" "$dest"
}

# Resize image using ImageMagick (convert command - v6)
resize_with_convert() {
    local src="$1"
    local dest="$2"
    local size="$3"

    convert "$src" -resize "${size}x${size}" -gravity center -background none -extent "${size}x${size}" "$dest"
}

# Resize image using FFmpeg
resize_with_ffmpeg() {
    local src="$1"
    local dest="$2"
    local size="$3"

    ffmpeg -y -i "$src" -vf "scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=0x00000000" "$dest" 2>/dev/null
}

# Main resize function
resize_image() {
    local tool="$1"
    local src="$2"
    local dest="$3"
    local size="$4"

    case "$tool" in
        magick)
            resize_with_magick "$src" "$dest" "$size"
            ;;
        convert)
            resize_with_convert "$src" "$dest" "$size"
            ;;
        ffmpeg)
            resize_with_ffmpeg "$src" "$dest" "$size"
            ;;
        *)
            return 1
            ;;
    esac
}

# Generate all icon sizes
generate_icons() {
    local source_icon="$1"
    local tool="$2"

    log_info "Source icon: $source_icon"
    log_info "Using tool: $tool"
    log_info "Output directory: $OUTPUT_DIR"
    echo ""

    # Create output directory
    mkdir -p "$OUTPUT_DIR"

    # Generate each size
    for size in $SIZES; do
        local dest="${OUTPUT_DIR}/${size}x${size}.png"
        echo -n "  Generating ${size}x${size}... "

        if resize_image "$tool" "$source_icon" "$dest" "$size"; then
            echo -e "${GREEN}OK${NC}"
        else
            echo -e "${RED}FAILED${NC}"
            return 1
        fi
    done

    echo ""

    # Create main icon.png (256x256 is the standard)
    log_info "Creating main icon.png..."
    cp "${OUTPUT_DIR}/256x256.png" "${OUTPUT_DIR}/icon.png"
    log_success "Created icon.png"

    # Create symbolic link structure for hicolor theme (optional)
    echo ""
    log_info "Creating hicolor theme structure..."
    local hicolor_base="${OUTPUT_DIR}/hicolor"

    for size in $SIZES; do
        local theme_dir="${hicolor_base}/${size}x${size}/apps"
        mkdir -p "$theme_dir"
        cp "${OUTPUT_DIR}/${size}x${size}.png" "${theme_dir}/employee-safety.png"
    done

    # Create scalable directory with SVG if available
    if [ -f "${source_icon%.png}.svg" ]; then
        mkdir -p "${hicolor_base}/scalable/apps"
        cp "${source_icon%.png}.svg" "${hicolor_base}/scalable/apps/employee-safety.svg"
        log_success "Included SVG for scalable icons"
    fi

    log_success "Created hicolor theme structure"
}

# Print summary
print_summary() {
    echo ""
    echo "================================================================="
    echo "  Icon Generation Complete"
    echo "================================================================="
    echo ""
    echo "  Generated icons:"
    ls -la "$OUTPUT_DIR"/*.png 2>/dev/null | while read line; do
        echo "    $line"
    done
    echo ""
    echo "  Hicolor theme structure:"
    echo "    ${OUTPUT_DIR}/hicolor/"
    echo ""
    echo "  To use in electron-builder.yml:"
    echo "    linux:"
    echo "      icon: build/icons"
    echo ""
    echo "================================================================="
}

# Main script
main() {
    echo ""
    echo "================================================================="
    echo "  Linux Icon Generator for Electron Applications"
    echo "================================================================="
    echo ""

    # Find source icon
    local source_icon
    if ! source_icon=$(find_source_icon "$1"); then
        log_error "Source icon not found!"
        echo ""
        echo "Usage: $0 [source-icon.png]"
        echo ""
        echo "Searched locations:"
        for icon in "${DEFAULT_ICONS[@]}"; do
            echo "  - $icon"
        done
        exit 1
    fi

    # Detect image processing tool
    local tool
    tool=$(detect_image_tool)

    if [ "$tool" = "none" ]; then
        log_error "No image processing tool found!"
        echo ""
        echo "Please install one of the following:"
        echo "  - ImageMagick: sudo apt install imagemagick"
        echo "  - FFmpeg: sudo apt install ffmpeg"
        exit 1
    fi

    # Generate icons
    generate_icons "$source_icon" "$tool"

    # Print summary
    print_summary
}

# Run main function
main "$@"
