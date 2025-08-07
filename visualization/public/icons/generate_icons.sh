#!/bin/bash
# Generate PWA icons using ImageMagick (install with: apt install imagemagick)
# This script creates a simple music note icon in various sizes

# Colors
BG_COLOR="#667eea"
TEXT_COLOR="#ffffff"

# Icon sizes for PWA
SIZES=(32 72 96 128 144 152 192 384 512)

# Create a simple SVG template
create_svg() {
    local size=$1
    local font_size=$((size / 2))
    
    cat > temp_icon.svg << EOF
<svg width="$size" height="$size" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="$size" height="$size" fill="url(#grad)" rx="$((size/8))" ry="$((size/8))"/>
  <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="${font_size}px" 
        fill="$TEXT_COLOR" text-anchor="middle" dominant-baseline="central">🎵</text>
</svg>
EOF
}

# Generate icons
for size in "${SIZES[@]}"; do
    echo "Generating ${size}x${size} icon..."
    
    if command -v convert >/dev/null 2>&1; then
        # Using ImageMagick
        create_svg $size
        convert temp_icon.svg "icon-${size}x${size}.png"
        rm temp_icon.svg
    else
        # Fallback: create colored squares with text
        convert -size ${size}x${size} xc:"$BG_COLOR" \
                -fill "$TEXT_COLOR" \
                -font Arial \
                -pointsize $((size/3)) \
                -gravity center \
                -annotate +0+0 "♪" \
                "icon-${size}x${size}.png"
    fi
done

# Generate favicon
if command -v convert >/dev/null 2>&1; then
    convert icon-32x32.png favicon.ico 2>/dev/null || cp icon-32x32.png ../favicon.png
fi

echo "PWA icons generated successfully!"
echo "Available sizes: ${SIZES[*]}"