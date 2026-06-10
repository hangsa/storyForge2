下面这份文档已经转换成 **Google Stitch 可直接理解的 Web App 产品需求（PRD + UI Spec）**，重点聚焦界面、页面结构、交互流程、组件与信息架构，而非后端实现。

---

# StoryForge 1.2 Web UI PRD（Google Stitch Prototype）

## Product Name

StoryForge

AI 协作式长篇小说创作工作台

---

# 1. 产品定位

StoryForge 是一个面向网文作者、小说作者、编剧的 AI 协作创作平台。

核心理念：

> 不是 AI 自动写小说，而是 AI 与作者共同完成创作。

平台支持：

* 创意发散
* 世界观设计
* 角色成长设计
* 情节规划
* 逐章写作
* 全书诊断
* 导出发布

整个产品围绕：

**讨论 → 探索 → 选择 → 创作 → 评审 → 修订**

展开。 

---

# 2. 整体信息架构

```text
StoryForge
│
├── Dashboard
│
├── Project Workspace
│   │
│   ├── Stage 1 创意探索
│   │     └── Creative Canvas
│   │
│   ├── Stage 2 世界观与角色
│   │     ├── World Workshop
│   │     └── Growth Workshop
│   │
│   ├── Stage 3 情节规划
│   │     ├── Outline Board
│   │     └── Branch Simulator
│   │
│   ├── Stage 4 写作中心
│   │     ├── Chapter Workspace
│   │     ├── Scene Editor
│   │     ├── Live Review
│   │     └── Chapter Review
│   │
│   ├── Stage 5 全书诊断
│   │
│   └── Stage 6 导出中心
│
├── Inspiration Hub
│
├── Style Sandbox
│
├── Asset Center
│
└── Settings
```

---

# 3. 全局布局

## Desktop Layout

```text
┌────────────────────────────────────────────┐
│ Top Navigation                             │
├───────┬──────────────────────────┬─────────┤
│ Left  │ Main Workspace           │ Right   │
│ Nav   │                          │ AI Pane │
│       │                          │         │
├───────┴──────────────────────────┴─────────┤
│ Bottom Status Bar                          │
└────────────────────────────────────────────┘
```

---

## 左侧导航

固定宽度 280px

模块：

```text
Project

Dashboard

Stage 1 创意探索
Stage 2 世界观
Stage 3 情节规划
Stage 4 写作中心
Stage 5 诊断修订
Stage 6 导出

──────────

灵感库
风格沙盒
资产中心

──────────

设置
```

---

## 顶部导航

显示：

```text
项目名称

当前阶段

协作模式

保存状态

用户头像
```

示例：

```text
代码天才重生记

Stage 3

Discuss Mode

Auto Saved
```

---

## 右侧 AI 协作面板

固定存在。

类似：

Claude Artifacts
Cursor Chat
Notion AI

布局：

```text
AI Partner
----------------

Agent 当前身份

Creative Director

----------------

建议

① ...
② ...
③ ...

----------------

对话区

用户输入框
```

支持：

* discuss
* review
* approve
* live
* auto

五种协作模式切换。

---

# 4. Dashboard

首页

展示项目全景。

---

## Dashboard Cards

### Project Progress

```text
总进度

42 / 100 Chapters

42%
```

---

### Writing Stats

```text
总字数

178,000

平均章节

4341
```

---

### Quality

```text
连贯性

84.5

重写次数

12
```

---

### Cost

```text
Token

4.82M

Cost

$48.2
```

来源 progress.json。 

---

# 5. Stage 1 —— Creative Canvas

核心页面。

整个产品最重要页面之一。

---

## 页面布局

```text
┌──────────────────────────────────┐
│ Story DNA Candidates             │
├──────────────┬───────────────────┤
│ WhatIf Tree  │ Node Detail       │
│              │                   │
│              │                   │
└──────────────┴───────────────────┘
```

---

## WhatIf Tree

采用：

* React Flow
* MindMap Style

展示：

```text
Root

 ├─ Node A
 │   ├─ A1
 │   └─ A2
 │
 ├─ Node B
 │
 └─ Node C
```

支持：

### Node Actions

节点 Hover：

```text
♡ Like

✂ Prune

⟳ Re-expand

⊕ Add

⊞ Merge
```

---

## Node Detail Panel

展示：

```text
核心设定

体裁融合

核心矛盾

市场定位

新颖度评分

爆款潜力
```

评分卡：

```text
Novelty

83

Market
72

Contradiction
95

Discussion
78
```

---

# 6. Stage 2 —— 世界观与角色工坊

---

## 双标签布局

```text
World

Characters
```

---

## World Builder

左：

世界结构树

```text
时代

地点

势力

能力体系
```

右：

详情编辑器

