def _build_user_modifications_block(text: str) -> str:
    if not text or not text.strip():
        return ""
    return f"\n【用户修改意见】\n{text.strip()}"
