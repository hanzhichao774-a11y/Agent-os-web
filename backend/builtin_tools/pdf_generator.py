"""PDF 报告生成工具 — 将结构化文本内容输出为 PDF 文件。"""

import re
import time
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

from config import WORKSPACE_DIR

pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))

_BASE_FONT = "STSong-Light"

_styles = getSampleStyleSheet()
_styles.add(ParagraphStyle(
    "CNTitle", fontName=_BASE_FONT, fontSize=18, leading=24,
    spaceAfter=12, alignment=1,
))
_styles.add(ParagraphStyle(
    "CNHeading", fontName=_BASE_FONT, fontSize=14, leading=18,
    spaceAfter=8, spaceBefore=12, textColor=HexColor("#1a1a1a"),
))
_styles.add(ParagraphStyle(
    "CNBody", fontName=_BASE_FONT, fontSize=10.5, leading=16,
    spaceAfter=6,
))
_styles.add(ParagraphStyle(
    "CNSmall", fontName=_BASE_FONT, fontSize=9, leading=13,
    spaceAfter=4, textColor=HexColor("#555555"),
))


_EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001F9FF"  # Miscellaneous Symbols, Emoticons, etc.
    "\U00002600-\U000027BF"  # Misc symbols (sun, star, etc.)
    "\U0000FE00-\U0000FE0F"  # Variation Selectors
    "\U0000200D"             # Zero Width Joiner
    "\U000020E3"             # Combining Enclosing Keycap
    "\U0000E000-\U0000F8FF"  # Private Use Area
    "]+",
    flags=re.UNICODE,
)


def _strip_unsupported_chars(text: str) -> str:
    """Remove emoji and other characters unsupported by STSong-Light."""
    text = _EMOJI_RE.sub("", text)
    text = re.sub(r"(?m)^-{3,}\s*$", "", text)
    text = re.sub(r"(?m)^\*\s+", "- ", text)
    return text


def _parse_markdown_table(text: str) -> list[list[str]] | None:
    """Extract the first markdown table from *text*. Returns rows or None."""
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    table_lines: list[str] = []
    in_table = False
    for line in lines:
        if "|" in line:
            if re.match(r"^\|[\s\-:|]+\|$", line):
                in_table = True
                continue
            if in_table or line.startswith("|"):
                in_table = True
                cells = [c.strip() for c in line.strip("|").split("|")]
                table_lines.append(cells)
        else:
            if in_table:
                break
    if len(table_lines) < 2:
        return None
    return table_lines


def _build_table_flowable(rows: list[list[str]]) -> Table:
    """Build a styled reportlab Table from parsed row data."""
    col_count = max(len(r) for r in rows)
    for r in rows:
        while len(r) < col_count:
            r.append("")

    wrapped = []
    for i, row in enumerate(rows):
        style_name = "CNSmall" if i > 0 else "CNBody"
        wrapped.append([Paragraph(cell, _styles[style_name]) for cell in row])

    page_w = A4[0] - 50 * mm
    col_w = page_w / col_count
    t = Table(wrapped, colWidths=[col_w] * col_count)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#4A90D9")),
        ("TEXTCOLOR", (0, 0), (-1, 0), HexColor("#FFFFFF")),
        ("FONTNAME", (0, 0), (-1, -1), _BASE_FONT),
        ("FONTSIZE", (0, 0), (-1, 0), 10),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#CCCCCC")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#F9F9F9"), HexColor("#FFFFFF")]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def generate_pdf_report(title: str, content: str, output_filename: str = "") -> str:
    """根据标题和 Markdown 文本内容生成 PDF 报告文件。

    参数:
        title: 报告标题（显示在首页）
        content: 报告正文，支持 Markdown 标题(#/##/###)、段落、表格(| 格式)
        output_filename: 可选输出文件名（不含路径），留空则自动生成
    返回:
        生成的 PDF 文件绝对路径
    """
    if not output_filename:
        ts = int(time.time())
        safe_title = re.sub(r"[^\w\u4e00-\u9fff]", "_", title)[:20]
        output_filename = f"report_{safe_title}_{ts}.pdf"
    if not output_filename.endswith(".pdf"):
        output_filename += ".pdf"

    title = _strip_unsupported_chars(title)
    content = _strip_unsupported_chars(content)

    output_path = WORKSPACE_DIR / output_filename
    doc = SimpleDocTemplate(
        str(output_path), pagesize=A4,
        leftMargin=25 * mm, rightMargin=25 * mm,
        topMargin=20 * mm, bottomMargin=20 * mm,
    )

    story: list = []

    story.append(Paragraph(title, _styles["CNTitle"]))
    story.append(Spacer(1, 6 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#4A90D9")))
    story.append(Spacer(1, 4 * mm))

    sections = re.split(r"(?m)^(#{1,3})\s+(.+)$", content)

    i = 0
    while i < len(sections):
        chunk = sections[i].strip()

        if chunk in ("#", "##", "###") and i + 1 < len(sections):
            heading_text = sections[i + 1].strip()
            story.append(Paragraph(heading_text, _styles["CNHeading"]))
            i += 2
            continue

        if not chunk:
            i += 1
            continue

        table_data = _parse_markdown_table(chunk)
        if table_data:
            before_table = chunk[:chunk.index("|")].strip()
            if before_table:
                for para in before_table.split("\n\n"):
                    para = para.strip()
                    if para:
                        para = para.replace("\n", "<br/>")
                        story.append(Paragraph(para, _styles["CNBody"]))
            story.append(Spacer(1, 2 * mm))
            story.append(_build_table_flowable(table_data))
            story.append(Spacer(1, 3 * mm))
        else:
            for para in chunk.split("\n\n"):
                para = para.strip()
                if not para:
                    continue
                para = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", para)
                para = re.sub(r"\*(.+?)\*", r"<i>\1</i>", para)
                para = para.replace("\n", "<br/>")
                story.append(Paragraph(para, _styles["CNBody"]))
        i += 1

    doc.build(story)

    try:
        from context import current_project_id, current_task_id
        from database import register_task_file
        pid = current_project_id.get()
        if pid:
            register_task_file(pid, current_task_id.get(), output_filename, "output", "workspace")
    except Exception:
        pass

    return str(output_path)
