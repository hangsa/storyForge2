# 卷级上下文切片与成长曲线对齐 — 设计

日期：2026-08-21
分支：v2.1

## 问题

### 1. 章节大纲看不到「卷」

`planner.generate_outline`（`backend/agents/planner.py:483-540`）把整份 `novel_outline.json`
序列化后塞进 prompt：

```python
novel_outline_context = (
    json.dumps(novel_outline, ensure_ascii=False, indent=2)
    if novel_outline else "（暂无全书大纲 …）"
)
```

生成第 137 章时，模型看到的是全部卷、全部 `key_events`、全部 `mc_growth_arc`、
全部 `key_plot_points`，靠自己比对 `chapter_number` 与 `chapter_range` 字符串来定位。
后果有两条：上下文随卷数线性膨胀；模型可能把后卷的剧情提前写进当前卷。

后端没有任何「章 → 卷」的映射代码。只有两份重复的「取最大 end」解析器
（`backend/api/stage4_writing.py:1529-1563`、`backend/api/stage3_outline.py:135-145`），
都只用来算章节总数。映射逻辑目前只存在于前端 `frontend/src/utils/outline.ts:72-115`
（`parseVolumes` / `groupChaptersByVolume`），供 ChapterTreePanel 分组使用。

附带问题：`stage3_outline.py:85` 只把 `characters[0]` 传给 planner，反派与导师在章节
大纲阶段完全不可见。

### 2. 成长曲线与卷脱节，且数据流方向倒置

现状有三份互相冲突的「阶段章节范围」：

1. **STAGE2 角色生成** — `backend/prompts/character_generation.yaml:67` 要求 LLM 为核心
   角色填写 `growth_curve.stages[].target_chapter_range`（如 `"3-5"`）。此时全书大纲尚不
   存在，这个范围是在真空中猜测的，而真实的第一卷可能是 1-120 章。
2. **STAGE3 全书大纲** — LLM 产出 `mc_growth_arc[]`（`label` / `target_chapter_range` /
   `description`）。全仓库检索确认：除前端展示与编辑外无任何代码消费，是死数据。
3. **STAGE3 每章生成后** — `auto_generate_growth_curves`
   （`backend/growth_curve/auto_generator.py:87-156`）为缺少曲线的核心角色补一份，
   `target_chapter_range` **从已生成的 `outline.json` 章节反推**（line 139-143）。
   批量循环生成第 1 章时索引中只有第 1 章，得到 `"1-1"`；此后因 line 120 的
   `if char.get("growth_curve"): continue` 永不更新，曲线被首次调用的退化状态冻结。

成长曲线唯一的消费点是 STAGE4 场景写作的 `compute_character_growth_context`
（`backend/growth_curve/context.py:24`，由 `stage4_writing.py:684` 与 `:1069` 调用）。
它从不参与章节大纲生成。

即：成长曲线不但没进章节大纲，其章节范围还是从章节大纲反推的。

## 目标

1. 章节大纲基于**所属卷的完整大纲 + 相邻卷摘要**生成，而非整份全书大纲。
2. 成长曲线以**卷大纲为权威源**重算，并注入章节大纲生成。
3. 顺带修复：章节大纲只见 `characters[0]`；第 N 章不知道第 N-1 章写了什么。

## 非目标

- 不改动 STAGE4 场景写作链路。
- 不改动 `binder.py` 的关键词绑定机制。
- 不改动前端。`ChapterOutlineStep` 现有的「按第一卷范围批量生成」语义与卷切片天然吻合。

## 架构

新增 `backend/outline_context/` 包，解析与渲染分离：

```
backend/outline_context/
├── __init__.py
├── volumes.py     # 纯解析：无渲染、无 IO
└── builder.py     # 渲染 prompt 文本片段
```

新增 `backend/growth_curve/aligner.py`。删除 `backend/growth_curve/auto_generator.py`。

选择独立包而非塞进 `planner.py` 的理由：解析逻辑可脱离 LLM mock 单测；`planner.py`
已有 600 行；两份重复的解析器可以收敛到一处。选择后端自建而非复用前端结果的理由：
托管自动写作（autopilot）不经过前端，客户端权威会产生两套行为。
`frontend/src/utils/outline.ts:5` 的注释已确立「前后端各自镜像一份解析器」的惯例。

## 组件

### `outline_context/volumes.py`

