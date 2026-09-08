# S3 自适应发散：默认选中原始拆解(S1 产物)

> **Status:** Draft for review
> **Author:** Claude (brainstorming with user)
> **Date:** 2026-09-09
> **Scope:** 增量修改 `divergence_v2/` S3 阶段(自适应发散),为每个 unit 增加「原始拆解」作为默认选中的 radio 选项。

---

## 1. 目标与非目标

### 1.1 目标

在 `divergence_v2` 的 S3 阶段(自适应发散),对每个 unit,新增「原始拆解」选项:

1. **内容来源**:S2 第一性拆解生成的 `unit_name` + `unit.description`(已存在 `state.dimensions[i].units[j]` 里,当前 S3 仅渲染 `unit_name`,`description` 字段未使用)。
2. **呈现形式**:与 LLM 生成的 candidates 并排成单个 radio 行(沿用现有 `<input type="radio">` 单选交互),前缀文本 `[原始拆解]`,无颜色 / 图标 / 背景等额外视觉差异化。
3. **默认选中**:首次进入 S3 时该项默认勾选(由后端在 `/diverge` 时把虚拟 candidate 的 `selection_rank` 设为 0,沿用现有 `selection_rank === 0` 默认选中规则,前端零改动)。
4. **用户切换**:用户可点 LLM 候选;切回「原始拆解」即点该项。无独立「回退到原始」按钮。
5. **不破坏 commit**:commit 阶段按现有 `selection_rank === 0` 候选合成 concept;当用户保留默认(选原始),commit 拿到的是 `u.description`,不带 `chain_reaction`(因虚拟 candidate 的 `chain_reaction=""`)。

### 1.2 非目标

- 不修改 `Unit` / `UnitCandidate` dataclass 的字段(用户选 X. 虚拟候选方案,核心承诺是不动 schema)。
- 不修改 `select_unit` 端点契约(`candidate_index` 仍按数据数组下标传入,虚拟在末尾位置直接可用)。
- 不写存量 state.json 的迁移脚本;前端首次进 S3 检测无虚拟就自动调一次 `/diverge`(已有幂等行为)。
- 不在 commit prompt 里新增「标记此为原始拆解」的特殊 token;空 `chain_reaction` 即隐式信号。
- 不修改 S2 拆解产物 / S1 输入 / S4 提交除 prompt 拼接以外的部分。

---

## 2. 背景与动机

### 2.1 当前 S3 行为

`S3DivergeStep.tsx`(位于 `frontend/src/components/wizard/divergence_v2/`)渲染每个 unit 的 candidates 为单选 radio 行,默认选中 = `selection_rank === 0` 的候选。当前 rank 由后端在 `/diverge` 时按 LLM 返回顺序分配 0/1/2,所以默认选中是「LLM 生成的第一项」(不一定是用户想要的)。

原始 S2 拆解的 `unit.description`(第一性拆解产物)在 S3 **未被渲染**(agent 探查确认 `S3DivergeStep.tsx` 仅引用 `u.unit_name`,`description` 字段未被读),也**不可被选**。

### 2.2 新需求动机

让 S3 显式把「原始拆解」摆到用户面前作为可选项,并预设为默认——理由:LLM 的发散可能不是用户想要的走向,保留「就用原始」这个零成本退路对用户决策友好。

### 2.3 关键设计决策

| 决策 | 选择 | 原因 |
|---|---|---|
| 后端表达方式 | **X. 虚拟 candidate(用户选)** | 不动 schema,沿用 `selection_rank` 机制,`select_unit` 零改动 |
| 视觉呈现 | **A. 跟候选并排为单选一行** | 跟现有 radio 交互一致,无新交互范式 |
| 视觉差异化 | **仅文字前缀 `[原始拆解]`** | 不加颜色/图标,保持极简,后续可按需追加 |
| 虚拟在数据数组位置 | **末尾** | LLM 候选保持自然 0/1/2 下标,虚拟占位 candidates.length |
| 持久化 | **持久化到 state.json** | 让 `select_unit(candidates.length-1)` 在数据上有效;前端无需特殊 index 协议 |
| 老 state.json 兼容 | **前端检测无虚拟 → 自动调 `/diverge`** | 复用 `/diverge` 既有「先清空再重生成」的幂等行为,无新分支 |

---

## 3. 设计

### 3.1 虚拟 candidate 数据形状

`UnitCandidate`(`backend/creative_os/three_b_engine.py:75-87`)字段填充:

