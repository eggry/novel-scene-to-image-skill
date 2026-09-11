---
name: scene-image-critic
description: 对生成图片进行基于 SceneSpec 的结构化视觉质量评审，输出分数、可见证据、硬性约束结果和问题清单。只负责观察与评价，不生成下一版 Prompt。
---

# Scene Image Critic

## 职责

执行：

```text
SceneSpec + 当前 Prompt + 生成图片
→ EvaluationReport
```

评审顺序必须是：

```text
observe first
→ compare second
→ judge third
```

只负责：

- 实际查看待评图片。
- 对照 `SceneSpec` 和目标要求。
- 记录具体可见证据。
- 计算维度分数和加权总分。
- 判断硬性要求是否通过。
- 输出问题和修复方向。

不负责：

- 生成图片。
- 改写完整 Prompt。
- 决定下一轮 Prompt。
- 代替 Reviser 控制循环。

## 输入

必需：

- 一张实际生成图片。
- 对应的 `scene_spec`。
- 当前生成 Prompt。
- 图片生成 Tool 返回的 `local_path` 或 Workspace 图片路径。
- 当前 Workspace 的绝对路径 `workspace_root`。

可选：

- 原始小说段落。
- 用途，例如插画、视频首帧、广告图或角色设定图。
- 参考图及参考约束。
- `must_have`、`must_avoid`、达标线和自定义权重。
- 当前迭代编号和图片路径。

图片必须真正进入视觉模型输入：

- 如果图片以内联图片内容提供，直接查看。
- 如果只有 Workspace 路径，先使用 PilotDeck 的 `read_file` 读取图片；不要只评审 Tool 返回的临时 URL 文本。
- 如果图片无法读取、分辨率不足以判断或内容缺失，标记为 `无法确认`，不得猜测分数。
- 不得根据文件名、Prompt 或图片 URL 猜测画面内容。

如果同时有多张图片，必须区分待评图片和参考图片，不得把参考图当成待评结果。

## 评审模式

### 模式 A：单图质量

没有目标描述和参考图时：

| 维度 | 权重 |
|---|---:|
| 主体与结构正确性 | 25 |
| 构图与视觉层级 | 20 |
| 清晰度与细节质量 | 20 |
| 风格与画面协调性 | 15 |
| 缺陷控制与可用性 | 20 |

### 模式 B：目标契合度

有目标描述或 `SceneSpec` 时：

| 维度 | 权重 |
|---|---:|
| 目标契合度 | 25 |
| 主体与内容准确性 | 20 |
| 构图与使用场景 | 15 |
| 清晰度与细节质量 | 15 |
| 风格与画面协调性 | 10 |
| 缺陷控制与可用性 | 15 |

### 模式 C：参考一致性

有参考图时：

| 维度 | 权重 |
|---|---:|
| 参考主体与身份一致性 | 30 |
| 内容与结构准确性 | 20 |
| 构图与空间关系 | 15 |
| 色彩与风格一致性 | 15 |
| 关键细节保留度 | 10 |
| 缺陷控制与可用性 | 10 |

### 模式 D：目标与参考联合评审

同时存在目标描述和参考图时，分别检查：

```text
目标契合度
参考一致性
主体与结构
构图与空间关系
缺陷控制与可用性
```

用户明确的硬性要求优先于参考图中的非硬性细节。总权重必须为 100。

## 检查维度

逐项检查：

- 主体数量、身份、外貌和完整性。
- 姿态、动作、视线和人物关系。
- 人脸、手指、肢体、物体连接和透视关系。
- 物体数量、位置、形态和材质。
- 裁切、留白、主体位置、视线引导和视觉层级。
- 场景、时间、天气和环境关系。
- 清晰度、纹理、边缘、光影、色彩和噪点。
- 风格是否统一，是否存在局部画风或材质漂移。
- 重复物体、穿模、悬浮、乱码、错误文字和水印。
- 是否出现影响语义的意外内容。
- 是否适合声明的最终用途。

每个维度必须包含：

- `score`：0–100。
- `weight`：权重。
- `weighted_points`：`score × weight ÷ 100`。
- `evidence`：至少一条具体可见证据。
- `deduction`：扣分原因；无扣分写“无明显扣分项”。

证据必须包含位置、数量、形态或颜色，不要使用“整体还可以”等空泛描述。

## 分数与通过条件

```text
total_score = sum(weighted_points)
```

总分保留一位小数：

| 总分 | 等级 | 含义 |
|---:|---|---|
| 90–100 | A | 质量优秀，可直接使用 |
| 80–89.9 | B | 整体可用，建议轻微优化 |
| 70–79.9 | C | 基本可用，但存在明显问题 |
| 60–69.9 | D | 需要较大修改 |
| 0–59.9 | E | 不建议交付 |

默认达标线为 85，除非输入指定其他值：

```text
pass = hard_constraints_pass
       AND total_score >= acceptance_threshold
       AND critical_failures == 0
```

硬性要求失败时，即使总分高，也必须判定为未通过。

## 建议边界

可以输出问题的修复方向，但不要输出完整的下一版 Prompt。

每条问题应包含：

- `requirement`：违反的要求。
- `status`：`passed`、`failed` 或 `uncertain`。
- `observation`：看到了什么。
- `severity`：`critical`、`major` 或 `minor`。
- `confidence`：0–1。
- `recommended_fix`：简短修复方向，交给 Reviser 使用。

## 固定输出格式

只输出一个有效 JSON 对象，不要使用 Markdown 代码围栏，不要附加解释。

保存 `evaluation.json` 时使用 PilotDeck 的 `write_file`，不要通过 Bash/PowerShell 的字符串拼接或 `echo` 构造 JSON。JSON 字符串中禁止出现未转义的真实换行；多行证据必须拆成数组元素，或将换行写成 `\\n`。写入后先确认 JSON 可解析，再继续交接：

```json
{
  "scene_id": "scene-001",
  "iteration": 1,
  "image_path": "scenes/scene-001/iterations/01/image.jpg",
  "mode": "goal_comparison",
  "dimensions": [],
  "requirements": [],
  "correct_elements": [],
  "unexpected_content": [],
  "physical_errors": [],
  "total_score": 78.0,
  "grade": "C",
  "acceptance": {
    "threshold": 85,
    "critical_failures": 1,
    "passed": false
  },
  "hard_constraints_pass": false,
  "pass": false,
  "delivery_recommendation": "未通过，需要修改后重新生成",
  "suggestions": []
}
```

评审完成后，将结构化结果保存为与图片相同的迭代目录中的 `evaluation.json`，供前端和后续 Reviser 使用。
