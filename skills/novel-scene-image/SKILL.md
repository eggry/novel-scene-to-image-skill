---
name: novel-scene-image
description: 将小说或剧情片段转换为图片，并通过生成、视觉评审和 Prompt 修订形成可追踪的自我改进循环。负责编排 novel-scene-to-prompt、generate_image、scene-image-critic 和 image-quality-refiner，不直接实现图片 API 或修改 PilotDeck AgentLoop。
---

# Novel Scene Image

## 目标

这是一个可追踪的 Self-Refining Novel-to-Image Agent：

小说段落
→ SceneSpec
→ Prompt v1
→ Image v1
→ Evaluation v1
→ Prompt Revision
→ Image v2
→ Evaluation v2
→ Accepted / Failed

不要把它实现成一次性的“小说到图片”请求。

## 组件边界

novel-scene-to-prompt：
负责小说文本、SceneSpec、首版 generation_prompt 和 generation_request；不生成图片、不评审图片、不生成下一版 Prompt。

generate_image：
负责调用图片生成服务，保存图片和 generation.json；不负责 Prompt 优化、图片评价或迭代策略。

scene-image-critic：
负责实际读取并查看图片，对照 SceneSpec 输出 EvaluationReport；不生成图片、不改写完整 Prompt。

image-quality-refiner：
负责读取 EvaluationReport，锁定正确内容，生成下一版 Prompt 和 generation_request；不重新评分、不宣布达标。

如果 MCP 工具被 PilotDeck 命名空间包装，实际名称可能是：
mcp__seedream__generate_image
以当前会话实际暴露的 Tool 为准。

## 输入

接收：

- 小说段落或剧情文本。
- 图片用途。
- 角色、场景和风格设定。
- 参考图片及其职责。
- 必须出现和必须避免的内容。
- 图片尺寸。
- 最大迭代次数。
- 达标分数。
- 预算或超时限制。

默认值：

- max_iterations：4
- acceptance_threshold：85
- size：2K
- mode：text_to_image
- response_format：url
- watermark：false

如果用户没有明确授权生成图片，只输出 Prompt 或询问是否生成，不调用计费 Tool。

## 运行上下文

开始运行时固定：

- workspace_root：当前 PilotDeck 项目的绝对路径。
- scene_id：稳定场景 ID，例如 scene-001。
- iteration：当前图片轮次，从 1 开始。
- max_iterations：最大轮次。
- acceptance_threshold：达标分数。

规则：

- 不创建新的 Workspace。
- 不把图片保存到插件目录或系统临时目录。
- 所有迭代使用同一个 workspace_root 和 scene_id。
- 下一轮只递增 iteration。
- 不把 API Key、Gateway Token 或其他凭据写入 Artifact。
- 如果 workspace_root 缺失，先停止，不调用 generate_image。

## Workspace Artifact 结构

<workspace_root>/scenes/<scene_id>/

- source.txt
- scene-spec.json
- iterations/01/prompt.txt
- iterations/01/image.jpg
- iterations/01/generation.json
- iterations/01/evaluation.json
- iterations/01/revision.json
- iterations/02/...
- result.json

Tool 负责保存：

- prompt.txt
- image.jpg 或 image-01.jpg
- generation.json

Main Agent 负责保存：

- source.txt
- scene-spec.json
- evaluation.json
- revision.json
- result.json

所有模块都使用同一个 workspace_root 和 scene_id。

## 阶段 0：初始化

1. 确认当前 Workspace 根目录。
2. 创建或确认 scene_id。
3. 将原始小说段落保存为 source.txt。
4. 读取已有场景 Artifact。
5. 确定当前 iteration、max_iterations 和 acceptance_threshold。

不要让 Tool 自己猜 Workspace。

## 阶段 1：场景理解

使用 novel-scene-to-prompt 的方法生成严格 JSON：

- scene_spec
- generation_prompt
- generation_request

校验：

- must_have 覆盖剧情关键视觉要求。
- generation_prompt 可以独立使用。
- generation_request.prompt 与 generation_prompt 一致。
- generation_request.workspace_root、scene_id、iteration 正确。

保存：

- scene-spec.json
- iterations/<NN>/prompt.txt

## 阶段 2：图片生成

将 generation_request 交给 generate_image。

请求至少包含：

- tool_name：generate_image
- mode
- prompt
- images
- size
- sequential
- max_images
- scene_id
- iteration
- workspace_root
- response_format
- watermark

要求：

- Tool 返回至少一个图片结果。
- Tool 将图片保存到当前迭代目录。
- Tool 返回 local_path 和 generation.json 路径。
- 如果只返回临时 URL，先下载保存，再进入评审。
- 生成失败时保存 generation-error.json，不得进入 Critic。

## 阶段 3：图片评审

将以下内容交给 scene-image-critic：

- scene_spec
- generation_prompt
- image 的 local_path 或内联图片内容
- 原始目标
- 参考图及参考图职责
- 当前 iteration
- acceptance_threshold

Critic 必须实际查看图片：

