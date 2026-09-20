def _build_user_modifications_block(text: str) -> str:
    if not text or not text.strip():
        return ""
    return f"\n【用户修改意见】\n{text.strip()}"


def _format_dimension_units(dimension_units) -> str:
    """Format a list of unit dicts from S2 拆解 into the bulleted string the
    world_generation prompt expects.

    Input shape (per unit dict):
      - unit_name: str
      - description: str

    Output (example):
      - **名称A**: 描述A 截断到 300 字
      - **名称B**: 描述B 截断到 300 字

    Empty / None input → "（无）" — prompt template 中此为 fallback 串,
    LLM 看到时知道该维度没有单元,会自然省略。

    2026-09-19 引入:砍 S3/S4 后,S2 5 维度单元信息作为世界观生成的
    context 直接喂入 world_generation prompt。
    """
    if not dimension_units:
        return "（无）"
    lines = []
    for u in dimension_units:
        if not isinstance(u, dict):
            continue
        name = u.get("unit_name", "未命名") or "未命名"
        desc = (u.get("description", "") or "").strip()[:300]
        lines.append(f"- **{name}**: {desc}")
    return "\n".join(lines) if lines else "（无）"