import re

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)
_MEMBER_XML_RE = re.compile(r"<member\b[^>]*>.*?</member>", re.DOTALL)
_MEMBER_LIST_BLOCK_RE = re.compile(
    r"Please choose the correct member from the list of members:\s*(?:<member\b.*?</member>\s*)+",
    re.DOTALL,
)


def clean_content(text: str) -> str:
    """清理完整消息中的 think 标签、成员列表 XML 等。"""
    text = _THINK_RE.sub("", text)
    text = _MEMBER_LIST_BLOCK_RE.sub("", text)
    text = _MEMBER_XML_RE.sub("", text)
    return text.strip()


def clean_delta(text: str) -> str:
    """清理流式 chunk 中的 think 标签，但保留空白和换行。"""
    return _THINK_RE.sub("", text)
