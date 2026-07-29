# Genre Beat Patterns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add keyword-triggered `beat_patterns` to each of the 7 genre YAMLs and inject matched templates (via `{genre_beat_patterns}` + `{genre_focus_vocabulary}` placeholders) into Stage 3 outline generation prompts.

**Architecture:** Pure data-driven extension — new `beat_patterns` field on each genre YAML, 2 new helper functions in `planner.py` (one for the focus vocabulary legend, one for keyword-matched beat templates), 1 new validation method in `catalog.py`, and 2 new placeholders in 2 prompt templates. No Python class hierarchy; no Skills.

**Tech Stack:** Python 3.9 + PyYAML + pytest + `@lru_cache`. Existing `GenreCatalog` singleton (`backend/genres/catalog.py`), existing `PlannerAgent` (`backend/agents/planner.py`), existing 3-tier prompt override chain.

**Reference spec:** `docs/superpowers/specs/2026-07-29-genre-beat-patterns-design.md`

**Branch / worktree:** Direct on `feat/writer-character-context` (user preference; no separate worktree).

---

## Task 1: Focus vocabulary file + `_resolve_genre_focus_vocabulary` helper

**Files:**
- Create: `config/genre_focus_vocabulary.yaml`
- Modify: `backend/agents/planner.py` (add helper near `_resolve_genre_extras`)
- Test: `tests/test_genre_beat_patterns.py`

The focus vocabulary is the legend the LLM sees next to the `focus` field in each beat. 6 words: `sensory / action / dialogue / emotion / suspense / reveal`. The helper loads the YAML once (cached) and returns a formatted multi-line string with the leading `【focus 字段图例】` header — that way the prompt template only needs `{genre_focus_vocabulary}` on its own line.

- [ ] **Step 1: Create the focus vocabulary YAML**

Create `config/genre_focus_vocabulary.yaml` with the exact content below:

```yaml
focus_legend:
  sensory:  感官描写为主，渲染氛围/环境/细节
  action:   动作/事件推进为主，节奏紧凑
  dialogue: 对话/心理独白为主，人物互动
  emotion:  情感波动为主，内心刻画
  suspense: 悬念/不安为主，信息管控
  reveal:   揭露/反转为主，情节兑现
```

The `focus_legend` is the single source of truth — the helper reads it; the catalog validator also reads it (added in Task 9). Don't add other fields here; this file is *only* the legend.

- [ ] **Step 2: Write the failing test for `_resolve_genre_focus_vocabulary`**

Create `tests/test_genre_beat_patterns.py` (new file). Write the first test class with one test (additional tests added in later tasks):

```python
"""Tests for genre beat pattern injection into Stage 3 outline prompts.

Pattern: config/genre_focus_vocabulary.yaml -> planner._resolve_genre_focus_vocabulary
       : catalog.<filename> -> planner._resolve_genre_beat_patterns -> prompt placeholders
       : {genre_beat_patterns}, {genre_focus_vocabulary}
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest


class TestFocusVocabulary:
    def test_returns_legend_with_all_six_focus_words_and_header(self):
        """_resolve_genre_focus_vocabulary returns the full legend, prefixed by
        the 【focus 字段图例】 header. All 6 focus words must appear in the output."""
        from backend.agents.planner import _resolve_genre_focus_vocabulary

        result = _resolve_genre_focus_vocabulary()

        assert "【focus 字段图例】" in result
        for word in ("sensory", "action", "dialogue", "emotion", "suspense", "reveal"):
            assert word in result
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
./venv/bin/python -m pytest tests/test_genre_beat_patterns.py::TestFocusVocabulary::test_returns_legend_with_all_six_focus_words_and_header -v
```

Expected: `ImportError: cannot import name '_resolve_genre_focus_vocabulary' from 'backend.agents.planner'`

- [ ] **Step 4: Implement `_resolve_genre_focus_vocabulary`**

Add to `backend/agents/planner.py`, directly below `_resolve_genre_extras` (around line 49, before `CHARACTER_ROLE_LABELS`). The helper must be at module level so `@lru_cache` works. First, add the import at the top of the file (next to `from backend.agents.writer import _resolve_genre_label`):

```python
from functools import lru_cache
```

Then add the helper after `_resolve_genre_extras`:

```python
_FOCUS_VOCAB_PATH = Path(__file__).resolve().parents[2] / "config" / "genre_focus_vocabulary.yaml"


@lru_cache(maxsize=1)
def _resolve_genre_focus_vocabulary() -> str:
    """Load focus vocabulary once and return formatted legend string.

    Returns multi-line text:
      【focus 字段图例】
      - sensory:  感官描写为主，渲染氛围/环境/细节
      - action:   动作/事件推进为主，节奏紧凑
      - dialogue: 对话/心理独白为主，人物互动
      - emotion:  情感波动为主，内心刻画
      - suspense: 悬念/不安为主，信息管控
      - reveal:   揭露/反转为主，情节兑现

    The leading 【focus 字段图例】 header is included so the prompt template
    only needs to place {genre_focus_vocabulary} on its own line.

    Raises FileNotFoundError if the YAML is missing (caller should let it
    propagate so misconfiguration is loud).
    """
    import yaml
    data = yaml.safe_load(_FOCUS_VOCAB_PATH.read_text(encoding="utf-8")) or {}
    legend = data.get("focus_legend") or {}
    lines = ["【focus 字段图例】"]
    for key in ("sensory", "action", "dialogue", "emotion", "suspense", "reveal"):
        desc = legend.get(key, "")
        lines.append(f"- {key}: {desc}")
    return "\n".join(lines)
```

The function relies on `_FOCUS_VOCAB_PATH` being correct (4 levels up from `planner.py` gives repo root). The constant declaration must precede the function; `Path` is already imported by being imported at top — actually `planner.py` doesn't currently import Path, so add it too. Final imports section:

```python
import json
from functools import lru_cache
from pathlib import Path
from typing import Optional

from backend.agents.base_agent import BaseAgent, LLMResponse
from backend.agents.writer import _resolve_genre_label
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
./venv/bin/python -m pytest tests/test_genre_beat_patterns.py::TestFocusVocabulary -v
```

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add config/genre_focus_vocabulary.yaml backend/agents/planner.py tests/test_genre_beat_patterns.py
git commit -m "feat(genres): add focus vocabulary helper for beat pattern legend"
```

---

## Task 2: Author `cool_novel.yaml` beat_patterns

**Files:**
- Modify: `config/genres/cool_novel.yaml` (insert `beat_patterns` block between `trope_patterns` and `thresholds`)

The spec requires all 7 genre YAMLs to declare `beat_patterns` BEFORE the catalog marks the field as required (Task 9). This task authors the first genre — establishes the shape; subsequent tasks (3-8) follow the same shape.

- [ ] **Step 1: Insert beat_patterns block**

Open `config/genres/cool_novel.yaml`. Locate the line `trope_patterns:` (around line 78). After the last trope entry (the `身份揭露` block, around line 90), and BEFORE the `thresholds:` block (around line 91), insert the new block. Verify your insertion is between the closing of `trope_patterns` and the start of `thresholds:`. Use this exact content:

```yaml
beat_patterns:
  - keywords: [打脸, 装逼, 嘲讽, 不自量力, 蝼蚁]
    priority: 90
    beats:
      - { description: "铺垫：对手嚣张/轻视/嘲讽主角，旁观者不看好",     words: 500, focus: "dialogue" }
      - { description: "交锋：主角被压制或隐藏实力，对手更得意",         words: 700, focus: "action"   }
      - { description: "反转：底牌揭露、压倒性爆发",                     words: 900, focus: "reveal"   }
      - { description: "余波：围观者震惊、势力格局变动",                 words: 600, focus: "emotion"  }
  - keywords: [越级, 跨境界, 以弱胜强, 不可能]
    priority: 85
    beats:
      - { description: "实力差展示：明确当前境界差距，铺垫不可能感",       words: 400, focus: "sensory" }
      - { description: "战术/底牌/代价铺垫：主角的准备过程",               words: 800, focus: "action" }
      - { description: "决胜时刻：压倒性胜利，反派不可置信",               words: 1000, focus: "reveal" }
  - keywords: [突破, 升级, 晋升, 实力提升]
    priority: 70
    beats:
      - { description: "升级契机：资源/对手/事件触发",                   words: 500, focus: "sensory" }
      - { description: "升级过程：具体数值/层次/境界变化",                 words: 1000, focus: "action" }
      - { description: "升级余波：配角反应、爽感兑现",                     words: 600, focus: "emotion" }
  - keywords: [身份, 揭露, 暴露, 真实身份]
    priority: 75
    beats:
      - { description: "伏笔激活：之前埋下的身份线索浮现",                 words: 600, focus: "suspense" }
      - { description: "揭露瞬间：所有人震惊、关系重构",                   words: 800, focus: "reveal"   }
      - { description: "新格局展开：新的敌人/盟友/目标",                   words: 500, focus: "emotion"  }
