# Seedream 图片生成

使用 `generate_image` 调用 Paratera 的 `Doubao-Seedream-4.0`。

## 模式选择

- 文生图：`mode=text_to_image`，不要传 `images`。
- 图生图：`mode=image_to_image`，传一张 `images`。
- 多图融合：`mode=multi_image_fusion`，传两张或更多 `images`，在提示词中说明图1、图2的用途。
- 组图：`mode=group_image` 或 `sequential=true`，设置 `max_images`，需要连续或关联画面时使用。

## 参数建议

- 默认使用 `size=2K`；快速测试可以使用 `1K`。
- `max_images` 取 1 到 15，仅组图模式使用。
- `response_format` 默认使用 `url`。
- 图片 URL 必须能被 API 服务端访问；本地文件需要先转为 Base64 Data URI。
- 必须传入当前 PilotDeck 项目的 `workspace_root`、`scene_id` 和 `iteration`，Tool 会把图片和 `generation.json` 保存到 Workspace。
- 生成图片会产生费用，只有用户明确要求生成时才调用工具。
