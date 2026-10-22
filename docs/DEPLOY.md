# WCcanvastv 部署说明（给 AI 助手读）

> 把这份文件交给你的 AI 编程助手（Claude Code、ChatGPT / Codex 等），对它说：
> **「按 docs/DEPLOY.md 在这台 Mac 上部署 WCcanvastv，每一步做完都按『检查』验证，遇到失败先读日志再重试。」**
>
> 安装包和代码里**不包含任何大模型**。模型都从官方地址（或国内镜像）下载到本机，下面写明了每个的来源和存放位置。

## 0. 环境要求

- Apple 芯片 Mac（M1 及以后），macOS 13 以上；建议 16 GB 以上内存
- 磁盘：应用约 300 MB；全部本地引擎约 20 GB（可按需只装一部分）
- 网络：能访问 GitHub。无法访问 huggingface.co / npmjs.org / nodejs.org 时，下面每一步都给了国内镜像

## 1. 安装应用

```bash
cd ~/Downloads
curl -fL -o WCcanvastv-mac-arm64.zip https://github.com/15250055064/wctv/releases/latest/download/WCcanvastv-mac-arm64.zip
ditto -x -k WCcanvastv-mac-arm64.zip /Applications
xattr -dr com.apple.quarantine /Applications/WCcanvastv.app   # 未签名应用，去掉隔离标记
open /Applications/WCcanvastv.app
```

**检查**：`curl -s http://localhost:5174/api/engines` 返回 JSON。

素材和项目保存在 `~/Movies/WCcanvastv/`；本地引擎和模型保存在 `~/Library/Application Support/WCcanvastv/engines/`。

## 2. 连接 AI 应用（至少一个）

WCcanvastv 不用 API Key，而是调用本机已登录的 AI 应用：

