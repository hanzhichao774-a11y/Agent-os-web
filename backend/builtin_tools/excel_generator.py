"""Excel 报表导出工具 — 将结构化数据输出为带样式的 xlsx 文件。"""

import json
import time
import re
from pathlib import Path

import xlsxwriter

from config import WORKSPACE_DIR


def generate_excel(
    data_json: str,
    output_filename: str = "",
    sheet_name: str = "Sheet1",
) -> str:
    """根据 JSON 数据生成格式化的 Excel 文件。

    参数:
        data_json: JSON 字符串，支持两种格式:
            格式1: {"headers": ["列1","列2"], "rows": [["值1","值2"], ...]}
            格式2: [{"列1": "值1", "列2": "值2"}, ...]
        output_filename: 输出文件名（可选，留空自动生成）
        sheet_name: 工作表名称，默认 Sheet1
    返回:
        生成的 xlsx 文件绝对路径
    """
    data = json.loads(data_json)

    if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
        headers = list(data[0].keys())
        rows = [[item.get(h, "") for h in headers] for item in data]
    elif isinstance(data, dict) and "headers" in data and "rows" in data:
        headers = data["headers"]
        rows = data["rows"]
    else:
        return "错误：data_json 格式不正确，需要 {headers, rows} 或 [{col: val}, ...] 格式"

    if not headers:
        return "错误：数据中没有列头信息"

    if not output_filename:
        ts = int(time.time())
        output_filename = f"export_{ts}.xlsx"
    if not output_filename.endswith(".xlsx"):
        output_filename += ".xlsx"

    output_path = WORKSPACE_DIR / output_filename

    workbook = xlsxwriter.Workbook(str(output_path))
    worksheet = workbook.add_worksheet(sheet_name)

    header_fmt = workbook.add_format({
        "bold": True,
        "font_size": 11,
        "font_color": "#FFFFFF",
        "bg_color": "#4A90D9",
        "border": 1,
        "border_color": "#3A7BC8",
        "align": "center",
        "valign": "vcenter",
        "text_wrap": True,
    })
    cell_fmt = workbook.add_format({
        "font_size": 10,
        "border": 1,
        "border_color": "#DDDDDD",
        "valign": "vcenter",
        "text_wrap": True,
    })
    num_fmt = workbook.add_format({
        "font_size": 10,
        "border": 1,
        "border_color": "#DDDDDD",
        "valign": "vcenter",
        "num_format": "#,##0.##",
    })
    alt_row_fmt = workbook.add_format({
        "font_size": 10,
        "border": 1,
        "border_color": "#DDDDDD",
        "bg_color": "#F5F7FA",
        "valign": "vcenter",
        "text_wrap": True,
    })

    col_widths = [len(str(h)) for h in headers]

    for col, header in enumerate(headers):
        worksheet.write(0, col, header, header_fmt)

    for row_idx, row in enumerate(rows):
        fmt = alt_row_fmt if row_idx % 2 == 1 else cell_fmt
        for col_idx, value in enumerate(row):
            if isinstance(value, (int, float)):
                worksheet.write_number(row_idx + 1, col_idx, value, num_fmt)
            else:
                worksheet.write(row_idx + 1, col_idx, str(value) if value is not None else "", fmt)
            col_widths[col_idx] = max(col_widths[col_idx], len(str(value or "")))

    for col_idx, width in enumerate(col_widths):
        worksheet.set_column(col_idx, col_idx, min(width + 4, 50))

    worksheet.set_row(0, 24)
    worksheet.autofilter(0, 0, len(rows), len(headers) - 1)
    worksheet.freeze_panes(1, 0)

    workbook.close()
    return str(output_path)
