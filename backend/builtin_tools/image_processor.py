"""图片处理工具 — 基于 Pillow 的常用图片操作。"""

import json
import time
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter

from config import WORKSPACE_DIR


def _resolve_path(image_path: str) -> Path:
    """Resolve a relative or absolute image path, preferring WORKSPACE_DIR."""
    p = Path(image_path)
    if p.is_absolute() and p.exists():
        return p
    candidate = WORKSPACE_DIR / image_path
    if candidate.exists():
        return candidate
    if p.exists():
        return p
    return candidate


def process_image(
    image_path: str,
    operation: str,
    params_json: str = "{}",
) -> str:
    """对图片执行常用处理操作。

    参数:
        image_path: 图片文件路径（支持绝对路径或相对于工作目录的路径）
        operation: 操作类型，可选:
            resize  - 缩放，params: {"width": 800, "height": 600}
            crop    - 裁剪，params: {"left": 0, "top": 0, "right": 100, "bottom": 100}
            watermark - 添加水印，params: {"text": "CONFIDENTIAL", "opacity": 0.3}
            convert - 格式转换，params: {"format": "PNG"}
            thumbnail - 生成缩略图，params: {"size": 200}
            blur    - 模糊处理，params: {"radius": 5}
            rotate  - 旋转，params: {"angle": 90}
        params_json: 操作参数 JSON 字符串
    返回:
        处理后的图片文件绝对路径
    """
    src = _resolve_path(image_path)
    if not src.exists():
        return f"错误：图片文件不存在: {image_path}"

    params = json.loads(params_json) if params_json else {}
    operation = operation.lower().strip()

    try:
        img = Image.open(src)
    except Exception as e:
        return f"错误：无法打开图片文件: {e}"

    ts = int(time.time())
    stem = src.stem

    if operation == "resize":
        w = params.get("width", img.width)
        h = params.get("height", img.height)
        img = img.resize((int(w), int(h)), Image.LANCZOS)
        out_name = f"{stem}_resized_{ts}{src.suffix}"

    elif operation == "crop":
        left = params.get("left", 0)
        top = params.get("top", 0)
        right = params.get("right", img.width)
        bottom = params.get("bottom", img.height)
        img = img.crop((left, top, right, bottom))
        out_name = f"{stem}_cropped_{ts}{src.suffix}"

    elif operation == "watermark":
        text = params.get("text", "WATERMARK")
        opacity = int(params.get("opacity", 0.3) * 255)
        overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        try:
            font = ImageFont.truetype("arial.ttf", max(img.width // 15, 24))
        except OSError:
            font = ImageFont.load_default()
        bbox = draw.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        x = (img.width - tw) // 2
        y = (img.height - th) // 2
        draw.text((x, y), text, fill=(128, 128, 128, opacity), font=font)
        if img.mode != "RGBA":
            img = img.convert("RGBA")
        img = Image.alpha_composite(img, overlay)
        out_name = f"{stem}_watermarked_{ts}.png"

    elif operation == "convert":
        fmt = params.get("format", "PNG").upper()
        ext = f".{fmt.lower()}"
        if fmt == "JPEG" and img.mode == "RGBA":
            img = img.convert("RGB")
        out_name = f"{stem}_converted_{ts}{ext}"

    elif operation == "thumbnail":
        size = int(params.get("size", 200))
        img.thumbnail((size, size), Image.LANCZOS)
        out_name = f"{stem}_thumb_{ts}{src.suffix}"

    elif operation == "blur":
        radius = params.get("radius", 5)
        img = img.filter(ImageFilter.GaussianBlur(radius=radius))
        out_name = f"{stem}_blurred_{ts}{src.suffix}"

    elif operation == "rotate":
        angle = params.get("angle", 90)
        img = img.rotate(angle, expand=True)
        out_name = f"{stem}_rotated_{ts}{src.suffix}"

    else:
        return f"错误：不支持的操作 '{operation}'，可选 resize/crop/watermark/convert/thumbnail/blur/rotate"

    output_path = WORKSPACE_DIR / out_name

    save_fmt = None
    if output_path.suffix.lower() in (".jpg", ".jpeg"):
        save_fmt = "JPEG"
        if img.mode == "RGBA":
            img = img.convert("RGB")
    elif output_path.suffix.lower() == ".png":
        save_fmt = "PNG"

    img.save(str(output_path), format=save_fmt)
    return str(output_path)
