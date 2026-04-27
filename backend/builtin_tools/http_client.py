"""HTTP 请求工具 — 调用外部 API 的通用 HTTP 客户端。"""

import json

import httpx

_MAX_RESPONSE_LEN = 5000
_TIMEOUT = 30


def http_request(
    url: str,
    method: str = "GET",
    headers_json: str = "{}",
    body: str = "",
) -> str:
    """发送 HTTP 请求并返回响应内容。

    参数:
        url: 请求地址（完整 URL，如 https://api.example.com/data）
        method: 请求方法，可选 GET / POST / PUT / DELETE，默认 GET
        headers_json: 请求头 JSON 字符串，如 {"Authorization": "Bearer xxx"}
        body: 请求体（POST/PUT 时使用），可以是 JSON 字符串或普通文本
    返回:
        格式为 "状态码: xxx\\n响应内容: ..." 的字符串
    """
    method = method.upper().strip()
    if method not in ("GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"):
        return f"错误：不支持的 HTTP 方法 '{method}'，可选 GET/POST/PUT/DELETE/PATCH"

    try:
        headers = json.loads(headers_json) if headers_json else {}
    except json.JSONDecodeError:
        return "错误：headers_json 不是有效的 JSON 格式"

    try:
        with httpx.Client(timeout=_TIMEOUT, follow_redirects=True) as client:
            kwargs: dict = {"headers": headers}

            if method in ("POST", "PUT", "PATCH") and body:
                try:
                    json_body = json.loads(body)
                    kwargs["json"] = json_body
                except json.JSONDecodeError:
                    kwargs["content"] = body
                    if "Content-Type" not in headers:
                        kwargs["headers"]["Content-Type"] = "text/plain"

            resp = client.request(method, url, **kwargs)

            content_type = resp.headers.get("content-type", "")
            if "json" in content_type:
                try:
                    body_text = json.dumps(resp.json(), ensure_ascii=False, indent=2)
                except Exception:
                    body_text = resp.text
            else:
                body_text = resp.text

            if len(body_text) > _MAX_RESPONSE_LEN:
                body_text = body_text[:_MAX_RESPONSE_LEN] + f"\n... (截断，原始长度 {len(resp.text)} 字符)"

            return f"状态码: {resp.status_code}\n响应内容:\n{body_text}"

    except httpx.TimeoutException:
        return f"错误：请求超时（{_TIMEOUT}秒），URL: {url}"
    except httpx.ConnectError:
        return f"错误：无法连接到 {url}，请检查地址是否正确"
    except Exception as e:
        return f"错误：HTTP 请求失败: {e}"
