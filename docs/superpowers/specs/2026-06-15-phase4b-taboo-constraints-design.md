# Phase 4b: TabooConstraintChecker — L3 禁忌约束检测 设计方案

> 日期: 2026-06-15 | 状态: 已确认 | 依赖: Phase 0-3, Phase 4a

## 范围

v1.6 TRD Phase 4，L3 禁忌约束部分（Section 4.8.2），约 6h。

### 本轮实现

- TabooConstraintChecker：三层检测（全局 → 体裁 → 角色），仅角色禁忌使用 Tier 3 LLM
- 体裁模板扩展：`cool_novel.yaml` 新增 `taboos` 结构化区块，替换现有 `taboo_words` 列表
- ReviewerAgent 新增 `run_style_guard()` 方法，在 Narrative Guard 之后执行

### 本轮不实现

- 前端 Style Guard 结果展示 — Phase 5
- `style_rules` 主观规则（如"配角反应描写"）— 不在本次范围
- 悬疑/严肃文学体裁的 taboos 定义 — 仅 cool_novel.yaml

---

## 1. 架构

```
ReviewerAgent.run_style_guard(scene_text, genre_template, characters)
        │
        ▼
TabooConstraintChecker.check(scene_text, genre_taboos, character_taboos)
        │
        ├── Layer 1: _check_global_taboos(scene_text)
        │     └── regex + keyword → 直接判定，零 LLM
        │
        ├── Layer 2: _check_genre_taboos(scene_text, genre_taboos)
        │     └── regex / sliding_window / consecutive_match → 直接判定，零 LLM
        │
        └── Layer 3: _check_character_taboos(scene_text, character_taboos)
              └── keyword match → candidates → Tier 3 Haiku 确认 → 合并结果
```

**执行时机：** Reviewer 的 Style Guard 阶段，在 Narrative Guard 之后。检测到违规不阻断 Scene，结果写入 scene meta 文件。

## 2. 数据模型

```python
@dataclass
class TabooViolation:
    pattern_name: str       # e.g. "虐主", "全局-元引用", "角色-林峰-禁止示弱"
    layer: str              # "global" | "genre" | "character"
    severity: str           # "error" | "warning"
    matched_text: str       # 违规文本片段（~80 chars）
    context: str            # 上下文（~200 chars）
```

## 3. Layer 1: 全局禁忌（硬编码，零 LLM）

所有体裁通用的禁忌规则，约 15 个模式。

| 类别 | 模式 | 检测方式 | severity |
|------|------|----------|----------|
| 元引用 | `如果这是一本小说`, `作者说`, `读者朋友们`, `本章完` | regex | error |
| 元引用 | `按下不表`, `暂且不提`, `后文再续` | regex | warning |
| 真实品牌 | `iPhone`, `微信`, `支付宝`, `抖音`, `淘宝`, `百度` | keyword | error |
| 真实品牌 | `Nike`, `Adidas`, `Starbucks`, `McDonald` | keyword | error |
| 真实平台 | `起点`, `番茄小说`, `晋江` (平台名写进故事) | keyword | error |
| 叙事断裂 | `各位看官`, `书接上文` | regex | warning |

实现：所有模式硬编码为类常量。`_check_global_taboos()` 遍历模式匹配，返回 `list[TabooViolation]`。

## 4. Layer 2: 体裁禁忌（YAML 驱动，零 LLM）

从体裁模板 `taboos` 区块读取。支持三种检测类型：

### 检测类型

| type | 说明 | 参数 |
|------|------|------|
| `keyword` | 简单关键词匹配 | `words: list[str]` |
| `sliding_window` | 滑动窗口关键词密度检测 | `keywords: list[str]`, `max_chars: int` |
| `consecutive_match` | 连续段落匹配检测 | `failure_keywords: list[str]`, `max_consecutive: int` |

### YAML 格式 (`cool_novel.yaml`)

```yaml
taboos:
  - name: "虐主"
    type: "sliding_window"
    keywords: ["受伤", "吐血", "被击飞", "惨叫", "虐待", "折磨", "碾压", "断臂"]
    max_chars: 300
    severity: error

  - name: "连续失败"
    type: "consecutive_match"
    failure_keywords: ["失败", "输了", "不敌", "落败", "被击败", "无力", "败退"]
    max_consecutive: 2
    severity: error

  - name: "禁用语"
    type: "keyword"
    words: ["无能为力", "绝望", "放弃", "认命", "太强了打不过", "不可能", "没办法",
            "恐怖如斯", "倒吸一口凉气", "此子不可留"]
    severity: warning
```

现有 `taboo_words` 列表并入 `taboos` 区块的 `keyword` 类型条目，删除旧的独立列表。

### sliding_window 算法

以 `max_chars` 为窗口大小，step = 窗口的 1/4。扫描每个窗口内的关键词命中数。命中数 ≥ 3 的窗口标记为违规。