```python
CHAPTER_RANGE_RE = re.compile(r"^\s*(\d+)\s*-\s*(\d+)\s*$")

@dataclass(frozen=True)
class ParsedVolume:
    index: int
    name: str
    chapter_range: str
    summary: str
    key_events: list[str]
    start: int
    end: int

def parse_volumes(novel_outline: dict | None) -> list[ParsedVolume]
def planned_total(novel_outline: dict | None) -> int
def locate_volume(chapter_number: int, volumes: list[ParsedVolume]) -> ParsedVolume | None
```

`parse_volumes` 丢弃 `start < 1`、`end < start`、以及不匹配 `CHAPTER_RANGE_RE` 的卷
（校验规则与 `stage4_writing.py:1541-1548` 一致），并按 `start` 升序排序 —— 用户手改
后卷序可能乱。`ParsedVolume.index` 记录排序后的下标，供 builder 定位相邻卷。

`planned_total` 替换 `stage4_writing.py:1529` 与 `stage3_outline.py:135-145` 两处实现，
两处改为导入。

`locate_volume` 越界策略：章号落在所有卷之外时**回退到最近的一卷** —— 小于首卷
`start` 取首卷，大于末卷 `end` 取末卷，落在两卷缝隙中取前一卷。仅当 `volumes` 为空
时返回 `None`。理由：超写的章节（用户经「+ 新章节」写过计划总数）在叙事上是末卷的
延续，给它末卷上下文比给它整本书更准。

### `outline_context/builder.py`

```python
def build_volume_context(novel_outline: dict | None, chapter_number: int) -> str
def build_recent_chapters_context(
    outline: dict | None, chapter_number: int, volume: ParsedVolume | None
) -> str
```

`build_volume_context` 渲染：

```
【全书核心冲突】…

【上一卷·第一卷 初入异世】
摘要：…

【当前卷·第二卷 建木之战】（第 121-260 章，本章为第 137 章）
摘要：…
关键事件：
- …

【下一卷·第三卷 归墟】
摘要：…

【本卷必须落地的关键情节点】
- 斧影初显（触发提示：约第 115 章）
  …
```

`core_conflict_theme` 始终注入。相邻卷只给 `name` + `summary`，不给 `key_events`。
首卷省略「上一卷」段，末卷省略「下一卷」段。

`key_plot_points` 按 `must_appear_in_volume` 与当前卷 `name` 做**双向子串匹配**
（卷名可能写全称 "第一卷 初入异世·建木之影"，也可能写简称 "第一卷"）。兜底规则：

- 若整份 `key_plot_points` 中**没有任何一条**能匹配上**任何**卷名 —— 说明该字段被
  写坏或格式不符 —— 则全量注入。
- 若匹配机制正常工作、只是当前卷恰好没有关键点 —— 则注入空。

这两条路径必须区分，否则关键情节点会因用户改动卷名而静默丢失。

降级：`novel_outline` 缺失或 `parse_volumes` 返回空列表时，`build_volume_context`
回落到现有行为（整份 JSON dump），保证存量项目与退化数据不受影响。

`build_recent_chapters_context` 从 `outline.json` 取 `[max(volume.start, N-3), N-1]`
区间内已生成的章节，渲染为：

```
【本卷前文（第 134-136 章）】
第134章《断链》主题：… 收尾于：<末场景 goal>（cliffhanger）
```

回看窗口**截断在卷首**，不跨卷：跨卷时上一卷的收束已由「上一卷摘要」承担，逐章
回看到上一卷末尾是重复信息。卷首章渲染为「（本卷起始章，无前文）」。
`volume` 为 `None`（无可解析卷）时窗口退化为 `[max(1, N-3), N-1]`。

### `growth_curve/aligner.py`

```python
def align_growth_curves(characters: list[dict], novel_outline: dict | None) -> list[dict]
```

零 LLM，纯函数，幂等。

**映射算法**。取 `mc_growth_arc` 中所有能解析出 `target_chapter_range` 的里程碑，按
原顺序构成范围表 `R`（长度 M）。角色阶段按 `stage_number` 升序取得 N 个，则：

```
N > 1:   stage[i].target_chapter_range = R[round(i * (M - 1) / (N - 1))]
N == 1:  stage[0].target_chapter_range = R[0]
```

结果单调不减。N > M 时允许多个阶段落在同一里程碑（并列的成长阶段在叙事上合理，
不做去重）。M == 0 时退化为在 `[1, planned_total]` 上把 N 个阶段均分。所有结果统一
clamp 到 `[1, planned_total]`（`planned_total` 为 0 时跳过 clamp）。