| 应用 | 用途 | 安装与登录 | 检查 |
| --- | --- | --- | --- |
| ChatGPT 桌面版 | 文本、图片、视频玩法 | 从 https://openai.com/chatgpt/download 安装并登录（自带 Codex 命令行） | `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex login status` 显示 Logged in |
| Claude Code | 文本、视频玩法（推荐） | `curl -fsSL https://claude.ai/install.sh \| bash`，然后在终端运行 `claude` 按提示登录 | `claude auth status` 里 `loggedIn: true` |
| DeepSeek（官方 API） | 文本（不能看图、不能生图）、视频玩法 | 不用装任何软件：用户在 [platform.deepseek.com](https://platform.deepseek.com/api_keys) 创建 API Key，在 WCcanvastv 右上角点「DeepSeek」粘贴（AI 助手不要代填密钥，请让用户自己粘贴） | 点「测试连接」显示连接成功 |

**检查**：`curl -s http://localhost:5174/api/engines` 里对应应用的 `available` 和 `loggedIn` 都是 `true`。

## 3. 本地引擎（按需安装）

最简单：打开 WCcanvastv → 右上角「**本地引擎**」→ 点「一键安装」，进度和日志都在窗口里，失败可以重试。
也可以用接口触发并轮询（与按钮完全相同）：

```bash
curl -X POST http://localhost:5174/api/local-engines/tts/install      # 配音
curl -X POST http://localhost:5174/api/local-engines/music/install    # 音乐
curl -X POST http://localhost:5174/api/local-engines/studio/install   # 视频制作
curl -s http://localhost:5174/api/local-engines                       # 看 installed / installing / error / log
```

一键安装失败时，按下面的手动步骤做（以下路径简写 `E=~/Library/Application\ Support/WCcanvastv/engines`）。

### 3.1 配音：Qwen3-TTS（约 4 GB，Apache-2.0）

```bash
E=~/Library/Application\ Support/WCcanvastv/engines
mkdir -p "$E/bin" && curl -fsSL https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-apple-darwin.tar.gz | tar -xz -C "$E/bin" --strip-components 1
export UV_CACHE_DIR="$E/cache" UV_PYTHON_INSTALL_DIR="$E/python" HF_HOME="$E/hf"
# 无法访问 huggingface.co 时：export HF_ENDPOINT=https://hf-mirror.com
"$E/bin/uv" venv --python 3.12 "$E/tts/.venv"
"$E/bin/uv" pip install --python "$E/tts/.venv/bin/python" mlx-audio
"$E/tts/.venv/bin/python" -c "from huggingface_hub import snapshot_download; snapshot_download('mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit')"
```

声音克隆第一次使用时，会自动再下载 `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit` 和 `mlx-community/whisper-large-v3-turbo-asr-fp16`（同样存放在 `$E/hf`）。

**检查**：`$E/tts/.venv/bin/python` 存在，且 `$E/hf/hub/models--mlx-community--Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit/snapshots/*/config.json` 存在。

### 3.2 音乐：ACE-Step 1.5（约 15 GB，MIT）

```bash
E=~/Library/Application\ Support/WCcanvastv/engines   # uv 同 3.1
curl -fL -o "$E/ace-step.zip" https://github.com/ace-step/ACE-Step-1.5/archive/refs/heads/main.zip
unzip -q -o "$E/ace-step.zip" -d "$E" && mv "$E/ACE-Step-1.5-main" "$E/music" && rm "$E/ace-step.zip"
cd "$E/music" && "$E/bin/uv" sync && "$E/bin/uv" run acestep-download   # 自动选择 HuggingFace 或 ModelScope
date > "$E/music/.wccanvastv-ready"
```

运行时由 WCcanvastv 自己启动（`uv run acestep-api --port 8001`，固定使用 1.7B 歌词模型）。

**检查**：`$E/music/.wccanvastv-ready` 存在；在应用里生成一段音乐。

### 3.3 视频制作：HyperFrames（约 500 MB，Apache-2.0）

```bash
E=~/Library/Application\ Support/WCcanvastv/engines
# Node 22（HyperFrames 需要）；国内可把 https://nodejs.org/dist 换成 https://npmmirror.com/mirrors/node
mkdir -p "$E/node" && curl -fsSL https://nodejs.org/dist/v22.23.4/node-v22.23.4-darwin-arm64.tar.gz | tar -xz -C "$E/node" --strip-components 1
mkdir -p "$E/studio" && cd "$E/studio"
cat > package.json <<'JSON'
{ "name": "wccanvastv-studio", "private": true,
  "dependencies": { "hyperframes": "0.8.185", "gsap": "3.14.2", "@ffprobe-installer/darwin-arm64": "5.0.1" } }
JSON
export PATH="$E/node/bin:$PATH" HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_NO_TELEMETRY=1
npm install --no-audit --no-fund          # 国内加 --registry https://registry.npmmirror.com
mkdir -p bin && ln -sf "$E/studio/node_modules/@ffprobe-installer/darwin-arm64/ffprobe" bin/ffprobe
ln -sf /Applications/WCcanvastv.app/Contents/Resources/app/bin/ffmpeg bin/ffmpeg
node_modules/.bin/hyperframes browser ensure      # 下载渲染用的 Chrome（约 200 MB，存于 ~/.cache/hyperframes）
node_modules/.bin/hyperframes telemetry disable
node_modules/.bin/hyperframes init template --non-interactive --example blank
date > .wccanvastv-ready
```

`HYPERFRAMES_SKIP_SKILLS=1` 很重要：不让 HyperFrames 往全局 `~/.claude` 等目录安装技能；WCcanvastv 会把技能只放进每次制作的文件夹里。

**检查**：`$E/studio/.wccanvastv-ready` 存在；在应用里新建「视频玩法」节点做一条 10 秒的片子。

### 3.4 视觉模型（自动，无需操作）

- 深度提取用的 Depth Anything V2 Small（约 47 MB，Apache-2.0）：第一次使用时由应用从 `huggingface.co/onnx-community/depth-anything-v2-small`（失败则 `hf-mirror.com`）下载到 `$E/vision/`
- 动作捕捉用的 MediaPipe Pose（约 9 MB，Apache-2.0）随应用附带

## 4. 从源码构建（可选）

```bash
git clone https://github.com/15250055064/wctv.git && cd wctv
npm install
npm run app        # 生成 release/WCcanvastv-darwin-arm64/WCcanvastv.app
```

开发时 `npm run dev`（前端）+ `node server/index.mjs`（本地服务，端口 5174）。

## 5. 常见问题

- **端口 5174 被占用**：WCcanvastv 可能已经在运行，先退出再打开。
- **ChatGPT / Claude 显示未登录**：按第 2 步登录后，等 20 秒或重开应用。
- **DeepSeek 报「需要 API Key」/「Key 无效」/「余额不足」**：在 WCcanvastv 右上角点「DeepSeek」填入或更换 API Key（保存在 `~/Library/Application Support/WCcanvastv/secrets.json`，权限 600，只发给 api.deepseek.com）；余额在 platform.deepseek.com 充值。
- **视频玩法用 ChatGPT 时**：Codex 的沙箱里不能启动 Chrome，WCcanvastv 会在 AI 写完后自己渲染，属正常现象。
- **下载很慢 / 失败**：配置代理，或按上面每一步的国内镜像重试；日志在「本地引擎」窗口里。