```

Verify after insertion: file still parses as valid YAML (no broken indentation). The block should be at top-level (same indent as `pacing:`, `tone:`, `trope_patterns:`).

- [ ] **Step 2: Verify catalog loads with the new field**

Run:
```bash
./venv/bin/python -c "from backend.genres.catalog import get_catalog; c = get_catalog(); entry = c.get('cool_novel'); assert isinstance(entry['beat_patterns'], list) and len(entry['beat_patterns']) == 4; print(f'cool_novel beat_patterns: {len(entry[\"beat_patterns\"])} templates')"
```

Expected output: `cool_novel beat_patterns: 4 templates`

- [ ] **Step 3: Commit**

```bash
git add config/genres/cool_novel.yaml
git commit -m "feat(genres): author cool_novel beat_patterns (4 templates)"
```

---

## Task 3: Author `xianxia.yaml` beat_patterns

**Files:**
- Modify: `config/genres/xianxia.yaml`

Same shape as Task 2. 5 templates per spec.

- [ ] **Step 1: Insert beat_patterns block**

Open `config/genres/xianxia.yaml`. After the closing of `trope_patterns:` (after `因果了结`) and BEFORE `thresholds:`, insert:

```yaml
beat_patterns:
  - keywords: [境界突破, 突破, 飞升, 晋升]
    priority: 85
    beats:
      - { description: "境界壁垒感知：修士意识到瓶颈与契机",             words: 500, focus: "sensory" }
      - { description: "闭关修炼：灵气运转、功法运转、心境磨练",           words: 1000, focus: "action" }
      - { description: "突破瞬间：天地异象、力量升华、旁人震惊",           words: 900, focus: "reveal" }
      - { description: "新境界感知：感官扩展、神识变化、寿命延长",         words: 600, focus: "emotion" }
  - keywords: [宗门大比, 比武, 擂台, 论道, 选拔]
    priority: 75
    beats:
      - { description: "赛前氛围：规则宣布、对手出场、赌注/奖励",          words: 500, focus: "sensory" }
      - { description: "前期对战：试探性交锋、展示修为底蕴",               words: 800, focus: "action" }
      - { description: "核心对战：功法对抗、术法克制、险象环生",           words: 1000, focus: "action" }
      - { description: "胜负揭晓：底牌对决、意外变故",                     words: 700, focus: "reveal" }
      - { description: "赛后余波：名次确定、新的挑战预告",                 words: 400, focus: "emotion" }
  - keywords: [秘境, 遗迹, 上古, 仙府, 探索]
    priority: 70
    beats:
      - { description: "秘境入口：危险预兆、历史背景暗示",                 words: 500, focus: "sensory" }
      - { description: "探索与危机：禁制、守护兽、阵法",                   words: 1000, focus: "action" }
      - { description: "核心发现：传承/法宝/秘密出现",                     words: 800, focus: "reveal" }
      - { description: "收获与离开：获得机缘、脱险、伏笔",                 words: 500, focus: "emotion" }
  - keywords: [因果, 了结, 恩怨, 前世, 清算]
    priority: 80
    beats:
      - { description: "因果浮现：前世/宿怨线索激活",                     words: 600, focus: "suspense" }
      - { description: "清算过程：双方对峙、陈年往事揭示",                 words: 900, focus: "dialogue" }
      - { description: "了断结局：恩怨归零、新关系建立",                   words: 600, focus: "emotion" }
  - keywords: [天劫, 渡劫, 心魔, 大劫]
    priority: 95
    beats:
      - { description: "劫云汇聚：天地异变、劫雷酝酿",                     words: 600, focus: "sensory" }
      - { description: "渡劫过程：法力对抗、身躯淬炼、心境考验",           words: 1200, focus: "action" }
      - { description: "心魔降临：执念显化、内心抉择",                     words: 800, focus: "dialogue" }
      - { description: "渡劫成功/失败：飞升/陨落、天地回应",               words: 600, focus: "reveal" }
```

- [ ] **Step 2: Verify catalog loads**

Run:
```bash
./venv/bin/python -c "from backend.genres.catalog import get_catalog; c = get_catalog(); entry = c.get('xianxia'); assert len(entry['beat_patterns']) == 5; print(f'xianxia beat_patterns: {len(entry[\"beat_patterns\"])} templates')"
```

Expected output: `xianxia beat_patterns: 5 templates`

- [ ] **Step 3: Commit**

```bash
git add config/genres/xianxia.yaml
git commit -m "feat(genres): author xianxia beat_patterns (5 templates)"
```

---

## Task 4: Author `xuanhuan.yaml` beat_patterns

**Files:**
- Modify: `config/genres/xuanhuan.yaml`

- [ ] **Step 1: Insert beat_patterns block**

Open `config/genres/xuanhuan.yaml`. After `trope_patterns:` (after `位面战争`) and BEFORE `thresholds:`, insert:

```yaml
beat_patterns:
  - keywords: [血脉觉醒, 觉醒, 血脉, 传承]
    priority: 85
    beats:
      - { description: "异象显现：天地灵气异动、纹路浮现",                words: 500, focus: "sensory" }
      - { description: "觉醒过程：血脉共鸣、力量灌体、记忆闪现",          words: 1000, focus: "action" }
      - { description: "觉醒完成：血脉能力具象、旁人震惊",                words: 800, focus: "reveal" }
      - { description: "后续影响：身份重估、势力拉拢",                    words: 600, focus: "emotion" }
  - keywords: [遗迹, 遗迹探索, 宝藏, 古迹]
    priority: 70
    beats:
      - { description: "遗迹入口：环境描写、历史背景",                    words: 500, focus: "sensory" }
      - { description: "探索过程：机关陷阱、守护兽",                     words: 1000, focus: "action" }
      - { description: "核心传承：功法/神器/血脉获得",                    words: 800, focus: "reveal" }
      - { description: "脱险撤离：伏笔埋设、新目标",                     words: 500, focus: "emotion" }
  - keywords: [大陆争霸, 争霸, 领土, 势力争夺]
    priority: 65
    beats:
      - { description: "势力格局：多方势力、利益冲突",                    words: 500, focus: "dialogue" }
      - { description: "策略博弈：外交、军事、资源争夺",                  words: 900, focus: "action" }
      - { description: "决战时刻：势力对决、领土易主",                    words: 800, focus: "reveal" }
  - keywords: [位面战争, 位面, 跨界, 异位面]
    priority: 90
    beats:
      - { description: "危机降临：异位面入侵预警、空间裂缝",              words: 600, focus: "sensory" }
      - { description: "位面对峙：跨位面战争、规则碰撞",                  words: 1000, focus: "action" }
      - { description: "战略转折：发现弱点、反攻契机",                    words: 800, focus: "reveal" }
      - { description: "战争结局：位面格局重塑、新秩序",                  words: 600, focus: "emotion" }
  - keywords: [魔兽, 神兽, 契约, 签订契约]
    priority: 60
    beats:
      - { description: "魔兽现身：威压释放、众人反应",                    words: 500, focus: "sensory" }
      - { description: "契约谈判：考验过程、灵魂共鸣",                    words: 900, focus: "dialogue" }
      - { description: "契约达成：魔兽认主、战斗配合",                    words: 700, focus: "reveal" }
