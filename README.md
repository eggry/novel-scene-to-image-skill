# PilotDeck Novel-to-Image

## 导入 Skills

将 `skills` 下的 Skill 目录复制到 PilotDeck 用户 Skill 目录：

```text
%USERPROFILE%\.pilotdeck\skills\
```

需要复制：

```text
novel-scene-to-prompt
scene-image-critic
image-quality-refiner
novel-scene-image
```

每个目录必须保留文件名：

```text
SKILL.md
```

## 导入图片 Tool

将下面目录复制到：

```text
%USERPROFILE%\.pilotdeck\plugins\seedream\
```

```text
plugins/seedream/
├── plugin.json
├── server.mjs
└── skills/seedream/SKILL.md
```

然后在 PilotDeck 的「设置 → MCP 服务器 → 全局配置」中加入：

```json
{
  "mcpServers": {
    "seedream": {
      "command": "C:\\Program Files\\PilotDeck\\resources\\node\\node.exe",
      "args": [
        "${userHome}/.pilotdeck/plugins/seedream/server.mjs"
      ],
      "env": {
        "PARATERA_API_KEY": "${env:PARATERA_API_KEY}"
      },
      "perSession": true,
      "callTimeoutMs": 300000
    }
  }
}
```

如果 PilotDeck 的发布版已自动发现插件，则无需重复添加 MCP 配置。

Tool 的逻辑名称：

```text
generate_image
```

PilotDeck MCP 中的实际名称通常是：

```text
mcp__seedream__generate_image
```

## 配置 API Key

使用自己的 Paratera API Key，并设置环境变量：

```powershell
[Environment]::SetEnvironmentVariable(
  "PARATERA_API_KEY",
  "你的API Key",
  "User"
)
```

设置后重启 PilotDeck，并新建聊天会话。

## 使用

```text
请使用 mcp__seedream__generate_image 生成一张赛博朋克风格的上海夜景，尺寸使用 1K。
```

Tool 会把图片保存到当前 Workspace：

```text
scenes/<scene_id>/iterations/<NN>/
```

## 安全说明

- 不要把 API Key 写入仓库、Skill 或 `plugin.json`。
- 不要分享 `%USERPROFILE%\.pilotdeck\mcp.json`。
- 临时图片 URL 可能会过期，优先使用 Workspace 中保存的图片。