### consecutive_match 算法

将文本按 `\n\n` 分段。对每段检测是否包含任意 `failure_keywords`。统计连续命中段落数。≥ `max_consecutive` 连续段落标记为违规。

## 5. Layer 3: 角色禁忌（关键词 + Tier 3 LLM）

### 数据源

从 `characters.json` 读取各角色的 `voice_signature.taboos`：

```json
{
  "name": "林峰",
  "voice_signature": {
    "taboos": ["禁止说脏话", "禁止主动求助", "禁止示弱"]
  }
}
```

### 检测流程

1. **关键词匹配** — 禁忌短语 → 关键词映射表查找 → 在场景文本中匹配
2. **候选提取** — 每个命中 → 候选违规（`matched_text` + `context`）
3. **Tier 3 LLM 批量确认** — 所有候选一次 LLM 调用，过滤误报
4. **合并结果** — LLM 确认的违规返回；LLM 不可用则所有候选通过

### 关键词映射表（硬编码）

```python
TABOO_KEYWORD_MAP = {
    "禁止说脏话": ["他妈", "混蛋", "废物", "找死", "该死"],
    "禁止主动求助": ["帮忙", "救我", "求求你", "帮帮我", "拜托", "救命"],
    "禁止示弱": ["我不行", "做不到", "放过我", "饶了我", "我输了"],
    "禁止撒谎": ["骗", "假的", "隐瞒", "没说"],
    "禁止背叛": ["出卖", "背叛", "投靠", "反水"],
}
```

映射表中未找到的禁忌短语 → 跳过（不报错）。

### LLM Prompt

```
system: |
  你是一位网文编辑。以下是从角色禁忌关键词匹配中检测到的候选违规列表。
  判断每个候选是否构成真实的禁忌违规（考虑语境：引述他人、虚构假设、讽刺反语不算违规）。
  只输出 JSON。

user: |
  角色: {character_name}
  禁忌: {taboo_phrase}

  候选违规列表:
  {candidates_text}

  输出 JSON:
  {
    "violations": [
      {"index": <候选序号>, "confirmed": true|false, "reason": "<一句话>"}
    ]
  }
```

Tier 3 Haiku，`json_mode=True`。单次 LLM 调用处理所有候选。

## 6. ReviewerAgent 集成

新增 `run_style_guard()` 方法：

```python
def run_style_guard(
    self,
    scene_text: str,
    genre_template: dict,
    characters: list[dict],
) -> list[dict]:
    """
    执行 Style Guard L3 禁忌约束检测。
    在 Narrative Guard 之后调用。不阻断 Scene。
    返回 TabooViolation 列表的 dict 形式。
    """
```

调用链：`ReviewerAgent.run_style_guard()` → `TabooConstraintChecker.check()`。

结果写入 scene meta：
```python
meta["style_guard_violations"] = [
    {
        "pattern_name": v.pattern_name,
        "layer": v.layer,
        "severity": v.severity,
        "matched_text": v.matched_text,
        "context": v.context,
    }
    for v in violations
]
```

## 7. 降级策略

| 场景 | 行为 |
|------|------|
| 体裁模板无 `taboos` 区块 | Layer 2 返回 `[]` |
| 角色无 `voice_signature.taboos` | Layer 3 返回 `[]` |
| 禁忌短语不在关键词映射表中 | 跳过该禁忌，不报错 |
| Tier 3 LLM 不可用 | Layer 3 所有候选通过（保守策略） |
| 整体异常 | 返回 `[]`，记录 warning，不阻断管线 |

## 8. 文件清单

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 1 | `backend/style_engine/taboo_constraints.py` | **新增** | ~250 行 |
| 2 | `backend/style_engine/__init__.py` | 修改 | +3 行 |
| 3 | `backend/agents/reviewer.py` | 修改 | +60 行 |
| 4 | `data/style/cool_novel.yaml` | 修改 | +10 行，替换 taboo_words |
| 5 | `backend/api/stage4_writing.py` | 修改 | +5 行 |
| 6 | `tests/test_taboo_constraints.py` | **新增** | ~14 测试 |

## 9. 验收标准

1. `TabooConstraintChecker.check()` 返回正确的三层违规列表
2. Layer 1 全局禁忌正确检测元引用、真实品牌名称
3. Layer 2 `sliding_window` 正确检测连续虐主描写超阈值
4. Layer 2 `consecutive_match` 正确检测连续失败段落
5. Layer 3 关键词匹配 → LLM 确认流程正确，LLM 不可用时候选全部通过
6. `ReviewerAgent.run_style_guard()` 正确调用并返回结果
7. scene meta 文件中出现 `style_guard_violations` 字段
8. 零新增 test 失败（现有 394 passed 保持不变）
