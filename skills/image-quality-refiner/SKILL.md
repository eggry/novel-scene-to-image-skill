---
name: image-quality-refiner
description: 读取 scene-image-critic 的 EvaluationReport，锁定已经通过的内容，决定局部编辑或重新生成，并输出可以直接交给 generate_image Tool 的下一轮 generation_request。只负责修复计划，不负责重新评审或宣布达标。
---

# Image Quality Refiner

## 职责

```text
SceneSpec + 当前 Prompt + EvaluationReport
→ RevisionDecision + generation_request
```

负责读取上一轮评审、锁定正确内容、提取失败项、选择返工方式、生成下一版 Prompt 和下一轮图片请求。

不负责生成图片、重新评分、改变评分标准、宣布达标或控制无限循环。

## 输入契约

必需字段：

- `scene_spec`
- `generation_prompt`
- 上一轮 `EvaluationReport`
- `scene_id`
- `iteration`
- `workspace_root`

评审报告至少应包含：`pass`、`total_score`、`hard_constraints_pass`、`requirements` 和 `suggestions`。

缺少评审证据、图片无法读取或报告结构不完整时，不得猜测，停止并要求先完成有效评审。

## 启动条件

- `pass=true` 且硬性要求通过：输出 `accept`，不再返工。
- 总分低于达标线：进入优化。
- 任一硬性要求失败：进入优化。
- 只有主观结论、没有画面证据：停止。

默认达标线为 85，除非输入指定其他值。

## 返工方式

### `prompt_only`

只输出下一版 Prompt，不调用图片 Tool。

### `edit_image`

适用于单个物体、颜色、材质、光线、手部或边缘等局部问题，同时保留主体和构图。

对应图片 Tool 请求：

```json
{
  "tool_name": "generate_image",
  "mode": "image_to_image",
  "images": ["上一轮图片的 local_path"]
}
```

### `regenerate_image`

适用于主体数量、身份、关键动作、构图或多个硬性条件错误。

对应图片 Tool 请求：

```json
{
  "tool_name": "generate_image",
  "mode": "text_to_image",
  "images": []
}
```

### `auto`

1. 一个局部问题且主要维度通过：`edit_image`。
2. 多个 P0、主体错误或硬性条件失败：`regenerate_image`。
3. 没有生成授权或 Tool 不可用：`prompt_only`。

必须说明选择理由。

## 修改原则

把内容分为：

```text
locked：上一轮已通过，必须保留
fix：本轮要修复
flexible：允许调整
```

每轮优先处理 1–2 个最高严重度问题。只修改失败部分，不重写已经正确的要求。

新版 Prompt 必须保留原始目标、SceneSpec 硬性要求、锁定项、本轮修复动作和必要的避免项。

## Workspace 契约

所有迭代必须使用同一个 `workspace_root` 和 `scene_id`。

下一轮目录固定为：

```text
<workspace_root>/scenes/<scene_id>/iterations/<NN>/
```

`NN` 是目标迭代编号，两位数字，例如 `02`。不要创建新的 Workspace，不要把结果保存到插件目录或系统临时目录。

## 固定输出格式

只输出一个有效 JSON 对象，不要使用 Markdown 代码围栏：

```json
{
  "scene_id": "scene-001",
  "source_iteration": 1,
  "target_iteration": 2,
  "decision": "regenerate_image",
  "decision_reason": "关键动作和视线同时违反硬性要求",
  "locked_constraints": ["夜晚图书馆", "暖色台灯"],
  "fix_targets": ["人物必须低头阅读", "人物不得直视镜头"],
  "prompt_changes": {
    "added": [],
    "strengthened": [],
    "removed": [],
    "locked": []
  },
  "revised_prompt": "完整新版 Prompt",
  "generation_request": {
    "tool_name": "generate_image",
    "mode": "text_to_image",
    "prompt": "与 revised_prompt 完全一致",
    "images": [],
    "size": "2K",
    "sequential": false,
    "max_images": 1,
    "scene_id": "scene-001",
    "iteration": 2,
    "workspace_root": "当前 Workspace 根目录",
    "response_format": "url",
    "watermark": false
  },
  "next_skill": "scene-image-critic",
  "next_action": "re_evaluate"
}
```

`generation_request` 只描述下一步，不代表图片已经生成或通过评审。
