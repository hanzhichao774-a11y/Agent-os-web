"""
技能与智能体管理 API 单元测试

运行方式:
    cd backend
    .venv/bin/pytest tests/test_skill_agent_api.py -v
"""
import pytest
from httpx import AsyncClient, ASGITransport
from main import app, _skill_registry, _agent_tools, AGENT_CONFIGS, SKILLS_DIR, scan_skills


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture(autouse=True)
def clean_state():
    """每个测试前后清理状态。"""
    original_tools = {k: list(v) for k, v in _agent_tools.items()}
    yield
    _agent_tools.clear()
    _agent_tools.update(original_tools)
    for f in SKILLS_DIR.glob("ztst*.py"):
        f.unlink(missing_ok=True)
    scan_skills()


# ─── 辅助：创建一个测试用技能文件 ───

def _create_test_skill(name: str = "ztstdemo") -> str:
    code = f'''
SKILL_META = {{
    "name": "测试技能_{name}",
    "icon": "🧪",
    "category": "data",
    "description": "单元测试用技能",
}}

def run(x: float = 0) -> float:
    """返回 x * 2"""
    return x * 2
'''
    filepath = SKILLS_DIR / f"{name}.py"
    filepath.write_text(code, encoding="utf-8")
    scan_skills()
    return name


# ═══════════════════════════════════════════════════════════════
# 1. 技能 CRUD
# ═══════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_list_skills(client: AsyncClient):
    """GET /api/skills 应返回列表，含 mounted_agents 字段。"""
    resp = await client.get("/api/skills")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    if len(data) > 0:
        assert "mounted_agents" in data[0]


@pytest.mark.anyio
async def test_run_skill(client: AsyncClient):
    """POST /api/skills/{id}/run 执行技能并返回结果。"""
    skill_id = _create_test_skill("ztstrun")
    resp = await client.post(f"/api/skills/{skill_id}/run", json={"params": {"x": 5}})
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["result"] == "10.0"


@pytest.mark.anyio
async def test_run_skill_not_found(client: AsyncClient):
    """POST /api/skills/不存在的id/run 应返回错误。"""
    resp = await client.post("/api/skills/nonexistent_xyz/run", json={"params": {}})
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is False
    assert "不存在" in body["error"]


