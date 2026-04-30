"""数据可视化工具 — 基于 matplotlib 生成常见商业图表。"""

import json
import time
import re
from pathlib import Path

from config import WORKSPACE_DIR

_plt = None
_fm = None
_CN_FONT = None


def _ensure_matplotlib():
    """Lazy-load matplotlib to avoid startup thread exhaustion."""
    global _plt, _fm
    if _plt is not None:
        return
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.font_manager as fm
    _plt = plt
    _fm = fm

def _get_cn_font():
    """Find a CJK font available on the system for matplotlib."""
    global _CN_FONT
    _ensure_matplotlib()
    if _CN_FONT is not None:
        return _CN_FONT

    candidates = [
        "SimHei", "Heiti SC", "Heiti TC", "WenQuanYi Micro Hei",
        "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC",
        "Microsoft YaHei", "STHeiti", "Arial Unicode MS",
    ]
    available = {f.name for f in _fm.fontManager.ttflist}
    for name in candidates:
        if name in available:
            _CN_FONT = name
            _plt.rcParams["font.sans-serif"] = [name, "DejaVu Sans"]
            _plt.rcParams["axes.unicode_minus"] = False
            return _CN_FONT

    _CN_FONT = ""
    return _CN_FONT


_COLORS = ["#4A90D9", "#E8645A", "#F5A623", "#7ED321", "#9B59B6",
           "#1ABC9C", "#E67E22", "#3498DB", "#E74C3C", "#2ECC71"]


def generate_chart(
    data_json: str,
    chart_type: str,
    title: str,
    x_label: str = "",
    y_label: str = "",
    output_filename: str = "",
) -> str:
    """根据 JSON 数据生成图表并保存为 PNG 图片。

    参数:
        data_json: JSON 字符串，格式为:
            单系列: {"labels": ["A","B","C"], "values": [10,20,30]}
            多系列: {"labels": ["A","B","C"], "series": {"系列1": [10,20,30], "系列2": [5,15,25]}}
        chart_type: 图表类型，可选 bar(柱状图) / line(折线图) / pie(饼图) / scatter(散点图) / hbar(水平柱状图)
        title: 图表标题
        x_label: X轴标签（可选）
        y_label: Y轴标签（可选）
        output_filename: 输出文件名（可选，留空自动生成）
    返回:
        生成的 PNG 图片文件绝对路径
    """
    _get_cn_font()

    data = json.loads(data_json)
    labels = data.get("labels", [])
    values = data.get("values", [])
    series = data.get("series", {})

    if not labels:
        return "错误：data_json 中缺少 labels 字段"

    multi = bool(series)
    if not multi and not values:
        return "错误：data_json 中缺少 values 或 series 字段"

    fig, ax = _plt.subplots(figsize=(10, 6))
    fig.patch.set_facecolor("#FAFAFA")
    ax.set_facecolor("#FAFAFA")

    chart_type = chart_type.lower().strip()

    if chart_type == "bar":
        if multi:
            import numpy as np
            x = np.arange(len(labels))
            n = len(series)
            width = 0.8 / n
            for i, (name, vals) in enumerate(series.items()):
                ax.bar(x + i * width - 0.4 + width / 2, vals, width,
                       label=name, color=_COLORS[i % len(_COLORS)])
            ax.set_xticks(x)
            ax.set_xticklabels(labels)
            ax.legend()
        else:
            colors = [_COLORS[i % len(_COLORS)] for i in range(len(labels))]
            ax.bar(labels, values, color=colors)

    elif chart_type == "hbar":
        if multi:
            import numpy as np
            y = np.arange(len(labels))
            n = len(series)
            height = 0.8 / n
            for i, (name, vals) in enumerate(series.items()):
                ax.barh(y + i * height - 0.4 + height / 2, vals, height,
                        label=name, color=_COLORS[i % len(_COLORS)])
            ax.set_yticks(y)
            ax.set_yticklabels(labels)
            ax.legend()
        else:
            colors = [_COLORS[i % len(_COLORS)] for i in range(len(labels))]
            ax.barh(labels, values, color=colors)

    elif chart_type == "line":
        if multi:
            for i, (name, vals) in enumerate(series.items()):
                ax.plot(labels, vals, marker="o", label=name,
                        color=_COLORS[i % len(_COLORS)], linewidth=2)
            ax.legend()
        else:
            ax.plot(labels, values, marker="o", color=_COLORS[0], linewidth=2)
            ax.fill_between(range(len(values)), values, alpha=0.15, color=_COLORS[0])

    elif chart_type == "pie":
        pie_values = list(series.values())[0] if multi else values
        pie_labels = labels
        ax.pie(pie_values, labels=pie_labels, autopct="%1.1f%%",
               colors=_COLORS[:len(pie_labels)], startangle=90)
        ax.axis("equal")

    elif chart_type == "scatter":
        if multi:
            for i, (name, vals) in enumerate(series.items()):
                ax.scatter(labels, vals, label=name, s=80,
                           color=_COLORS[i % len(_COLORS)], alpha=0.8)
            ax.legend()
        else:
            ax.scatter(labels, values, s=80, color=_COLORS[0], alpha=0.8)
    else:
        return f"错误：不支持的图表类型 '{chart_type}'，可选 bar/line/pie/scatter/hbar"

    ax.set_title(title, fontsize=14, pad=12)
    if x_label and chart_type != "pie":
        ax.set_xlabel(x_label)
    if y_label and chart_type != "pie":
        ax.set_ylabel(y_label)

    if chart_type not in ("pie",):
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.grid(axis="y", alpha=0.3)

    _plt.tight_layout()

    if not output_filename:
        ts = int(time.time())
        safe_title = re.sub(r"[^\w\u4e00-\u9fff]", "_", title)[:20]
        output_filename = f"chart_{safe_title}_{ts}.png"
    if not output_filename.endswith(".png"):
        output_filename += ".png"

    output_path = WORKSPACE_DIR / output_filename
    fig.savefig(str(output_path), dpi=150, bbox_inches="tight")
    _plt.close(fig)

    try:
        from context import current_project_id, current_task_id
        from database import register_task_file
        pid = current_project_id.get()
        if pid:
            register_task_file(pid, current_task_id.get(), output_filename, "output", "workspace")
    except Exception:
        pass

    return str(output_path)