**只写 `target_chapter_range` 一个字段**。`bound_chapter`、`stage_name`、
`trigger_event_type`、`character_change` 一律不动 —— `bound_chapter` 语义是「实际触发于
第几章」，与「计划范围」正交，继续由 `binder.py` 负责。

**缺少 `growth_curve` 的角色**分两种处理：

- **主角**（`character_type == "protagonist"`）：`mc_growth_arc` 字面即主角成长弧线，
  据此合成阶段属忠实映射。`stage_name` 取里程碑 `label`，`trigger_event_description`
  取 `description`，`character_change` 留空，`target_chapter_range` 取里程碑范围。
- **其他角色**：不合成。给反派套用主角的成长节点是编造。保持无曲线，行为与今天一致。

合成阶段的 `trigger_event_type` 用 `binder.py` 现有的 `TRIGGER_KEYWORDS` 表匹配
`label + description`。匹配不上则**不写该字段** —— `binder.py:61` 读到 `""` 后
`TRIGGER_KEYWORDS.get("")` 返回空列表，从而永不绑定，这是期望的静默降级。

> 注意：`backend/models/character.py:70` 的 `GrowthStage.trigger_event_type` 默认值为
> `BETRAYAL_EXPERIENCED`。若将来有代码把 `characters.json` 过一遍 Pydantic 校验，
> 缺失字段会被填成「被背叛」。该路径今天不存在（这些文件以裸 dict 读写），但改动
> `characters.json` 的序列化方式时需要重新审视此处。

### `planner.generate_outline` 签名

```python
async def generate_outline(
    concept: dict,
    story_dna: dict,
    world: dict,
    characters: list[dict],          # 原为 character: dict
    chapter_number: int = 1,
    min_words: int = 4000,
    novel_outline: Optional[dict] = None,
    outline: Optional[dict] = None,  # 新增，用于近章摘要
    outline_text: str = "",
    genre: str = "cool_novel",
    user_modifications: str = "",
) -> tuple[dict, LLMResponse]
```

三段上下文由 planner 内部调 builder 拼装（与其现有调用 `_resolve_genre_*` 的方式一致），
端点保持薄。角色改用现成的 `pick_outline_cast(characters)`（`planner.py:242-276`），
它刻意排除 `voice_signature` 与 `growth_curve`；成长态势由
`compute_character_growth_context(characters, chapter_number)` 单独渲染，两者不重叠。

### `prompts/outline_generation.yaml`

| 槽位 | 变化 |
|---|---|
| `{character_context}` | 名字不变，内容由单个 `characters[0]` 变为 cast 阵容 |
| `{novel_outline_context}` | 名字不变，内容变为卷切片；模板中上方标题由「全书大纲」改为「卷级大纲上下文」|
| `{character_growth_context}` | 新增 |
| `{recent_chapters_context}` | 新增 |

**槽位一律不重命名。** `base_agent.py:241` 以 `user_prompt_template.format(**kwargs)`
渲染模板，而 Prompt Plaza 允许用户覆写 `outline_generation`
（`backend/services/prompt_override_store.py:28`）。覆写模板存的是完整文本，若我们把
`{character_context}` 改名，存量覆写仍含旧槽位而 kwargs 中已无对应键，`str.format`
会抛 `KeyError`，且 `generate_from_template` 未对此设防。反向则安全：新增槽位时旧模板
只是不使用它，多余 kwargs 对 `str.format` 无害。因此本次只改槽位**内容**，不改名字，
即便这牺牲了与 `novel_outline_generation.yaml` 的命名一致性。

`system_prompt` 新增一条硬约束：**本章必须服务于当前卷的 key_events 与本卷关键情节点；
不得推进超出本卷范围的剧情线**。这是整个改动的行为落点 —— 缺此条时切片仅节省 token，
模型仍可能把后卷内容提前写入。

## 数据流