---

## Character Workshop

卡片式角色管理

```text
林峰

主角

19岁

能力：代码编辑
```

---

## 成长工坊（核心）

采用：

Timeline + Graph

展示成长曲线。

```text
成长值
100 ──────────╮
              │
70 ──────╮    │
          │   │
40 ──╮   │    │
      │  │    │
0 ──────────────────

    1 25 58 82 100
```

点击节点：

弹出：

```text
转折事件

能力变化

心理代价

关系影响
```

---

# 7. Stage 3 —— 情节规划

---

## Outline Board

类似：

Notion + Jira

结构：

```text
Volume
 └ Chapter
      └ Scene
```

---

## Timeline View

```text
Vol1

1 2 3 4 5 ...

Vol2

21 22 23 ...
```

显示：

* 爽点
* 反转
* 谜团
* 伏笔

颜色区分。

---

## Branch Simulator

核心功能。 

布局：

```text
Current Plan

VS

Simulation Plan
```

---

### 上方

修改假设输入：

```text
如果把反派揭示提前到20章
```

---

### 下方四个分析面板

#### 张力曲线对比

Line Chart

```text
Before

After
```

---

#### 伏笔影响

```text
fs_001

受影响

需要调整
```

---

#### 角色成长影响

```text
林峰

TP2

58 -> 46
```

---

#### 读者体验预测

```text
Curiosity +15

Tension +12

Fatigue -6
```

---

# 8. Stage 4 —— 写作中心

核心生产页面。

---

## 页面布局

```text
┌──────────┬───────────────┬──────────┐
│ Chapters │ Scene Editor  │ AI Live  │
└──────────┴───────────────┴──────────┘
```

---

## Chapter Sidebar

```text
Chapter 1

Chapter 2

Chapter 3
```

状态：

```text
Draft

Review

Done
```

---

## Scene Planner

顶部：

```text
Scene 1
Scene 2
Scene 3
Scene 4
```

卡片内容： 

```text
Goal

Conflict

Emotion Arc

Narrative Role
```

---

## Live Writing

实时生成。

每幕完成立即展示。 

底部：

```text
Accept

Rewrite

Edit Myself

Mark Preference

Innovation Pass
```

---

## Innovation Pass Dialog

```text
突破规则

原因

预期效果

[Approve]
```

来源创新豁免机制。 

---

# 9. Chapter Review 页面

每章完成自动进入。

---

## Score Cards

```text
Coherence

85

Curiosity

72

Addiction

68
```

---

## Reader Metrics Radar

七维雷达图：

* Curiosity
* Tension
* Satisfaction
* Frustration
* Fatigue
* Addiction
* Discussion Potential

来源评审机制。 

---

## Review Discussion

AI Reviewer：

```text
本章结尾钩子较弱

是否加强？
```

用户：

```text
保持

加强

讨论
```

---

# 10. Inspiration Hub

全局悬浮入口。

产品级核心功能。 

---

## 页面布局

```text
All Inspirations

├ Concept
├ World
├ Plot
├ Writing
├ Style
```

---

## Inspiration Card

```text
灵感内容

来源阶段

关联角色

关联章节

是否已采用
```

支持：

```text
拖拽到当前工作区
```

---

# 11. Style Sandbox

独立页面。

---

## 左侧

风格参数

```text
句长

对白比例

环境描写

爽点密度

节奏
```

Slider 控件。

---

## 中间

测试文本输入

500字左右

---

## 右侧

实时预览

A

默认

B

对白+15%

C

句长+20%

D

混合版

````

---

# 12. 全书诊断中心

---

## Issues Table

```text
Priority

Type

Chapter

Status
````

---

## 分类

```text
Timeline

Character

Pacing

Foreshadowing

Redundancy
```

来源 STAGE5。 

---

## Issue Detail Drawer

显示：

```text
问题

影响

建议修复

确认修复

跳过

替代方案
```

---

# 13. 导出中心

---

## 导出格式

卡片式：

```text
Markdown

PDF

EPUB
```

---

## Export Options

```text
保留 SF_LOG

Yes / No

生成目录

Yes / No

封面

Upload
```

---

# 14. Google Stitch 页面清单

最终建议 Stitch 生成以下 12 个页面：

1. Dashboard
2. Project Setup
3. Creative Canvas
4. Story DNA Detail
5. World Builder
6. Character Growth Workshop
7. Outline Planner
8. Branch Simulator
9. Writing Studio
10. Chapter Review
11. Inspiration Hub
12. Diagnostics & Export

这是最符合 StoryForge 1.2 的 MVP + V1 商业级产品原型结构，且完整覆盖文档中的创意画布、成长工坊、分支模拟、风格沙盒、章节评审会、灵感面板等核心协作机制。