| 字段 | 值 |
|---|---|
| `id` | `f"{unit.id}__original"` (双下划线分隔,唯一约定) |
| `unit_id` | `unit.id` |
| `unit_name` | `unit.unit_name` |
| `description` | `unit.description`(原样,S2 第一性拆解产物) |
| `chain_reaction` | `""`(空字符串,无变异即无连锁推演) |
| `main_operator` | `None` |
| `aux_operator` | `None` |
| `selection_rank` | 初始 `0`;LLM 候选初始改为 `1, 2, 3` |

**识别方式**:无 schema 字段,用 `id` 以 `__original` 后缀作为唯一约定。`commit()` 构建 prompt 时若 `cand.chain_reaction == ""` 跳过「连锁推演:」行。

### 3.2 后端改动

#### 3.2.1 新增 helper `_append_original_candidate`

```python
def _append_original_candidate(
    unit: Unit, llm_candidates: list[UnitCandidate]
) -> list[UnitCandidate]:
    if any(c.id == f"{unit.id}__original" for c in llm_candidates):
        return llm_candidates
    virtual = UnitCandidate(
        id=f"{unit.id}__original",
        unit_id=unit.id,
        unit_name=unit.unit_name,
        description=unit.description,
        chain_reaction="",
        main_operator=None,
        aux_operator=None,
        selection_rank=0,
    )
    for i, c in enumerate(llm_candidates, start=1):
        if c.selection_rank == 0:
            c.selection_rank = i
    return llm_candidates + [virtual]
```

放置位置:`backend/creative_os/three_b_engine.py` 模块级,紧邻 `_diverge_single_unit`。

#### 3.2.2 `diverge()` 调用点改造

在 `diverge()` 内并发跑完 `_diverge_single_unit` 收集到每个 unit 的 LLM 候选后,把每组候选送入 helper,再写回 `dim.units[unit_index].candidates`。

具体:`three_b_engine.py:384-394` 区域。现有循环已有结构,改动是:helper 调用 + 写回。LLM 失败(返回 `[]`)时,helper 仍注入虚拟,该 unit 的 candidates 长度为 1,UI 自然显示「只剩 [原始拆解] 可选」。

#### 3.2.3 `select_unit` 端点

**不改。** `select_unit_candidate()`(`three_b_engine.py:509-533`)按 `candidate_index` swap rank,虚拟在数组末位时 index = `candidates.length - 1`,直接可用。

#### 3.2.4 `_build_commit_user_prompt` 改造

`three_b_engine.py:677-709`:拼接「连锁推演: {chain_reaction}」前判 `if cand.chain_reaction:` 为真再渲染,空字符串时整行跳过。`{cand.description}` 行保留(描述就是 `u.description`)。

### 3.3 前端改动

#### 3.3.1 `partitionOriginalCandidate` helper

签名:`partitionOriginalCandidate(candidates: UnitCandidate[]) → { original: UnitCandidate | null, others: UnitCandidate[] }`

行为:扫一遍 `candidates`,找到 `id` 以 `__original` 结尾的项 → `original`,其余 → `others`(保持原顺序)。

放置位置:`frontend/src/components/wizard/divergence_v2/S3DivergeStep.tsx` 顶层(与组件同文件,小 helper 不必单独建文件)。

#### 3.3.2 `S3DivergeStep.tsx` 渲染改造

`UnitCard` 渲染候选循环处:

```tsx
const { original, others } = partitionOriginalCandidate(candidates);
const ordered = original ? [original, ...others] : others;
return ordered.map((c) => {
  const realIndex = candidates.indexOf(c);  // select_unit 用 data array index
  const isOriginal = original !== null && c.id === original.id;
  return (
    <CandidateRow
      key={c.id}
      candidate={c}
      isOriginal={isOriginal}  // 控制 [原始拆解] 前缀渲染
      checked={c.selection_rank === 0}
      onSelect={() => selectUnit(unitId, realIndex)}
    />
  );
});
```

`CandidateRow` 在 `isOriginal` 时渲染前缀文本「[原始拆解] 」在描述前。其余样式(行高 / 字号 / radio 控件 / description / chain_reaction 文本)与 LLM 候选完全相同。

#### 3.3.3 `select_unit` 调用

**不改。** `selectUnit(unitId, realIndex)` 沿用现有实现。后端不需要知道前端 UI 顺序,只认 data array index。

#### 3.3.4 默认选中

**不改。** 现有 `selection_rank === 0` 选中规则仍生效,后端在 `/diverge` 时把虚拟 rank 设 0,前端照旧取 rank 0 = 虚拟项 → 默认勾选。

### 3.4 状态生命周期

