import importlib.util
import inspect
from pathlib import Path

from config import SKILLS_DIR


_skill_registry: dict[str, dict] = {}

VALID_CATEGORIES = {"analysis", "data", "code", "search", "api"}
VALID_PARAM_TYPES = {str, int, float, bool}


def validate_skill(skill: dict) -> tuple[bool, str]:
    """验证技能元数据和函数签名是否符合规范。"""
    meta = skill.get("meta", {})
    run_fn = skill.get("run_fn")

    required_fields = ["name", "icon", "category", "description"]
    for field in required_fields:
        if not meta.get(field):
            return False, f"SKILL_META 缺少必填字段: {field}"

    if meta["category"] not in VALID_CATEGORIES:
        return False, f"category 必须是 {VALID_CATEGORIES} 之一，当前值: {meta['category']}"

    name = meta["name"]
    if len(name) > 20:
        return False, f"name 长度不能超过 20 字符，当前: {len(name)}"

    desc = meta["description"]
    if len(desc) < 5 or len(desc) > 200:
        return False, f"description 长度应为 5~200 字符，当前: {len(desc)}"

    if not callable(run_fn):
        return False, "run 不是可调用对象"

    sig = inspect.signature(run_fn)
    params = list(sig.parameters.values())
    if not params:
        return False, "run() 至少需要 1 个参数"

    for p in params:
        # keyword-only 参数（如 progress_cb 这类基础设施回调）允许任意类型/无注解，
        # 不参与前端 UI 展示，仅供内部桥接（SSE 进度等）使用。
        if p.kind == inspect.Parameter.KEYWORD_ONLY:
            continue
        if p.annotation != inspect.Parameter.empty and p.annotation not in VALID_PARAM_TYPES:
            return False, f"参数 {p.name} 类型 {p.annotation} 不在允许范围 {VALID_PARAM_TYPES}"

    return True, "验证通过"


def _smoke_test_skill(skill_id: str) -> tuple[bool, str]:
    """如果 SKILL_META 包含 examples，自动执行冒烟测试。"""
    skill = _skill_registry.get(skill_id)
    if not skill:
        return False, f"技能 {skill_id} 不在注册表中"

    examples = skill["meta"].get("examples", [])
    if not examples:
        return True, "无 examples，跳过冒烟测试"

    for i, ex in enumerate(examples):
        try:
            result = skill["run_fn"](**ex["input"])
            if not isinstance(result, str):
                result = str(result)
            expect = ex.get("expect_contains")
            if expect and expect not in result:
                return False, f"example[{i}] 输出未包含预期内容 '{expect}'，实际输出: {result[:100]}"
        except Exception as e:
            return False, f"example[{i}] 执行异常: {e}"

    return True, f"全部 {len(examples)} 个 example 通过"


def _load_skill_module(path: Path) -> dict | None:
    """从 .py 文件加载一个技能，返回 {meta, run_fn, params, ...} 或 None。"""
    try:
        spec = importlib.util.spec_from_file_location(path.stem, path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        meta = getattr(mod, "SKILL_META", None)
        run_fn = getattr(mod, "run", None)
        if not meta or not callable(run_fn):
            return None
        sig = inspect.signature(run_fn)
        params = []
        for name, p in sig.parameters.items():
            # keyword-only 参数（基础设施回调，如 progress_cb）不暴露给前端 UI
            if p.kind == inspect.Parameter.KEYWORD_ONLY:
                continue
            ptype = "string"
            if p.annotation in (float, int):
                ptype = "number"
            params.append({"name": name, "type": ptype, "default": str(p.default) if p.default is not inspect.Parameter.empty else None})

        skill_id = path.stem
        if path.parent != SKILLS_DIR and path.name == "main.py":
            skill_id = path.parent.name

        return {
            "id": skill_id,
            "meta": meta,
            "run_fn": run_fn,
            "params": params,
            "file": str(path),
        }
    except Exception as e:
        print(f"[WARN] 加载技能 {path.name} 失败: {e}")
        return None


def scan_skills():
    """扫描 skills/ 目录，支持单文件和目录两种模式，刷新技能注册表。"""
    _skill_registry.clear()
    for item in sorted(SKILLS_DIR.iterdir()):
        if item.name.startswith("_"):
            continue
        if item.is_file() and item.suffix == ".py":
            skill = _load_skill_module(item)
        elif item.is_dir() and (item / "main.py").exists():
            skill = _load_skill_module(item / "main.py")
        else:
            continue
        if not skill:
            continue
        valid, msg = validate_skill(skill)
        if valid:
            _skill_registry[skill["id"]] = skill
            print(f"[SKILL] 已加载: {skill['meta']['name']} ({skill['id']})")
            ok, test_msg = _smoke_test_skill(skill["id"])
            if not ok:
                print(f"[WARN] 技能 {skill['id']} 冒烟测试失败: {test_msg}")
        else:
            print(f"[WARN] 技能 {item.name} 验证失败: {msg}")


scan_skills()
