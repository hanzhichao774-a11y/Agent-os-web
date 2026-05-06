import os
import sys
from typing import Dict, List, Tuple

SKILL_META = {
    "name": "文档字数统计",
    "icon": "📊",
    "category": "data",
    "description": "统计知识库中所有文档的字数，并按字数从多到少排序展示，帮助用户快速了解各文档的内容规模。",
}

def run(order: str = "desc", **params) -> str:
    """
    统计知识库文档字数并排序
    
    Args:
        order: 排序方式，"desc" 为降序（默认），"asc" 为升序
    """
    # 导入 AgentOS 内部模块
    sys.path.insert(0, "/app")
    from config import KNOWLEDGE_DOCS_DIR
    from doc_parser import read_document_text
    
    # 获取知识库目录
    docs_dir = KNOWLEDGE_DOCS_DIR
    
    # 检查目录是否存在
    if not os.path.exists(docs_dir):
        return f"❌ 知识库目录不存在：{docs_dir}"
    
    # 遍历所有文档文件
    doc_stats: List[Tuple[str, int]] = []
    
    for filename in os.listdir(docs_dir):
        file_path = os.path.join(docs_dir, filename)
        
        # 跳过目录和非文件项
        if not os.path.isfile(file_path):
            continue
            
        try:
            # 读取文档内容
            content = read_document_text(file_path)
            
            # 统计字数（按字符计算，去除空白后）
            # 中文字符直接计数，英文按单词计数
            cleaned = content.strip()
            if not cleaned:
                word_count = 0
            else:
                # 简单统计：总字符数（不含空白）作为字数参考
                # 对于中文文档，字符数即字数；对于英文，近似估算
                word_count = len(cleaned.replace(" ", "").replace("\n", "").replace("\t", ""))
            
            doc_stats.append((filename, word_count))
            
        except Exception as e:
            # 读取失败的文档，标记为错误
            doc_stats.append((filename, -1))
    
    # 检查是否有文档
    if not doc_stats:
        return f"📂 知识库目录为空：{docs_dir}"
    
    # 分离成功和失败的
    success_docs = [(name, count) for name, count in doc_stats if count >= 0]
    failed_docs = [name for name, count in doc_stats if count < 0]
    
    # 排序
    reverse = (order.lower() != "asc")
    success_docs.sort(key=lambda x: x[1], reverse=reverse)
    
    # 构建输出
    lines = []
    lines.append("=" * 50)
    lines.append("📊 知识库文档字数统计报告")
    lines.append("=" * 50)
    lines.append(f"📁 知识库路径：{docs_dir}")
    lines.append(f"📄 文档总数：{len(doc_stats)}")
    lines.append(f"✅ 成功读取：{len(success_docs)}")
    if failed_docs:
        lines.append(f"❌ 读取失败：{len(failed_docs)}")
    lines.append(f"📈 排序方式：{'降序（字数多→少）' if reverse else '升序（字数少→多）'}")
    lines.append("-" * 50)
    
    # 排序结果表格
    if success_docs:
        lines.append(f"{'排名':<4} {'文档名称':<30} {'字数':>10}")
        lines.append("-" * 50)
        
        for idx, (name, count) in enumerate(success_docs, 1):
            # 截断过长的文件名
            display_name = name[:28] + ".." if len(name) > 30 else name
            lines.append(f"{idx:<4} {display_name:<30} {count:>10,}")
        
        # 统计信息
        total_chars = sum(c for _, c in success_docs)
        avg_chars = total_chars // len(success_docs) if success_docs else 0
        max_doc = success_docs[0] if reverse else success_docs[-1]
        min_doc = success_docs[-1] if reverse else success_docs[0]
        
        lines.append("-" * 50)
        lines.append(f"📌 总字数：{total_chars:,}")
        lines.append(f"📌 平均字数：{avg_chars:,}")
        lines.append(f"📌 最多字数：{max_doc[1]:,}（{max_doc[0]}）")
        lines.append(f"📌 最少字数：{min_doc[1]:,}（{min_doc[0]}）")
    
    # 失败的文档
    if failed_docs:
        lines.append("-" * 50)
        lines.append("⚠️ 以下文档读取失败：")
        for name in failed_docs:
            lines.append(f"   • {name}")
    
    lines.append("=" * 50)
    
    return "\n".join(lines)