- 有内联图片时直接查看。
- 只有 local_path 时使用 read_file 读取图片。
- 图片无法读取时停止，不得猜测评分。

将结果保存为：

iterations/<NN>/evaluation.json

保存结构化 JSON 时使用 `write_file`，不要使用 Bash/PowerShell 字符串拼接。JSON 字符串不能包含未转义的真实换行；多行观察记录和证据应使用数组。写入后先确认文件可以被 JSON 解析，再进入下一阶段。

## 阶段 4：判断是否接受

只有满足以下条件才接受：

pass == true
AND hard_constraints_pass == true
AND total_score >= acceptance_threshold
AND critical_failures == 0

接受时：

1. 选择当前或历史最高分图片。
2. 写入 result.json。
3. 设置 status 为 accepted。
4. 停止调用图片 Tool。

## 阶段 5：修订

如果未通过且仍有剩余轮次，将以下内容交给 image-quality-refiner：

- scene_spec
- generation_prompt
- evaluation.json
- 当前图片 local_path
- scene_id
- iteration
- workspace_root
- 剩余轮次和预算

Refiner 必须输出：

- decision
- locked_constraints
- fix_targets
- revised_prompt
- generation_request
- target_iteration

校验：

- target_iteration == iteration + 1。
- generation_request.prompt == revised_prompt。
- workspace_root 不变。
- scene_id 不变。
- generation_request 使用正确的 mode。
- edit_image 使用上一轮图片。
- regenerate_image 不复制已确认的错误结构。

保存：

iterations/<NN>/revision.json

然后回到阶段 2。

## 停止条件

满足任一条件时停止：

- 图片通过硬性验收和分数验收。
- 达到 max_iterations。
- 达到预算或超时限制。
- 连续两轮总分没有提升。
- 图片生成 Tool 连续失败。
- Critic 无法读取图片。
- 用户要求停止。
- Refiner 返回 prompt_only 且用户没有授权继续生成。

result.json 至少记录：

- scene_id
- status：accepted、failed 或 stopped
- stop_reason
- workspace_root
- iterations_completed
- best_iteration
- best_score
- acceptance_threshold
- hard_constraints_pass
- final_image_path
- final_evaluation_path
- score_history

## 失败处理

Tool 失败：

- 保存 generation-error.json。
- 停止当前轮次。
- 不伪造图片路径或评分。

Critic 失败：

- 保存 evaluation-error.json。
- 不进入 Refiner。

Refiner 输出不完整：

- 不调用图片 Tool。
- 报告缺失字段。

Workspace 路径不一致：

- 停止流程。
- 保留已有 Artifact。
- 要求恢复正确的 workspace_root。

## 统一 generation_request 契约

{
  "tool_name": "generate_image",
  "mode": "text_to_image|image_to_image|multi_image_fusion|group_image",
  "prompt": "完整可执行 Prompt",
  "images": [],
  "size": "1K|2K|4K|WIDTHxHEIGHT",
  "sequential": false,
  "max_images": 1,
  "scene_id": "scene-001",
  "iteration": 1,
  "workspace_root": "绝对路径",
  "response_format": "url|b64_json",
  "watermark": false
}

## 统一 generation_result 契约

{
  "scene_id": "scene-001",
  "iteration": 1,
  "mode": "text_to_image",
  "model": "Doubao-Seedream-4.0",
  "prompt": "完整 Prompt",
  "workspace_root": "绝对路径",
  "images": [
    {
      "index": 1,
      "local_path": "scenes/scene-001/iterations/01/image.jpg",
      "url": "https://temporary-url"
    }
  ],
  "generated_images": 1,
  "metadata_path": "scenes/scene-001/iterations/01/generation.json"
}

## Gateway 可观测性

Gateway 事件用于实时展示：

- turn_started
- tool_call_started
- tool_call_finished
- file_artifacts
- context_budget
- turn_completed
- error

业务阶段从 Artifact 推导：

- scene-spec.json：scene_analysis
- prompt.txt：prompt_generated
- generation.json：image_generation
- evaluation.json：image_evaluation
- revision.json：prompt_revision
- result.json status=accepted：accepted

不要假设 Gateway 一定提供 skill_started、skill_finished、critic_started 或 revision_started。

如果前端需要完整业务时间线，使用：

GatewayEvent + Workspace Artifact

## 运行边界

- 不绕过 PilotDeck Gateway 直接调用主 LLM。
- 不修改 src/agent/loop/AgentLoop.ts。
- 不实现 invokeSkill()。
- 不把 Critic 和 Reviser 合并。
- 不把图片生成逻辑写入 Skill。
- 不把评分结果写入 Memory 代替 Artifact。
- 不在没有图片证据时猜测质量。
- 不把旧轮次已经确认的错误复制到新 Prompt。

## 用户可见结果

完成后用简短文字报告：

场景：scene-001
状态：Accepted / Failed / Stopped
迭代：2
最佳评分：91.5
最终图片：<local_path>

详细过程由 Workspace Artifact 和 Gateway 事件提供给可视化前端。