```
STAGE2 角色生成
  └─ growth_curve.stages[]（无 target_chapter_range）

STAGE3 全书大纲（generate / PUT / regenerate-section）
  └─ 写 novel_outline.json
  └─ align_growth_curves(characters, novel_outline)   ← 新增
       └─ 写 characters.json（仅 target_chapter_range）

STAGE3 章节大纲 /stage3/generate（每章一次）
  ├─ align_growth_curves(...)                          ← 存量迁移，幂等
  ├─ 读 outline.json（时机由生成后提前到生成前）
  ├─ planner.generate_outline(characters=…, outline=…, novel_outline=…)
  │    ├─ build_volume_context(novel_outline, N)
  │    ├─ build_recent_chapters_context(outline, N, volume)
  │    ├─ compute_character_growth_context(characters, N)
  │    └─ pick_outline_cast(characters)
  ├─ upsert 该章到 outline.json
  ├─ 刷新 progress.total_chapters（改用 volumes.planned_total）
  └─ bind_growth_curve_to_outline(...)                 ← 保留

STAGE4 场景写作
  └─ compute_character_growth_context(...)             ← 不变，现在读到的是对齐后的范围
```

对齐器的调用点为三个写 `novel_outline.json` 的端点：`POST /stage3/generate-novel-outline`、
`PUT /stage3/novel-outline`、`POST /stage3/regenerate-novel-outline-section`。

`/stage3/generate` 开头额外调一次，作为存量项目的迁移路径：函数幂等、无 LLM、开销可
忽略，存量项目无需用户手动重存全书大纲即可获得正确范围。该处不新增写盘 —— 对齐后的
characters 沿用端点末尾已有的 `characters.json` 写入（`stage3_outline.py:159`），
顺序为 `align_growth_curves` → 生成 → `bind_growth_curve_to_outline` → 写盘。

## 错误处理

**新代码不引入任何能阻断章节大纲生成的失败路径。**

三个 builder 与 aligner 一律降级返回而非抛异常：单条数据畸形则跳过该条，整份数据畸形
则退回旧行为（全书 dump / 原样返回 characters）。`novel_outline.json` 是用户可在工作台
自由手改的文件，任何格式假设都必须能被违反。`locate_volume` 的越界回退与合成阶段
`trigger_event_type` 的缺省省略均属此类。

## Token 影响

卷切片把全书大纲部分从 O(卷数) 降为 O(1)：6 卷项目约 4K → 1.2K。新增 cast 阵容
（+1K）、成长态势（+0.3K）、近章摘要（+0.4K）。净值大致持平，但不再随卷数增长。

## 测试

### 新增

| 文件 | 覆盖 |
|---|---|
| `tests/test_outline_context_volumes.py` | `parse_volumes` 的排序与畸形过滤（`start < 1`、`end < start`、非 `"a-b"` 格式）；`locate_volume` 的卷内 / 边界 / 卷缝 / 超上界 / 低于下界 / 空列表；`planned_total` 与被替换的两处旧实现结果一致 |
| `tests/test_outline_context_builder.py` | 卷切片渲染（首卷无前卷、末卷无后卷、中间卷）；`key_plot_points` 双向子串过滤；「全卷名均匹配不上 → 全量兜底」与「当前卷恰好为空 → 注入空」两条路径分开断言；`novel_outline` 缺失时回落整份 dump；近章摘要的 3 章窗口、卷首截断、空窗口、`volume=None` 退化 |
| `tests/test_growth_curve_aligner.py` | N<M / N>M / N==M / M==0 / 无卷；`bound_chapter` 及其余字段不被改动；幂等（连跑两次结果相同）；主角无曲线时从 `mc_growth_arc` 合成；非主角无曲线时不合成；关键词匹配不上时 `trigger_event_type` 字段缺席 |
| `tests/test_stage3_outline_context.py` | 端点接线：三个 novel-outline 端点各触发一次对齐；`/stage3/generate` 开头亦触发（存量迁移）；planner 收到 characters 列表与 outline dict；**存量覆写兼容** —— 以改动前的 `outline_generation` 模板文本写入一份 project 级覆写，断言 `generate_outline` 仍能渲染而不抛 `KeyError` |

### 改动

- `tests/test_growth_curve.py` 第 384 行起的 `auto_generate_growth_curves` 测试类整体删除；
  binder 与 context 的测试保留不动。
- `tests/test_genre_beat_patterns.py:219` 调用了 `generate_outline`，随签名变更同步更新。

### 实现顺序

走 TDD，分四步，每步先写测试：

1. `outline_context/volumes.py`
2. `outline_context/builder.py`
3. `growth_curve/aligner.py` + 删除 `auto_generator.py` + 改
   `character_generation.yaml`（移除 line 67 说明与 line 124 示例中的
   `target_chapter_range`）
4. 端点接线 + `planner` 签名 + `outline_generation.yaml`

prompt 文案变更没有自动化断言，最后需跑一次真实章节大纲生成，人工核对切片是否符合预期。
