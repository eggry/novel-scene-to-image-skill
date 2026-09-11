---
name: novel-scene-to-prompt
description: 将小说段落、剧情描述或视觉需求解析为结构化 SceneSpec，并生成可直接交给图片生成 Tool 的完整 Prompt。只负责场景理解和首版 Prompt，不调用图片生成、不评审图片、不修改后续 Prompt。
---

# Novel Scene to Prompt

## 职责

将用户输入的小说段落或画面需求转换为：

```text
小说文本 → SceneSpec → generation_request
```

只负责：

- 阅读并理解输入文本。
- 提取可视化的场景信息。
- 区分明确事实、项目设定和合理补全。
- 提取人物、动作、地点、时间、天气、道具、空间关系和氛围。
- 识别必须满足、必须避免和可以灵活处理的内容。
- 生成一条可以独立使用的完整生图 Prompt。

不负责：

- 调用图片生成 Tool。
- 读取或评价生成图片。
- 判断图片是否达标。
- 生成第二版 Prompt。
- 控制迭代循环。

## 输入

可以接收：

- 小说段落。
- 剧情梗概。
- 用户的自然语言画面需求。
- 项目已有角色、场景和风格设定。
- 图片用途，例如插画、封面、视频首帧或海报。

信息优先级：

1. 用户本次明确要求。
2. 当前项目已有设定。
3. 不改变核心事实的合理视觉补全。

只有缺失信息会明显影响画面时，才提出问题。普通机位、背景细节和光线可以合理补全，但不能擅自改变人物身份、剧情事实、产品特征或指定文字。

## SceneSpec 提取规则

至少检查以下内容：

- `characters`：人物数量、身份、外貌、服装、姿态和视线。
- `environment`：地点、时代、时间、天气和背景。
- `actions`：主体正在做什么。
- `objects`：书、灯、门、车辆等关键道具。
- `spatial_relations`：人物、物体和环境之间的位置关系。
- `atmosphere`：情绪、气氛和环境感受。
- `style_requirements`：用户明确指定的媒介、风格和材质。
- `must_have`：后续评审必须检查的视觉要求。
- `must_avoid`：必须避免的内容。
- `flexible`：可以自由发挥的内容。

不要把推测内容伪装成原文事实。明显影响结果的补全放入 `assumptions`。

## Prompt 编写规则

按照任务需要组织：

```text
主体与关键特征
→ 动作与状态
→ 场景与空间关系
→ 构图与视角
→ 风格与材质
→ 光线与色彩
→ 用途和版式
→ 必要限制
```

要求：

- 明确人物数量、位置、朝向和动作。
- 明确重要空间关系，例如“人物坐在窗边，书放在双手之间，门位于人物身后”。
- 不机械堆叠“顶级、完美、超高质量”等空泛词。
- 不主动添加文字、品牌、水印或 Logo。
- 用户要求精确文字时，原样保留并注明位置。
- 多图或分镜时，每条 Prompt 必须能独立使用。

## 与图片生成 Tool 的交接

完成后不要调用 Tool，输出 `generation_request` 供主 Agent 交给当前可用的图片生成 Tool。

```json
{
  "mode": "text_to_image",
  "prompt": "generation_prompt 的完整内容",
  "images": [],
  "size": "2K",
  "max_images": 1,
  "response_format": "url",
  "watermark": false
}
```

如果 PilotDeck 使用 MCP，工具名称可能被命名空间包装，例如：

```text
mcp__seedream__generate_image
```

不要假设存在 `invokeSkill()` 或固定 Tool 名称，以当前会话实际暴露的 Tool 为准。

## 固定输出格式

只输出一个有效 JSON 对象，不要使用 Markdown 代码围栏，不要附加解释：

```json
{
  "scene_id": "scene-001",
  "source_text": "原始小说段落或需求摘要",
  "request_summary": "本次画面的简短概括",
  "assumptions": [],
  "scene_spec": {
    "characters": [],
    "environment": {},
    "actions": [],
    "objects": [],
    "spatial_relations": [],
    "atmosphere": "",
    "style_requirements": [],
    "must_have": [],
    "must_avoid": [],
    "flexible": []
  },
  "generation_prompt": "可以独立交给生图模型的完整 Prompt",
  "generation_request": {
    "tool_name": "generate_image",
    "mode": "text_to_image",
    "prompt": "与 generation_prompt 完全一致",
    "images": [],
    "size": "2K",
    "max_images": 1,
    "sequential": false,
    "scene_id": "scene-001",
    "iteration": 1,
    "workspace_root": null,
    "response_format": "url",
    "watermark": false
  }
}
```

`workspace_root` 不由本 Skill 猜测。主 Agent 调用图片 Tool 前，必须填入当前 PilotDeck 项目的实际 Workspace 根目录；Tool 会在该目录下保存图片和生成元数据。

## 输出前检查

- `scene_spec.must_have` 是否覆盖后续评审要求？
- `generation_prompt` 是否与 `scene_spec` 一致？
- `generation_request.prompt` 是否与 `generation_prompt` 完全一致？
- 是否擅自改变了剧情事实？
- 是否加入了用户没有要求的文字、Logo 或水印？
- JSON 是否有效，没有注释、尾逗号或 Markdown 围栏？

## 反馈边界

收到图片评审结果时，只保留原始场景设定和本次生成信息，交给独立的 `image-prompt-reviser` 处理。不要在本 Skill 中生成下一版 Prompt。