| 时机 | 行为 |
|---|---|
| S3 首次进入(`/diverge`) | 后端清空旧 candidates → LLM 生成 → helper 注入虚拟 → 落盘 state.json |
| 用户重跑 `/diverge` | 现有逻辑先清空 → 重生成 → 新虚拟 → 旧选择被丢弃,默认重置为虚拟 |
| 存量 state.json(无虚拟) | 前端在 S3 mount 时检查 candidates 是否含 `id` 以 `__original` 结尾的项;无则自动调 `/diverge`(`/diverge` 幂等) |
| LLM 整体失败 | `_diverge_single_unit` 返回 `[]` → helper 仍注入虚拟 → 该 unit 仅「[原始拆解]」一项可选,用户回退到原始 |

### 3.5 错误处理

| 场景 | 处理 |
|---|---|
| LLM 调用抛异常 | `_diverge_single_unit` 已有 try/except → 返回 `[]` → helper 注入虚拟(描述 = u.description) |
| `unit.description` 为空 | helper 照常注入,UI 渲染空文本 radio,与 LLM 候选空 description 时行为一致 |
| `_append_original_candidate` 重复注入 | helper 内部 `any(c.id == ...)` 防重 |
| 前端在虚拟不存在时调用 `select_unit(index>=len)` | 前端 S3 mount 时检测到无虚拟就自动 `/diverge`,绝不会发出越界 index |

---

## 4. 测试覆盖

### 4.1 单元测试

| 文件 | 用例 |
|---|---|
| `tests/test_creative_os/test_three_b_engine.py`(新增) | `_append_original_candidate`:正常输入 → 虚拟在末尾 + rank 0 + LLM 候选 rank 1/2/3;LLM 返回空 → 仅虚拟;重复调用 → 防重 |
| `frontend/src/components/wizard/divergence_v2/__tests__/S3DivergeStep.test.tsx`(新增或扩已有) | `partitionOriginalCandidate`:有/无虚拟时切分正确;渲染时 `[原始拆解]` 前缀只在虚拟项出现 |

### 4.2 集成测试

| 文件 | 用例 |
|---|---|
| `tests/test_api/test_three_b_routes.py`(新增) | `POST /three-b/diverge` 返回值里每个 unit 都有 `id` 以 `__original` 结尾且 rank=0 的 candidate |

### 4.3 E2E 烟雾测试(必须)

走完 S0→S1→S2→S3(沿用 `docs/superpowers/specs/2026-09-06-creative-decomposition-and-adaptive-engine-design.md` 的端到端脚手架),断言:

1. S3 每个 unit 渲染含 `[原始拆解]` 的 4 行 radio;
2. 默认勾选的是 `[原始拆解]`(不是 LLM 第一项);
3. 用户切到 LLM_A → 后端 `select-unit` 落盘 `selection_rank`,LLM_A rank=0;
4. 用户切回 `[原始拆解]` → 虚拟 rank=0;
5. `POST /three-b/commit` 后 `state.committed_concept` 包含 `u.description`(不是 LLM 输出)。

### 4.4 不写的东西

- 不写 mock 后端的 frontend 测试(per `feedback_frontend_mock_hides_contract_drift.md` 的教训:mock 测试只能验 render,验不了 wire contract)。
- 不写存量 state.json 迁移脚本(S3 mount 时自动 `/diverge` 已覆盖)。

---

## 5. 受影响的文件清单

| 文件 | 类型 | 改动 |
|---|---|---|
| `backend/creative_os/three_b_engine.py` | 修改 | 新增 `_append_original_candidate` helper;`diverge()` 内调 helper 写回 candidates;`_build_commit_user_prompt` 跳空 chain_reaction 行 |
| `frontend/src/components/wizard/divergence_v2/S3DivergeStep.tsx` | 修改 | 渲染时 partition 虚拟并前置,`CandidateRow` 加 `isOriginal` prop 控制前缀;新增 `useEffect` mount 检测无虚拟则自动调 `/diverge` |
| `tests/test_creative_os/test_three_b_engine.py` | 新增 | `_append_original_candidate` 单元测试 |
| `frontend/src/components/wizard/divergence_v2/__tests__/S3DivergeStep.test.tsx` | 新增/扩 | `partitionOriginalCandidate` + 渲染前缀 |
| `tests/test_api/test_three_b_routes.py` | 新增 | `/diverge` 集成测试 |
| `tests/e2e/test_divergence_v2_smoke.py` | 新增/扩 | E2E 烟雾测试 |

---

## 6. 不在范围内的相关工作(留 follow-up)

- 把 `[原始拆解]` 视觉差异化(背景色 / 图标)— 当前需求未要求,留后续可加。
- 提交 concept 时在 prompt 里显式标记「来自原始拆解的 unit」,便于 LLM 理解合成权重。
- 撤销 / 重做用户对 unit 的选择(目前只通过 `/diverge` 重置)。
- per-unit 级别的「保留原状」开关(独立于此特性的全局默认行为)。