@pytest.mark.anyio
async def test_delete_skill(client: AsyncClient):
    """DELETE /api/skills/{id} 应删除技能文件并清除绑定。"""
    skill_id = _create_test_skill("ztstdel")
    assert skill_id in _skill_registry

    # 先绑定到某个 agent
    _agent_tools["a1"] = [skill_id]

    resp = await client.delete(f"/api/skills/{skill_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True

    # 注册表已移除
    assert skill_id not in _skill_registry
    # agent 绑定已清除
    assert skill_id not in _agent_tools.get("a1", [])
    # 文件已删除
    assert not (SKILLS_DIR / f"{skill_id}.py").exists()


@pytest.mark.anyio
async def test_delete_skill_not_found(client: AsyncClient):
    """DELETE /api/skills/不存在 应返回错误。"""
    resp = await client.delete("/api/skills/nonexistent_xyz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is False


# ═══════════════════════════════════════════════════════════════
# 2. Agent 技能挂载
# ═══════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_set_agent_tools(client: AsyncClient):
    """PUT /api/agents/{id}/tools 应更新挂载列表。"""
    skill_id = _create_test_skill("ztstmount")
    resp = await client.put("/api/agents/a1/tools", json={"skill_ids": [skill_id]})
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert _agent_tools["a1"] == [skill_id]


@pytest.mark.anyio
async def test_set_agent_tools_invalid_agent(client: AsyncClient):
    """PUT /api/agents/不存在/tools 应返回错误。"""
    resp = await client.put("/api/agents/fake_agent/tools", json={"skill_ids": []})
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is False


@pytest.mark.anyio
async def test_mount_unmount_flow(client: AsyncClient):
    """完整挂载→验证→卸载→验证流程。"""
    sid = _create_test_skill("_test_flow")

    # 挂载
    resp = await client.put("/api/agents/a1/tools", json={"skill_ids": [sid]})
    assert resp.json()["success"] is True

    # 列表中应显示挂载关系
    resp = await client.get("/api/skills")
    skills = resp.json()
    target = next((s for s in skills if s["id"] == sid), None)
    assert target is not None
    assert any(a["id"] == "a1" for a in target["mounted_agents"])

    # 卸载
    resp = await client.put("/api/agents/a1/tools", json={"skill_ids": []})
    assert resp.json()["success"] is True
    assert _agent_tools["a1"] == []


# ═══════════════════════════════════════════════════════════════
# 3. Agent 配置修改
# ═══════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_update_agent_config(client: AsyncClient):
    """PUT /api/agents/{id}/config 应更新描述和指令。"""
    original_desc = AGENT_CONFIGS["a1"]["description"]
    original_instr = list(AGENT_CONFIGS["a1"].get("instructions", []))

    try:
        resp = await client.put("/api/agents/a1/config", json={
            "description": "测试描述",
            "instructions": ["指令一", "指令二"],
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert AGENT_CONFIGS["a1"]["description"] == "测试描述"
        assert AGENT_CONFIGS["a1"]["instructions"] == ["指令一", "指令二"]
    finally:
        AGENT_CONFIGS["a1"]["description"] = original_desc
        AGENT_CONFIGS["a1"]["instructions"] = original_instr


@pytest.mark.anyio
async def test_update_agent_config_partial(client: AsyncClient):
    """PUT /api/agents/{id}/config 仅更新描述，不影响指令。"""
    original_instr = list(AGENT_CONFIGS["a1"].get("instructions", []))

    try:
        resp = await client.put("/api/agents/a1/config", json={
            "description": "仅改描述",
        })
        assert resp.status_code == 200
        assert AGENT_CONFIGS["a1"]["description"] == "仅改描述"
        assert AGENT_CONFIGS["a1"].get("instructions", []) == original_instr
    finally:
        AGENT_CONFIGS["a1"]["description"] = "擅长 SQL 查询、数据清洗、统计建模，可直接操作 CSV/Excel 数据"
        AGENT_CONFIGS["a1"]["instructions"] = original_instr


@pytest.mark.anyio
async def test_update_agent_config_invalid_agent(client: AsyncClient):
    """PUT /api/agents/不存在/config 应返回错误。"""
    resp = await client.put("/api/agents/fake_agent/config", json={"description": "x"})
    assert resp.status_code == 200
    assert resp.json()["success"] is False


# ═══════════════════════════════════════════════════════════════
# 4. Agent 列表返回完整字段
# ═══════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_list_agents_fields(client: AsyncClient):
    """GET /api/agents 应返回 instructions 和 custom_tools 字段。"""
    resp = await client.get("/api/agents")
    assert resp.status_code == 200
    agents = resp.json()
    assert len(agents) > 0
    a = agents[0]
    assert "instructions" in a
    assert "custom_tools" in a
    assert "builtin_tools" in a
    assert "description" in a


# ═══════════════════════════════════════════════════════════════
# 5. 端到端：创建技能→挂载→执行→删除
# ═══════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_e2e_skill_lifecycle(client: AsyncClient):
    """完整的技能生命周期：创建→挂载→执行→卸载→删除。"""
    sid = _create_test_skill("_test_e2e")

    # 1. 确认出现在列表
    resp = await client.get("/api/skills")
    ids = [s["id"] for s in resp.json()]
    assert sid in ids

    # 2. 挂载到 a1
    resp = await client.put("/api/agents/a1/tools", json={"skill_ids": [sid]})
    assert resp.json()["success"]

    # 3. 执行
    resp = await client.post(f"/api/skills/{sid}/run", json={"params": {"x": 7}})
    assert resp.json()["result"] == "14.0"

    # 4. 验证挂载关系
    resp = await client.get("/api/skills")
    skill = next(s for s in resp.json() if s["id"] == sid)
    assert any(a["id"] == "a1" for a in skill["mounted_agents"])

    # 5. 删除（应自动卸载）
    resp = await client.delete(f"/api/skills/{sid}")
    assert resp.json()["success"]
    assert sid not in _agent_tools.get("a1", [])
    assert sid not in _skill_registry