```

- [ ] **Step 2: Verify catalog loads**

Run:
```bash
./venv/bin/python -c "from backend.genres.catalog import get_catalog; c = get_catalog(); entry = c.get('xuanhuan'); assert len(entry['beat_patterns']) == 5; print(f'xuanhuan beat_patterns: {len(entry[\"beat_patterns\"])} templates')"
```

Expected output: `xuanhuan beat_patterns: 5 templates`

- [ ] **Step 3: Commit**

```bash
git add config/genres/xuanhuan.yaml
git commit -m "feat(genres): author xuanhuan beat_patterns (5 templates)"
```

---

## Task 5: Author `dushi.yaml` beat_patterns

**Files:**
- Modify: `config/genres/dushi.yaml`

- [ ] **Step 1: Insert beat_patterns block**

Open `config/genres/dushi.yaml`. After `trope_patterns:` (after `社会事件`) and BEFORE `thresholds:`, insert:

```yaml
beat_patterns:
  - keywords: [商业, 博弈, 商战, 谈判, 收购]
    priority: 85
    beats:
      - { description: "利益格局：各方势力、行业背景",                    words: 500, focus: "dialogue" }
      - { description: "策略布局：信息战、资源整合",                      words: 900, focus: "action" }
      - { description: "关键对决：商业谈判/法庭/发布会",                  words: 1000, focus: "action" }
      - { description: "胜负揭晓：对手溃败/反转、格局重塑",               words: 600, focus: "reveal" }
  - keywords: [身份反转, 真实身份, 身份暴露, 隐藏身份]
    priority: 80
    beats:
      - { description: "伏笔铺垫：身份线索散落前文",                       words: 500, focus: "suspense" }
      - { description: "揭露瞬间：所有人反应、关系重构",                  words: 800, focus: "reveal" }
      - { description: "新格局展开：资源/盟友/敌人重新分配",              words: 600, focus: "emotion" }
  - keywords: [职场, 升职, 跳槽, 同事, 老板]
    priority: 70
    beats:
      - { description: "职场困境：被排挤/背锅/边缘化",                    words: 500, focus: "sensory" }
      - { description: "破局行动：主动出击/借力/反制",                    words: 800, focus: "action" }
      - { description: "结果兑现：晋升/跳槽/逆袭",                        words: 600, focus: "emotion" }
  - keywords: [现实, 社会事件, 热点, 突发事件]
    priority: 60
    beats:
      - { description: "事件背景：社会环境、人物关系",                    words: 500, focus: "dialogue" }
      - { description: "事件发展：人物卷入、利益权衡",                    words: 800, focus: "action" }
      - { description: "事件影响：人物成长、关系变化",                    words: 600, focus: "emotion" }
```

- [ ] **Step 2: Verify catalog loads**

Run:
```bash
./venv/bin/python -c "from backend.genres.catalog import get_catalog; c = get_catalog(); entry = c.get('dushi'); assert len(entry['beat_patterns']) == 4; print(f'dushi beat_patterns: {len(entry[\"beat_patterns\"])} templates')"
```

Expected output: `dushi beat_patterns: 4 templates`

- [ ] **Step 3: Commit**

```bash
git add config/genres/dushi.yaml
git commit -m "feat(genres): author dushi beat_patterns (4 templates)"
```

---

## Task 6: Author `kehuan.yaml` beat_patterns

**Files:**
- Modify: `config/genres/kehuan.yaml`

- [ ] **Step 1: Insert beat_patterns block**

Open `config/genres/kehuan.yaml`. After `trope_patterns:` (after `文明抉择`) and BEFORE `thresholds:`, insert:

```yaml
beat_patterns:
  - keywords: [技术突破, 突破, 攻关, 发明]
    priority: 75
    beats:
      - { description: "问题浮现：技术瓶颈、社会需求",                    words: 500, focus: "dialogue" }
      - { description: "攻关过程：理论推演、实验失败、迭代",              words: 1000, focus: "action" }
      - { description: "突破瞬间：核心原理揭示、实验成功",                words: 800, focus: "reveal" }
      - { description: "技术影响：产业变革、社会震荡",                    words: 600, focus: "emotion" }
  - keywords: [首次接触, 外星, 异种, 接触]
    priority: 90
    beats:
      - { description: "信号发现：异常现象、科学探测",                    words: 600, focus: "sensory" }
      - { description: "接触准备：内部博弈、伦理争议",                    words: 800, focus: "dialogue" }
      - { description: "正式接触：沟通尝试、文化碰撞",                    words: 1000, focus: "action" }
      - { description: "接触后果：人类认知颠覆、新格局",                  words: 600, focus: "reveal" }
  - keywords: [伦理, 困境, 道德, 两难]
    priority: 80
    beats:
      - { description: "伦理浮现：技术应用的两难抉择",                    words: 500, focus: "dialogue" }
      - { description: "多方博弈：科学家/政客/公众立场",                  words: 800, focus: "dialogue" }
      - { description: "抉择时刻：主角的关键决定",                        words: 700, focus: "action" }
      - { description: "后果承担：决定的影响、长期回响",                  words: 500, focus: "emotion" }
  - keywords: [系统危机, 故障, 失控, 连锁]
    priority: 85
    beats:
      - { description: "异常苗头：系统警告、异常数据",                    words: 500, focus: "sensory" }
      - { description: "危机升级：连锁反应、规模扩大",                    words: 900, focus: "action" }
      - { description: "危机解除：临时方案、根本修复",                    words: 700, focus: "reveal" }
  - keywords: [文明, 抉择, 命运, 根本]
    priority: 95
    beats:
      - { description: "危机规模：文明存亡的威胁",                        words: 600, focus: "sensory" }
      - { description: "方案辩论：多条路径的利弊",                        words: 900, focus: "dialogue" }
      - { description: "终极抉择：牺牲与获得的权衡",                      words: 800, focus: "action" }
      - { description: "新文明起点：执行后的世界格局",                    words: 600, focus: "emotion" }
```

- [ ] **Step 2: Verify catalog loads**

Run:
```bash
./venv/bin/python -c "from backend.genres.catalog import get_catalog; c = get_catalog(); entry = c.get('kehuan'); assert len(entry['beat_patterns']) == 5; print(f'kehuan beat_patterns: {len(entry[\"beat_patterns\"])} templates')"
```

Expected output: `kehuan beat_patterns: 5 templates`

- [ ] **Step 3: Commit**

```bash
git add config/genres/kehuan.yaml
git commit -m "feat(genres): author kehuan beat_patterns (5 templates)"
```

---

## Task 7: Author `xuanyi.yaml` beat_patterns

**Files:**
- Modify: `config/genres/xuanyi.yaml`

- [ ] **Step 1: Insert beat_patterns block**

Open `config/genres/xuanyi.yaml`. After `trope_patterns:` (after `终极对决`) and BEFORE `thresholds:`, insert:

```yaml
beat_patterns:
  - keywords: [线索, 发现, 证据, 物证, 发现线索]
    priority: 85
    beats:
      - { description: "线索埋设：日常场景中的异常细节",                  words: 500, focus: "sensory" }
      - { description: "主角发现：推理过程+逻辑链",                        words: 800, focus: "dialogue" }
      - { description: "线索价值评估：对剧情的推进意义",                  words: 400, focus: "suspense" }
  - keywords: [嫌疑人, 反转, 排除, 新嫌疑人]
    priority: 80
    beats:
      - { description: "原嫌疑人的嫌疑松动",                              words: 500, focus: "suspense" }
      - { description: "新线索指向新嫌疑人",                              words: 700, focus: "action" }
      - { description: "推理链更新：排除/确认",                           words: 600, focus: "dialogue" }
  - keywords: [个人危机, 危险, 陷入, 目标]
    priority: 70
    beats:
      - { description: "危机逼近：环境/时间/敌人压力",                    words: 500, focus: "suspense" }
      - { description: "主角应对：有限资源下的选择",                      words: 800, focus: "action" }
      - { description: "脱险/反制：利用线索或盟友",                       words: 600, focus: "reveal" }
  - keywords: [大反转, 真相, 颠覆, 推翻]
    priority: 95
    beats:
      - { description: "伏笔回收：之前章节的细节全部指向新结论",          words: 800, focus: "reveal" }
      - { description: "推理链重构：之前的错误推理被推翻",                words: 1000, focus: "dialogue" }
      - { description: "真相的冲击：人物动机/关系重新理解",               words: 600, focus: "emotion" }
  - keywords: [终极对决, 终局, 幕后, 决战]
    priority: 90
    beats:
      - { description: "对决前奏：双方准备、心理博弈",                    words: 600, focus: "dialogue" }
      - { description: "智力/武力对决：策略与反策略",                     words: 1000, focus: "action" }
      - { description: "终局揭晓：真相落地、伏笔全部回收",                words: 700, focus: "reveal" }
