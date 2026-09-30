# Tray icons

macOS draws a tray image 18pt tall whatever its pixel size, so the template
images are cropped tight around the mark (45×36 px, @2x) to fill the menu bar.

- `tray-template.svg`: the mark, tight viewBox. `tray-template@2x.png` is it at 36 px tall, black on transparent.
- `tray-update-badge.svg`: the download badge, same viewBox. `tray-update-template@2x.png` is the mark with a
  clear ring cut around (circle at 37.5,29.1, radius 8.9 px) and the badge on top.
- `tray-white.png`, `tray-update-white.png`: Linux (square, white).

```sh
magick -background none -density 1200 tray-template.svg -resize x36 -channel RGB -evaluate set 0 +channel tray-template@2x.png
magick -background none -density 1200 tray-update-badge.svg -resize 45x36\! -channel RGB -evaluate set 0 +channel /tmp/badge.png
magick tray-template@2x.png \( -size 45x36 xc:none -fill black -draw "circle 37.5,29.1 46.4,29.1" \) -compose DstOut -composite /tmp/badge.png -compose Over -composite tray-update-template@2x.png
```

Windows shows tray icons in color on a light or dark taskbar, so it gets the app icon:

- `tray-color.png`: `../32x32.png`.
- `tray-update-color.png`: the same with a violet download badge, a clear ring cut around it.

```sh
magick ../32x32.png \( -size 32x32 xc:none -fill black -draw "circle 24.5,24.5 32.5,24.5" \) -compose DstOut -composite \
  \( -size 32x32 xc:none -fill "#6e56cf" -draw "circle 24.5,24.5 31,24.5" -fill white \
     -draw "polygon 21,24 28,24 24.5,28.5" -draw "rectangle 23.5,19.5 25.5,24.5" \) -compose Over -composite tray-update-color.png
```
