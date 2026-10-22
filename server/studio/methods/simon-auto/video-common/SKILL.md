---
name: video-common
description: 各账号视频流水线共用的四道工序（事实核查与来源台账、AI 封面比例验收、平台文案机制、成片机器验收与交付边界、合规自查）。不直接触发；由各账号 skill（如本仓库的 investigation-video-skill）在对应环节引用。音色、字幕样式、品牌、时长、口吻、平台集合都不在这里，留在各账号 skill。
---

# video-common —— 账号无关的公共工序

只收"换个账号做法也不变"的东西。下面五份按需读，每份都短：

| 环节 | 文件 | 谁在用 |
|---|---|---|
| 事实核查、来源台账、估算标注 | [fact-check.md](references/fact-check.md) | 四条线 |
| AI 封面 3:4 / 4:3 的比例与验收 | [cover-qa.md](references/cover-qa.md) | 调查长片、AI 讲解片（白板用 Excalidraw 封面、历史九宫格单张 cover.png，不适用） |
| 多平台发布文案的机制 | [platform-copy.md](references/platform-copy.md) | 调查长片、AI 讲解片；白板只取"标题不承诺正文没答的事"与"只备稿不发布" |
| 成片机器验收、交付边界 | [delivery-qa.md](references/delivery-qa.md) | 四条线 |
| 合规自查 | [compliance.md](references/compliance.md) | 四条线 |

## 明确不共用（各账号自己定）

- 配音：引擎、音色 ID、语速、缓存键。白板是火山克隆音 1.2 倍；AI 讲解片是克隆旁白；历史九宫格默认东方浩然2.0 +20；调查长片沿用各期已确认音色。
- 字幕：切句长度、字体、位置、是否烧录。
- 品牌层、视觉语言、封面的画面风格。
- 时长目标、叙事结构、素材策略、动画机制、口吻。
- 平台集合、固定话题、CTA 措辞、打包格式、知识库归档方式。

改公共工序改这里，四条线自动生效；改某账号口味回各自 skill。