```

- [ ] **Step 2: Verify catalog loads**

Run:
```bash
./venv/bin/python -c "from backend.genres.catalog import get_catalog; c = get_catalog(); entry = c.get('xuanyi'); assert len(entry['beat_patterns']) == 5; print(f'xuanyi beat_patterns: {len(entry[\"beat_patterns\"])} templates')"
```

Expected output: `xuanyi beat_patterns: 5 templates`

- [ ] **Step 3: Commit**

```bash
git add config/genres/xuanyi.yaml
git commit -m "feat(genres): author xuanyi beat_patterns (5 templates)"
```

---

## Task 8: Author `yanqing.yaml` beat_patterns

**Files:**
- Modify: `config/genres/yanqing.yaml`

- [ ] **Step 1: Insert beat_patterns block**

Open `config/genres/yanqing.yaml`. After `trope_patterns:` (after `外力阻挠`) and BEFORE `thresholds:`, insert:

```yaml
beat_patterns:
  - keywords: [误会, 误解, 矛盾, 和解]
    priority: 70
    beats:
      - { description: "误会形成：信息差导致的认知偏差",                  words: 500, focus: "dialogue" }
      - { description: "误会加深：行为冲突、关系紧张",                    words: 700, focus: "emotion" }
      - { description: "化解过程：坦诚、第三方调停、真相揭示",            words: 700, focus: "reveal" }
  - keywords: [关系升级, 暧昧, 告白, 确认关系]
    priority: 85
    beats:
      - { description: "情感铺垫：日常相处、细节积累",                    words: 600, focus: "sensory" }
      - { description: "情感升温：关键时刻、试探",                        words: 700, focus: "dialogue" }
      - { description: "关系确认：告白/接受/确立",                        words: 600, focus: "reveal" }
      - { description: "新关系磨合：身份转换、规则建立",                  words: 500, focus: "emotion" }
  - keywords: [第三者, 情敌, 介入, 三角]
    priority: 65
    beats:
      - { description: "第三者登场：动机背景、人物魅力",                  words: 500, focus: "sensory" }
      - { description: "冲突显化：争夺、试探、紧张",                      words: 700, focus: "dialogue" }
      - { description: "关系考验：主角的选择、第三者退场",                words: 600, focus: "emotion" }
  - keywords: [外力阻挠, 家庭, 反对, 命运]
    priority: 75
    beats:
      - { description: "阻挠来源：家庭/社会/命运的压力",                  words: 500, focus: "dialogue" }
      - { description: "压力升级：威胁、限制、分离",                      words: 700, focus: "action" }
      - { description: "突破阻挠：坚持、牺牲、新平衡",                    words: 600, focus: "reveal" }
  - keywords: [情感转折, 真相, 揭示, 动摇]
    priority: 80
    beats:
      - { description: "真相浮现：过去的秘密或误会被发现",                words: 600, focus: "suspense" }
      - { description: "情感冲击：信任/信念动摇",                         words: 700, focus: "emotion" }
      - { description: "重新抉择：是去是留、新关系建立",                  words: 600, focus: "dialogue" }
```

- [ ] **Step 2: Verify catalog loads**

Run:
```bash
./venv/bin/python -c "from backend.genres.catalog import get_catalog; c = get_catalog(); entry = c.get('yanqing'); assert len(entry['beat_patterns']) == 5; print(f'yanqing beat_patterns: {len(entry[\"beat_patterns\"])} templates')"
```

Expected output: `yanqing beat_patterns: 5 templates`

- [ ] **Step 3: Commit**

```bash
git add config/genres/yanqing.yaml
git commit -m "feat(genres): author yanqing beat_patterns (5 templates)"
```

---

## Task 9: Catalog schema validation (TDD)

**Files:**
- Modify: `backend/genres/catalog.py` (add `"beat_patterns"` to `_REQUIRED_GENRE_FIELDS` + new `_validate_beat_patterns` method + call it from `_load_entries`)
- Modify: `tests/test_genre_beat_patterns.py` (add `TestSchemaValidation` class with 4 tests)

Now that all 7 genre YAMLs have `beat_patterns` (Tasks 2-8), make it required and add shape validation. Use `tmp_path` fixture pattern to test loader errors in isolation — the existing `GenreCatalog.__init__` accepts a custom `genres_dir` (see `catalog.py:36-39`).

- [ ] **Step 1: Write 4 failing tests**

Append to `tests/test_genre_beat_patterns.py` (after `TestFocusVocabulary`):

```python
class TestSchemaValidation:
    """Catalog must reject malformed beat_patterns at load time."""

    def _write_genre_yaml(self, tmp_path, genre_id, beat_patterns_block):
        """Helper: write a minimal valid genre YAML into tmp_path."""
        import yaml
        (tmp_path / "index.yaml").write_text(
            yaml.safe_dump({"genres": [{"id": genre_id, "label_zh": "测试", "label_en": "Test", "family": "test"}]}, allow_unicode=True),
            encoding="utf-8",
        )
        (tmp_path / "compatibility.yaml").write_text(
            yaml.safe_dump({"matrix": {genre_id: {}}}, allow_unicode=True),
            encoding="utf-8",
        )
        (tmp_path / "families.yaml").write_text(
            yaml.safe_dump({"families": {"test": [genre_id]}}, allow_unicode=True),
            encoding="utf-8",
        )
        # All required fields EXCEPT beat_patterns — we'll inject beat_patterns separately.
        valid_entry = {
            "id": genre_id, "label_zh": "测试", "label_en": "Test", "family": "test",
            "pacing": {"min_beats_per_1k": 1.0, "escalation_interval": 5, "action_ratio": 0.3,
                       "max_consecutive_non_action": 3, "chapter_words": {"min": 2000, "max": 5000},
                       "scene_words": {"min": 400, "max": 1800}},
            "tone": "测试",
            "style_rules": ["rule1"],
            "writing_formula": {"sentence": {}, "dialogue": {}, "paragraph": {}},
            "taboo_words": [],
            "taboos": [],
            "trope_patterns": [],
            "thresholds": {},
            "model_preferences": {"creative_core": "deepseek-chat", "temperature": 0.8},
            "fusion_meta": {"distances": {}},  # Will fail distance validation, but beat_patterns is checked first
        }
        valid_entry["beat_patterns"] = beat_patterns_block
        (tmp_path / f"{genre_id}.yaml").write_text(
            yaml.safe_dump(valid_entry, allow_unicode=True),
            encoding="utf-8",
        )

    def test_all_7_genres_have_beat_patterns_field(self):
        """The production catalog loads with all 7 genres declaring beat_patterns."""
        from backend.genres.catalog import get_catalog
        catalog = get_catalog()
        for gid in ("cool_novel", "xianxia", "xuanhuan", "dushi", "kehuan", "xuanyi", "yanqing"):
            entry = catalog.get(gid)
            assert "beat_patterns" in entry, f"{gid} missing beat_patterns"
            assert isinstance(entry["beat_patterns"], list)
            assert len(entry["beat_patterns"]) >= 1

    def test_beat_pattern_with_empty_keywords_raises_on_load(self, tmp_path):
        """A beat_pattern with keywords=[] is invalid."""
        from backend.genres.catalog import GenreCatalog, CatalogLoadError
        self._write_genre_yaml(tmp_path, "test_genre", [
            {"keywords": [], "priority": 80, "beats": [{"description": "x", "words": 100, "focus": "sensory"}]}
        ])
        with pytest.raises(CatalogLoadError, match="beat_patterns invalid"):
            GenreCatalog(genres_dir=tmp_path).get("test_genre")

    def test_beat_with_unknown_focus_raises_on_load(self, tmp_path):
        """A beat with focus='random_word' (not in vocabulary) is invalid."""
        from backend.genres.catalog import GenreCatalog, CatalogLoadError
        self._write_genre_yaml(tmp_path, "test_genre", [
            {"keywords": ["测试"], "priority": 80, "beats": [{"description": "x", "words": 100, "focus": "random_word"}]}
        ])
        with pytest.raises(CatalogLoadError, match="beat_patterns invalid"):
            GenreCatalog(genres_dir=tmp_path).get("test_genre")

    def test_beat_with_single_char_keyword_raises_on_load(self, tmp_path):
        """A keyword of length 1 (e.g., '脸') is too noisy — min 2 chars required."""
        from backend.genres.catalog import GenreCatalog, CatalogLoadError
        self._write_genre_yaml(tmp_path, "test_genre", [
            {"keywords": ["脸"], "priority": 80, "beats": [{"description": "x", "words": 100, "focus": "sensory"}]}
        ])
        with pytest.raises(CatalogLoadError, match="beat_patterns invalid"):
            GenreCatalog(genres_dir=tmp_path).get("test_genre")
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
./venv/bin/python -m pytest tests/test_genre_beat_patterns.py::TestSchemaValidation -v
```

Expected: All 4 tests fail (or first one passes — see Step 3 implementation note).

- [ ] **Step 3: Implement `_validate_beat_patterns` + update REQUIRED fields**

In `backend/genres/catalog.py`, make 3 changes:

**Change 1**: Add `"beat_patterns"` to `_REQUIRED_GENRE_FIELDS` (line 25-30). Update the tuple:

```python
_REQUIRED_GENRE_FIELDS = (
    "id", "label_zh", "label_en", "family",
    "pacing", "tone", "style_rules", "writing_formula",
    "taboo_words", "taboos", "trope_patterns",
    "beat_patterns",  # NEW: required for Stage 3 outline generation prompts
    "thresholds", "model_preferences", "fusion_meta",
)
```

**Change 2**: In `_load_entries()` (line 64-83), after the `if data["id"] != gid:` check (line 81), add a call to validation:

```python
            if data["id"] != gid:
                raise CatalogLoadError(
                    f"config/genres/{gid}.yaml has id='{data['id']}' (mismatch)"
                )
            self._validate_beat_patterns(gid, data)  # NEW
            self._entries[gid] = data
```

**Change 3**: Add the new method. Place it after `_load_entries` (after line 83) and before `_load_compatibility` (line 85). The method reads the focus vocabulary YAML to validate `focus` values, so it must be importable as a separate concept:

```python
    def _validate_beat_patterns(self, gid: str, entry: dict) -> None:
        """Validate the shape of `beat_patterns` for a single genre entry.

        Rules (per spec 2026-07-29):
          - beat_patterns must be a non-empty list
          - Each template must have:
            - keywords: non-empty list of strings, each ≥2 chars
            - priority: int in [0, 100]
            - beats: non-empty list of dicts
          - Each beat must have:
            - description: non-empty string
            - words: int > 0
            - focus: str ∈ focus vocabulary (config/genre_focus_vocabulary.yaml)
        """
        import yaml
        focus_vocab_path = self._dir.parent / "genre_focus_vocabulary.yaml"
        if focus_vocab_path.is_file():
            vocab = (yaml.safe_load(focus_vocab_path.read_text(encoding="utf-8")) or {}).get("focus_legend") or {}
            valid_focuses = set(vocab.keys())
        else:
            valid_focuses = set()  # If vocab file missing, validation will reject all focus values

        patterns = entry.get("beat_patterns")
        if not isinstance(patterns, list) or len(patterns) == 0:
            raise CatalogLoadError(
                f"config/genres/{gid}.yaml beat_patterns invalid: must be a non-empty list"
            )

        for i, tmpl in enumerate(patterns):
            if not isinstance(tmpl, dict):
                raise CatalogLoadError(
                    f"config/genres/{gid}.yaml beat_patterns[{i}] invalid: must be a dict"
                )
            keywords = tmpl.get("keywords")
            if not isinstance(keywords, list) or len(keywords) == 0:
                raise CatalogLoadError(
                    f"config/genres/{gid}.yaml beat_patterns[{i}].keywords invalid: must be non-empty list"
                )
            for k_idx, kw in enumerate(keywords):
                if not isinstance(kw, str) or len(kw) < 2:
                    raise CatalogLoadError(
                        f"config/genres/{gid}.yaml beat_patterns[{i}].keywords[{k_idx}] invalid: must be string ≥2 chars, got {kw!r}"
                    )

            priority = tmpl.get("priority")
            if not isinstance(priority, int) or not (0 <= priority <= 100):
                raise CatalogLoadError(
                    f"config/genres/{gid}.yaml beat_patterns[{i}].priority invalid: must be int in [0,100], got {priority!r}"
                )

            beats = tmpl.get("beats")
            if not isinstance(beats, list) or len(beats) == 0:
                raise CatalogLoadError(
                    f"config/genres/{gid}.yaml beat_patterns[{i}].beats invalid: must be non-empty list"
                )
            for b_idx, beat in enumerate(beats):
                if not isinstance(beat, dict):
                    raise CatalogLoadError(
                        f"config/genres/{gid}.yaml beat_patterns[{i}].beats[{b_idx}] invalid: must be a dict"
                    )
                desc = beat.get("description")
                if not isinstance(desc, str) or not desc.strip():
                    raise CatalogLoadError(
                        f"config/genres/{gid}.yaml beat_patterns[{i}].beats[{b_idx}].description invalid: must be non-empty string"
                    )
                words = beat.get("words")
                if not isinstance(words, int) or words <= 0:
                    raise CatalogLoadError(
                        f"config/genres/{gid}.yaml beat_patterns[{i}].beats[{b_idx}].words invalid: must be int > 0"
                    )
                focus = beat.get("focus")
                if not isinstance(focus, str) or focus not in valid_focuses:
                    raise CatalogLoadError(
                        f"config/genres/{gid}.yaml beat_patterns[{i}].beats[{b_idx}].focus invalid: must be in {sorted(valid_focuses)}, got {focus!r}"
                    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
./venv/bin/python -m pytest tests/test_genre_beat_patterns.py::TestSchemaValidation -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/genres/catalog.py tests/test_genre_beat_patterns.py
git commit -m "feat(genres): require and validate beat_patterns in catalog"
```

---

## Task 10: Implement `_resolve_genre_beat_patterns` helper (TDD)

**Files:**
- Modify: `backend/agents/planner.py` (add helper near `_resolve_genre_extras`)
- Modify: `tests/test_genre_beat_patterns.py` (add `TestKeywordMatching` class with 4 tests)

The helper takes a genre id and optional outline text, returns a formatted multi-line string (including the leading `【题材节拍模板】` section header), or empty string if no templates match. Empty outline text returns all templates (priority sorted).

- [ ] **Step 1: Write 4 failing tests**

Append to `tests/test_genre_beat_patterns.py`:

```python
class TestKeywordMatching:
    """_resolve_genre_beat_patterns filters templates by outline keywords."""

    def test_substring_match_returns_matching_template_only(self):
        """outline_text='主角打脸反派' → only the 打脸 template appears."""
        from backend.agents.planner import _resolve_genre_beat_patterns
        result = _resolve_genre_beat_patterns("cool_novel", "主角打脸反派")
        assert "【题材节拍模板】" in result
        assert "打脸" in result
        # The cool_novel 突破 template should NOT appear (no 突破 keyword in outline)
        assert "升级契机" not in result

    def test_multiple_keyword_match_sorts_by_priority_desc(self):
        """outline containing both '打脸' and '突破' keywords → 2 templates, priority desc."""
        from backend.agents.planner import _resolve_genre_beat_patterns
        result = _resolve_genre_beat_patterns("cool_novel", "打脸突破升级")
        # 打脸 is priority 90, 突破 is priority 70; 打脸 should appear first
        idx_face = result.find("打脸")
        idx_break = result.find("升级契机")
        assert idx_face != -1 and idx_break != -1
        assert idx_face < idx_break

    def test_empty_outline_returns_all_templates_unfiltered(self):
        """outline_text='' → all templates returned, sorted by priority desc."""
        from backend.agents.planner import _resolve_genre_beat_patterns
        result = _resolve_genre_beat_patterns("cool_novel", "")
        # cool_novel has 4 templates; all keywords should appear
        assert "打脸" in result
        assert "越级" in result
        assert "突破" in result
        assert "身份" in result

    def test_no_keyword_match_returns_empty_string(self):
        """outline_text with no matching keywords → empty string (no section header)."""
        from backend.agents.planner import _resolve_genre_beat_patterns
        # '天气预报' has no overlap with cool_novel's keywords
        result = _resolve_genre_beat_patterns("cool_novel", "今天的天气预报说明天有雨")
        assert result == ""
        assert "【题材节拍模板】" not in result
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
./venv/bin/python -m pytest tests/test_genre_beat_patterns.py::TestKeywordMatching -v
```

Expected: All 4 tests fail with `ImportError`.

- [ ] **Step 3: Implement `_resolve_genre_beat_patterns`**

Add to `backend/agents/planner.py`, directly after `_resolve_genre_focus_vocabulary` (the helper added in Task 1):

```python
def _resolve_genre_beat_patterns(
    genre: str,
    outline_text: Optional[str] = "",
) -> str:
    """Return keyword-matched beat templates as a formatted multi-line string,
    INCLUDING the leading 【题材节拍模板】 section header.

    For the given genre, read `beat_patterns` from catalog. If `outline_text`
    is non-empty (and not None), keep only templates where at least one
    keyword is a substring of outline_text. Sort by priority desc.

    Render shape (whole section, including header):
      【题材节拍模板】（按优先级排序；仅显示与当前大纲关键词匹配的模板）
      1. keywords=[打脸, 装逼, ...] priority=90
         - 铺垫：对手嚣张/轻视/嘲讽主角 (500 字, focus: dialogue)
         - 交锋：... (700 字, focus: action)
         ...
      2. keywords=[突破, 升级, ...] priority=70
         ...

    If no templates match (after filtering), return empty string. The whole
    section disappears from the rendered prompt — no blank header.

    outline_text=None is normalized to "" (defensive: substring match would
    TypeError on None).
    """
    outline = (outline_text or "")
    if not outline:
        filter_active = False
    else:
        filter_active = True

    try:
        from backend.genres.catalog import get_catalog
        entry = get_catalog().get(genre)
    except Exception:
        return ""

    patterns = entry.get("beat_patterns") or []
    if not patterns:
        return ""

    if filter_active:
        matched = [
            tmpl for tmpl in patterns
            if any(kw in outline for kw in tmpl.get("keywords", []))
        ]
    else:
        matched = list(patterns)

    if not matched:
        return ""

    # Sort by priority desc; stable on tie
    matched = sorted(matched, key=lambda t: -t.get("priority", 0))

    lines = ["【题材节拍模板】（按优先级排序；仅显示与当前大纲关键词匹配的模板）"]
    for i, tmpl in enumerate(matched, start=1):
        keywords_str = ", ".join(tmpl.get("keywords", []))
        priority = tmpl.get("priority", 0)
        lines.append(f"{i}. keywords=[{keywords_str}] priority={priority}")
        for beat in tmpl.get("beats", []):
            desc = beat.get("description", "")
            words = beat.get("words", 0)
            focus = beat.get("focus", "")
            lines.append(f"   - {desc} ({words} 字, focus: {focus})")
    return "\n".join(lines)
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
./venv/bin/python -m pytest tests/test_genre_beat_patterns.py::TestKeywordMatching -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/planner.py tests/test_genre_beat_patterns.py
git commit -m "feat(genres): add _resolve_genre_beat_patterns keyword-matching helper"
```

---

## Task 11: Wire into `generate_novel_outline` (TDD)

**Files:**
- Modify: `backend/agents/planner.py` (add `outline_text` parameter to `generate_novel_outline` and pass 2 new helper outputs to the template)
- Modify: `tests/test_genre_beat_patterns.py` (add 2 tests in `TestPromptWiring`)

This task wires the helpers into `generate_novel_outline`. The new `outline_text` parameter has default `""` so existing call sites continue to work.

- [ ] **Step 1: Write 2 failing tests**

Append to `tests/test_genre_beat_patterns.py`:

```python
class TestPromptWiring:
    """Verify beat_patterns + focus_vocabulary reach the outline prompt."""

    @pytest.mark.asyncio
    async def test_novel_outline_prompt_contains_beat_patterns_section(self):
        """generate_novel_outline with outline_text='打脸' → prompt contains the section."""
        from backend.agents.planner import PlannerAgent

        captured = {}

        async def fake_tier(self, task_name, system_prompt, user_prompt, **kwargs):
            captured["user"] = user_prompt
            return {"volumes": []}, _mock_response()

        planner = PlannerAgent(project_id="test")
        with patch.object(PlannerAgent, "generate_with_tier", new=fake_tier):
            await planner.generate_novel_outline(
                concept={"title": "测试", "premise": "x", "tone": "x", "theme": "x"},
                story_dna={"core_contradiction": {"statement": "x"}},
                world={"era": "x", "power_system": {"name": "x", "core_rules": []}, "core_rules": []},
                characters=[],
                target_total_words=1_000_000,
                min_words=2000,
                outline_text="主角在擂台上打脸反派，震惊全场",
            )

        rendered = captured["user"]
        assert "【题材节拍模板】" in rendered
        assert "打脸" in rendered
        assert "【focus 字段图例】" in rendered
        assert "sensory" in rendered

    @pytest.mark.asyncio
    async def test_novel_outline_prompt_omits_beat_section_when_no_match(self):
        """generate_novel_outline with no-keyword outline → no beat section, but vocab still appears."""
        from backend.agents.planner import PlannerAgent

        captured = {}

        async def fake_tier(self, task_name, system_prompt, user_prompt, **kwargs):
            captured["user"] = user_prompt
            return {"volumes": []}, _mock_response()

        planner = PlannerAgent(project_id="test")
        with patch.object(PlannerAgent, "generate_with_tier", new=fake_tier):
            await planner.generate_novel_outline(
                concept={"title": "测试", "premise": "x", "tone": "x", "theme": "x"},
                story_dna={"core_contradiction": {"statement": "x"}},
                world={"era": "x", "power_system": {"name": "x", "core_rules": []}, "core_rules": []},
                characters=[],
                target_total_words=1_000_000,
                min_words=2000,
                outline_text="今天的天气预报说明天有雨",  # no matching keywords
            )

        rendered = captured["user"]
        assert "【题材节拍模板】" not in rendered  # section disappears entirely
        assert "【focus 字段图例】" in rendered  # vocab always present


def _mock_response():
    """Real LLMResponse dataclass — log_usage JSON-serializes its fields."""
    from backend.llm.base_provider import LLMResponse
    return LLMResponse(
        text="", tokens_in=0, tokens_out=0,
        model="test", provider="test", finish_reason="stop",
    )
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
./venv/bin/python -m pytest tests/test_genre_beat_patterns.py::TestPromptWiring -v
```

Expected: 2 tests fail (the `outline_text` kwarg is rejected by the current signature).

- [ ] **Step 3: Modify `generate_novel_outline` to accept `outline_text` and pass 2 helpers**

In `backend/agents/planner.py`, modify the `generate_novel_outline` method (around line 340). Add `outline_text: str = ""` to the signature and add the two helper calls before `generate_from_template`:

Find the existing signature:
```python
    async def generate_novel_outline(
        self,
        concept: dict,
        story_dna: dict,
        world: dict,
        characters: list[dict],
        target_total_words: int = 1_000_000,
        min_words: int = 2000,
        map_data: Optional[dict] = None,
    ) -> tuple[dict, LLMResponse]:
```

Replace with:
```python
    async def generate_novel_outline(
        self,
        concept: dict,
        story_dna: dict,
        world: dict,
        characters: list[dict],
        target_total_words: int = 1_000_000,
        min_words: int = 2000,
        map_data: Optional[dict] = None,
        outline_text: str = "",
    ) -> tuple[dict, LLMResponse]:
```

Find the `generate_from_template("novel_outline_generation", ...)` call (after `length_category = length_category_for(target_total_words)`). It currently has kwargs `concept_context`, `story_dna_context`, `world_context`, `characters_context`, `map_context`, `length_category`, `target_total_words`, `min_words`. Add 2 more kwargs. The complete call should be:

```python
        genre = (concept.get("genre") or "cool_novel")  # genre lives on concept per project.json convention; fallback safe
        result, response = await self.generate_from_template(
            "novel_outline_generation",
            concept_context=concept_context,
            story_dna_context=story_dna_context,
            world_context=world_context,
            characters_context=characters_context,
            map_context=map_context,
            length_category=length_category,
            target_total_words=target_total_words,
            min_words=min_words,
            genre_beat_patterns=_resolve_genre_beat_patterns(genre, outline_text),
            genre_focus_vocabulary=_resolve_genre_focus_vocabulary(),
        )
```

Note: `generate_novel_outline` currently does NOT take a `genre` argument. The genre must come from somewhere — the spec is unclear. Two options:
1. Pass `genre` as a new parameter (more explicit; cleaner)
2. Read from `project.json` like `stage2_world_char.py` does

For this task, take option 1 — add `genre: str = "cool_novel"` as a new parameter (default keeps backward compat with any existing callers that don't pass genre). Update the signature:

```python
    async def generate_novel_outline(
        self,
        concept: dict,
        story_dna: dict,
        world: dict,
        characters: list[dict],
        target_total_words: int = 1_000_000,
        min_words: int = 2000,
        map_data: Optional[dict] = None,
        outline_text: str = "",
        genre: str = "cool_novel",  # NEW
    ) -> tuple[dict, LLMResponse]:
```

Then in the body, replace the local `length_category = ...` line to also derive `genre` (it's already a param now), and use it in the new helper calls:

```python
        # Length category is derived from the project's target total, not the
        # per-chapter min_words (all three new options share 2000 字/章).
        length_category = length_category_for(target_total_words)

        # Inject keyword-matched beat templates based on the current outline.
        # First-pass generation has no prior outline → outline_text="" → all templates returned.
        # Incremental regeneration passes the existing outline → only relevant templates returned.
        beat_patterns_str = _resolve_genre_beat_patterns(genre, outline_text)
        focus_vocab_str = _resolve_genre_focus_vocabulary()
```

Then pass them to `generate_from_template` as shown above.

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
./venv/bin/python -m pytest tests/test_genre_beat_patterns.py::TestPromptWiring -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/planner.py tests/test_genre_beat_patterns.py
git commit -m "feat(genres): wire beat_patterns into generate_novel_outline"
```

---

## Task 12: Wire into `generate_outline` (TDD)

**Files:**
- Modify: `backend/agents/planner.py` (add `outline_text` and `genre` parameters to `generate_outline`)
- Modify: `tests/test_genre_beat_patterns.py` (add 1 test in `TestPromptWiring`)

`generate_outline` produces per-chapter outlines. Same wiring pattern as Task 11.

- [ ] **Step 1: Write 1 failing test**

Append to `tests/test_genre_beat_patterns.py` (still in `TestPromptWiring`):

```python
    @pytest.mark.asyncio
    async def test_chapter_outline_prompt_uses_outline_text_for_matching(self):
        """generate_outline with outline_text='打脸场景' → matching template appears."""
        from backend.agents.planner import PlannerAgent

        captured = {}

        async def fake_tier(self, task_name, system_prompt, user_prompt, **kwargs):
            captured["user"] = user_prompt
            return {"scenes": []}, _mock_response()

        planner = PlannerAgent(project_id="test")
        with patch.object(PlannerAgent, "generate_with_tier", new=fake_tier):
            await planner.generate_outline(
                concept={"title": "测试"},
                story_dna={},
                world={},
                character={"name": "x"},
                chapter_number=5,
                min_words=2000,
                outline_text="打脸场景：对手嘲讽主角",
                genre="cool_novel",
            )

        rendered = captured["user"]
        assert "【题材节拍模板】" in rendered
        assert "打脸" in rendered
        assert "【focus 字段图例】" in rendered
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
./venv/bin/python -m pytest tests/test_genre_beat_patterns.py::TestPromptWiring::test_chapter_outline_prompt_uses_outline_text_for_matching -v
```

Expected: FAIL with `TypeError: generate_outline() got an unexpected keyword argument 'outline_text'`.

- [ ] **Step 3: Modify `generate_outline`**

In `backend/agents/planner.py`, find `generate_outline` (around line 282). Update its signature and body.

Original signature:
```python
    async def generate_outline(
        self,
        concept: dict,
        story_dna: dict,
        world: dict,
        character: dict,
        chapter_number: int = 1,
        min_words: int = 4000,
        novel_outline: Optional[dict] = None,
    ) -> tuple[dict, LLMResponse]:
```

Replace with:
```python
    async def generate_outline(
        self,
        concept: dict,
        story_dna: dict,
        world: dict,
        character: dict,
        chapter_number: int = 1,
        min_words: int = 4000,
        novel_outline: Optional[dict] = None,
        outline_text: str = "",
        genre: str = "cool_novel",
    ) -> tuple[dict, LLMResponse]:
```

Find the `generate_from_template("outline_generation", ...)` call. Add the 2 new kwargs. Replace the call:

Original:
```python
        result, response = await self.generate_from_template(
            "outline_generation",
            concept_context=concept_context,
            story_dna_context=story_dna_context,
            world_context=world_context,
            character_context=character_context,
            chapter_number=chapter_number,
            min_words=min_words,
            novel_outline_context=novel_outline_context,
        )
```

Replace with:
```python
        result, response = await self.generate_from_template(
            "outline_generation",
            concept_context=concept_context,
            story_dna_context=story_dna_context,
            world_context=world_context,
            character_context=character_context,
            chapter_number=chapter_number,
            min_words=min_words,
            novel_outline_context=novel_outline_context,
            genre_beat_patterns=_resolve_genre_beat_patterns(genre, outline_text),
            genre_focus_vocabulary=_resolve_genre_focus_vocabulary(),
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
./venv/bin/python -m pytest tests/test_genre_beat_patterns.py::TestPromptWiring -v
```

Expected: All 3 TestPromptWiring tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/planner.py tests/test_genre_beat_patterns.py
git commit -m "feat(genres): wire beat_patterns into generate_outline (per-chapter)"
```

---

## Task 13: Update `novel_outline_generation.yaml` prompt template

**Files:**
- Modify: `backend/prompts/novel_outline_generation.yaml`

The template currently ends with the "请生成" section. Insert the 2 new placeholders just before that section. The helpers return whole sections (header + body) — the template just needs placeholder lines.

- [ ] **Step 1: Locate the insertion point**

Open `backend/prompts/novel_outline_generation.yaml`. The `user_prompt_template:` block is multi-line `|` content. Find the line that reads `请生成"全书大纲"`, which precedes the JSON schema. Insert two new lines immediately BEFORE that line.

- [ ] **Step 2: Insert the placeholders**

Add this exact 2-line block just before the `请生成"全书大纲"`, output严格遵循` line:

```yaml

  {genre_beat_patterns}

  {genre_focus_vocabulary}
```

The blank line before `{genre_beat_patterns}` separates it from the previous block (length/category). The blank line between the two placeholders makes them visually distinct in the rendered prompt. Adjust spacing if the surrounding lines have specific indentation needs — preserve the existing indentation.

- [ ] **Step 3: Verify TestPromptWiring novel test still passes**

Run:
```bash
./venv/bin/python -m pytest tests/test_genre_beat_patterns.py::TestPromptWiring::test_novel_outline_prompt_contains_beat_patterns_section -v
```

Expected: PASS (the placeholders now render their content into the prompt).

- [ ] **Step 4: Commit**

```bash
git add backend/prompts/novel_outline_generation.yaml
git commit -m "feat(prompts): add genre_beat_patterns + focus_vocab placeholders to novel_outline"
```

---

## Task 14: Update `outline_generation.yaml` prompt template

**Files:**
- Modify: `backend/prompts/outline_generation.yaml`

- [ ] **Step 1: Locate the insertion point**

Open `backend/prompts/outline_generation.yaml`. Find the equivalent of the "请生成章节大纲" line. Insert the same 2-line block.

- [ ] **Step 2: Insert the placeholders**

Same as Task 13, insert just before the "请生成" line:

```yaml

  {genre_beat_patterns}

  {genre_focus_vocabulary}
```

Match the surrounding indentation precisely.

- [ ] **Step 3: Verify TestPromptWiring chapter test still passes**

Run:
```bash
./venv/bin/python -m pytest tests/test_genre_beat_patterns.py::TestPromptWiring::test_chapter_outline_prompt_uses_outline_text_for_matching -v
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/prompts/outline_generation.yaml
git commit -m "feat(prompts): add genre_beat_patterns + focus_vocab placeholders to outline"
```

---

## Task 15: Integration tests + full suite verification

**Files:**
- Modify: `tests/test_genre_beat_patterns.py` (add `TestIntegration` class with 2 tests)
- No production code changes

This task verifies end-to-end behavior and confirms no regressions in the full suite.

- [ ] **Step 1: Write 2 integration tests**

Append to `tests/test_genre_beat_patterns.py`:

```python
class TestIntegration:
    """End-to-end integration: same concept, different outlines → different prompts."""

    @pytest.mark.asyncio
    async def test_keyword_match_changes_prompt_with_different_outlines(self):
        """cool_novel + same concept; outline_text='打脸' vs '突破' → prompts differ."""
        from backend.agents.planner import PlannerAgent

        async def make_planner_with_capture(self, task_name, system_prompt, user_prompt, **kwargs):
            return {"volumes": []}, _mock_response()

        captured = {}

        async def capturing_fake(self, task_name, system_prompt, user_prompt, **kwargs):
            captured.setdefault("prompts", []).append(user_prompt)
            return {"volumes": []}, _mock_response()

        planner = PlannerAgent(project_id="test")
        with patch.object(PlannerAgent, "generate_with_tier", new=capturing_fake):
            common = dict(
                concept={"title": "测试", "premise": "x", "tone": "x", "theme": "x"},
                story_dna={"core_contradiction": {"statement": "x"}},
                world={"era": "x", "power_system": {"name": "x", "core_rules": []}, "core_rules": []},
                characters=[],
                target_total_words=1_000_000,
                min_words=2000,
                genre="cool_novel",
            )
            await planner.generate_novel_outline(outline_text="打脸", **common)
            await planner.generate_novel_outline(outline_text="突破升级", **common)

        prompt_face, prompt_break = captured["prompts"]
        # 打脸 outline → contains 打脸 template, does NOT contain 突破 template
        assert "打脸" in prompt_face
        assert "升级契机" not in prompt_face
        # 突破 outline → contains 突破 template, does NOT contain 打脸 template
        assert "升级契机" in prompt_break
        assert "打脸" not in prompt_break

    def test_unknown_genre_falls_back_to_first_index_entry(self):
        """genre='nonexistent_xyz' → cool_novel's beat_patterns used (matches existing fallback)."""
        from backend.agents.planner import _resolve_genre_beat_patterns
        # First index entry is cool_novel (per config/genres/index.yaml)
        result = _resolve_genre_beat_patterns("nonexistent_xyz", "打脸")
        assert "打脸" in result
        assert "【题材节拍模板】" in result
```

- [ ] **Step 2: Run integration tests**

Run:
```bash
./venv/bin/python -m pytest tests/test_genre_beat_patterns.py::TestIntegration -v
```

Expected: 2 passed.

- [ ] **Step 3: Run full beat_patterns test file**

Run:
```bash
./venv/bin/python -m pytest tests/test_genre_beat_patterns.py -v
```

Expected: All tests pass (target: 14 tests — 1 TestFocusVocabulary + 4 TestSchemaValidation + 4 TestKeywordMatching + 3 TestPromptWiring + 2 TestIntegration = 14).

- [ ] **Step 4: Run full suite, verify pre-existing failures unchanged**

Run:
```bash
./venv/bin/python -m pytest --no-header -q 2>&1 | tail -20
```

Expected: 1372 passing (1358 existing + 14 new), 10 pre-existing failures (autopilot / llm_config_api — unrelated to genre work). The same 10 tests that were failing before this work began must still be failing.

If you see NEW failures:
1. Check if the failing test is in `tests/test_genre_beat_patterns.py` or `tests/test_genre_template_propagation.py` — fix the implementation.
2. If it's in another test file, check whether it imports from `backend.agents.planner` and depends on a method signature that changed. The only signature change is `outline_text` and `genre` added as kwargs with defaults — should be backward compatible.

- [ ] **Step 5: Verify backward compatibility of existing 14 tests**

Run:
```bash
./venv/bin/python -m pytest tests/test_genre_template_propagation.py -v
```

Expected: All 14 existing tests pass unchanged (they cover `{genre_tone}` / `{genre_style_rules}` / `{genre_trope_patterns}` which are not affected).

- [ ] **Step 6: Commit integration tests**

```bash
git add tests/test_genre_beat_patterns.py
git commit -m "test(genres): add integration tests for beat_patterns end-to-end"
```

- [ ] **Step 7: Final commit (no changes if Step 6 was enough)**

If Step 4 surfaced fixes, commit those separately with a `fix(genres):` prefix.

---

## Self-Review Checklist (run before declaring done)

After completing all 15 tasks, run through this list:

- [ ] **Spec coverage**: Every requirement in `docs/superpowers/specs/2026-07-29-genre-beat-patterns-design.md` is implemented:
  - [ ] `config/genre_focus_vocabulary.yaml` exists with 6 entries
  - [ ] All 7 genre YAMLs have `beat_patterns` with 4-5 templates each
  - [ ] `catalog.py` requires `beat_patterns` and validates shape (incl. min keyword length 2)
  - [ ] `_resolve_genre_focus_vocabulary` is `@lru_cache`d, returns full legend with header
  - [ ] `_resolve_genre_beat_patterns` does substring match, priority sort, returns whole section (header + body) or empty string
  - [ ] `generate_novel_outline` accepts `outline_text` and `genre`, passes both placeholders
  - [ ] `generate_outline` accepts `outline_text` and `genre`, passes both placeholders
  - [ ] `novel_outline_generation.yaml` and `outline_generation.yaml` have both placeholders
  - [ ] `None` outline_text is normalized to `""`
  - [ ] Frontend: no changes (verify nothing in `frontend/src/` was touched)

- [ ] **Placeholder scan**: `grep -nE "TBD|TODO|FIXME|implement later" config/genres/*.yaml config/genre_focus_vocabulary.yaml backend/genres/catalog.py backend/agents/planner.py backend/prompts/novel_outline_generation.yaml backend/prompts/outline_generation.yaml tests/test_genre_beat_patterns.py` returns nothing.

- [ ] **Type consistency check**:
  - `_resolve_genre_focus_vocabulary()` returns `str` everywhere it's used ✓
  - `_resolve_genre_beat_patterns(genre: str, outline_text: Optional[str] = "")` returns `str` everywhere ✓
  - `generate_novel_outline` and `generate_outline` both have `outline_text: str = ""` and `genre: str = "cool_novel"` parameters ✓

- [ ] **Test counts**:
  - `TestFocusVocabulary`: 1
  - `TestSchemaValidation`: 4
  - `TestKeywordMatching`: 4
  - `TestPromptWiring`: 3 (1 focus_vocab + 2 novel_outline)
  - `TestIntegration`: 2
  - Total: 14 ✓

- [ ] **No regressions**: Step 4 of Task 15 confirms 10 pre-existing failures unchanged.