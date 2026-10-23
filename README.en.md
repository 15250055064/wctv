# WCcanvastv

[中文](README.md) · **English**

An AI creation canvas that runs locally on your Mac. Organise text, images and video as nodes on an infinite canvas: text is written by **ChatGPT** or **Claude Code** and images are made by **ChatGPT**, using the AI apps you're already signed in to on your computer — **no API key needed**. Uploads and results are kept on your disk, project by project.

**[⬇️ Download the latest version (Apple silicon Mac)](../../releases/latest/download/WCcanvastv-mac-arm64.zip)** · [All releases](../../releases)

## Intro video

[![WCcanvastv intro (click to watch)](docs/intro-cover.jpg)](https://github.com/15250055064/wctv/releases/download/v1.2.0/WCcanvastv-intro-1080p.mp4)

▶️ [Watch / download the intro video (1080p, about 74 s, in Chinese)](https://github.com/15250055064/wctv/releases/download/v1.2.0/WCcanvastv-intro-1080p.mp4): the canvas, no API keys, style and effect libraries, characters, toolbox, projects, autosave, the 3D director stage and the video tools.

> The app's interface is in Chinese. This page explains what everything does; the Chinese labels are given in brackets so you can find them.

---

## Contents

- [Requirements](#requirements)
- [Step 1: Install WCcanvastv](#step-1-install-wccanvastv)
- [Step 2: Set up ChatGPT](#step-2-set-up-chatgpt)
- [Step 3: Set up Claude Code (optional)](#step-3-set-up-claude-code-optional)
- [Using WCcanvastv](#using-wccanvastv)
- [FAQ](#faq)
- [Building from source](#building-from-source)

## Requirements

- macOS on **Apple silicon** (M1 / M2 / M3 / M4 …). Intel Macs aren't supported yet.
- At least one AI app, signed in:
  - **ChatGPT** (required, for text and images): a ChatGPT Plus or higher subscription
  - **Claude Code** (optional, for text and video methods): a Claude Pro / Max subscription
- Generation uses **your own account's quota**.

> **Let an AI set it up for you**: give [docs/DEPLOY.md](docs/DEPLOY.md) to your AI coding assistant (Claude Code, ChatGPT…) and say "deploy WCcanvastv on this Mac following docs/DEPLOY.md". It lists every download (the app, local engines, models), mirrors for mainland China, where files go, and how to check each step. The app itself contains no large models.

## Step 1: Install WCcanvastv

1. Download **[WCcanvastv-mac-arm64.zip](../../releases/latest/download/WCcanvastv-mac-arm64.zip)** and double-click to unzip it.
2. Drag **WCcanvastv.app** into Applications.
3. **First launch**: the app isn't signed by Apple, so double-clicking it says the developer can't be verified. Allow it once, in any of these ways:
   - In Applications, **right-click WCcanvastv → Open**, then click Open in the dialog; or
   - Open **System Settings → Privacy & Security**, find WCcanvastv at the bottom and click **Open Anyway**; or
   - In Terminal, run:

     ```bash
     xattr -dr com.apple.quarantine /Applications/WCcanvastv.app
     ```

   After that it opens normally.

Once open, the top right shows ChatGPT and Claude: a **green dot** means ready, a **yellow dot** means not installed or not signed in.

## Step 2: Set up ChatGPT

WCcanvastv reaches ChatGPT through OpenAI's **Codex command line**, signed in with your ChatGPT account (no API key). Either:

**Option A: the ChatGPT desktop app (includes Codex)**

1. Download the latest ChatGPT desktop app from [chatgpt.com/download](https://chatgpt.com/download) and move it to Applications.
2. Open it, sign in, then open Codex inside the app and sign in there too.

**Option B: the Codex command line on its own**

Install [Node.js](https://nodejs.org) (LTS), then in Terminal:

```bash
npm install -g @openai/codex
```

```bash
codex login
```

Choose "Sign in with ChatGPT" and finish in the browser.

Reopen WCcanvastv; ChatGPT at the top right turns green.

## Step 3: Set up Claude Code (optional)

1. In Terminal, run the official installer:

   ```bash
   curl -fsSL https://claude.ai/install.sh | bash
   ```

   (Or install [Node.js](https://nodejs.org) and run `npm install -g @anthropic-ai/claude-code`.)
2. Sign in to your Claude account in the browser:

   ```bash
   claude auth login
   ```

3. Reopen WCcanvastv; Claude at the top right turns green.

> Claude writes text only; it can't make images. Use ChatGPT for image nodes.

## Using WCcanvastv

### Projects

- The **project name** is at the top left: edit it and press Return to rename (the folder is renamed too).
- The **▾** next to it creates, opens and reveals projects. The File menu has New Project (⌘N) and Open Project (⌘O).
- Each project is a folder, `~/Movies/WCcanvastv/<project>/`, holding the canvas and all its files, sorted into `图片 / 视频 / 音频 / 其他` (pictures / videos / sound / other), with the date and time at the start of each file name.

### Generating

1. **Double-click the canvas** or press **Tab** to add a node: text, image, script and more.
2. Select it, type a prompt in the panel below, pick **ChatGPT** or **Claude Code**, and click ↑ or press **⌘↵**.
3. Drag from the **＋** on a node's right edge to another node to connect them: text upstream becomes context, pictures upstream become reference images.
4. Text takes about ten seconds and an image about a minute; the node shows progress.

### What connections do

Everything connected into a generation node (text / script / image) goes into what the AI receives:

| Connected | Effect |
| --- | --- |
| Text, script | Sent as reference text / storyboard |
| Image | Sent as a reference image |
| Video | A frame is taken and sent as a reference image |
| Style | Adds the style's visual requirements |
| Video method | Written the method's way (storyboard structure, visual rules, how to prompt) |
| Effect / camera move | Scripts and text plan shots with it; images show its moment in the composition |
| Character (or @name in the prompt) | Adds the character sheet and its picture (if made) |
| My preferences | Always placed first (on/off per ChatGPT / Claude) |
| Audio | Video-method nodes use it as voice or music; others ignore it |
| Reference node | Not used for generation |

**发送内容** (What's sent) in the prompt panel shows the full message and any unused connections before you generate; afterwards, the file icon in the node's toolbar shows what was actually sent.

Text, script, video-prompt and narration results come with **生成思路** (Reasoning): the AI explains, input by input, what it read and where it used it (or why not). Connected images are numbered 图片1, 图片2… so @图片N in a prompt always matches.

Text, script, video-prompt and voice nodes can be resized from their corners and edited directly.

### Length

Video prompts, music and video methods let you pick a length: **按文案** (from the text: the length the prompt asks for, or the AI decides), common lengths (10 / 15 / 30 / 60 s), or **自定义** (custom). Video prompts over 15 s are split into back-to-back prompts.

### Video prompts (Seedance 2.0)

Set a text node's type to **视频提示词** (video prompt) and it writes video-generation prompts with the [Seedance 2.0 prompting method](https://github.com/Emily2040/seedance-2.0) (MIT): a director's reading first (story / observation / feature demo), then one visible action per shot, one main camera move, physical light sources, sound intent and continuity locks. A connected storyboard gives one prompt per shot; connected reference images give image-to-video prompts that say what each @图片N is for (first frame, identity, product, style). Length, aspect ratio and Chinese / English are selectable.

### Video methods

A **视频玩法** (video method) node **makes a finished video**. Pick a method from the bottom bar's **素材库 → 视频玩法库** (library → video methods), or add the node and choose later (or not at all, for a free-form piece). The node holds the **materials** (connected nodes, uploads, or files dragged in), **what you want**, the maker (Claude Code / ChatGPT), aspect ratio and length; then **开始制作** (Start). The AI opens a production folder in the project, reads the method's full guide, animates it in HTML + GSAP with [HyperFrames](https://github.com/heygen-com/hyperframes) (HeyGen, Apache-2.0), checks its own frames, and renders an MP4 with your Mac's Chrome and FFmpeg. The video lands back on the node with production notes (concept, shot list, what to change where). A 10–30 s piece usually takes 5–20 minutes.

- Connected text, scripts, images, videos and sound all go into the production folder as materials.
- The AI uses local tools when needed: ChatGPT illustrations, Qwen3-TTS narration, ACE-Step music (if installed).
- Afterwards, **在 Studio 中编辑** opens HyperFrames Studio to edit text, visuals and timeline, then **渲染为新版本** renders a new version; or switch the mode to **改上一版** and tell the AI in a sentence what to change.
- **打开文件夹** shows all sources, in `<project>/制作/<date-time-title>/`.

Install **HyperFrames 视频制作** (about 500 MB: Node.js, HyperFrames, a Chrome for rendering) under **本地引擎** (Local engines, top right) before the first use.

Six methods (the library shows previews, a summary and the source repository). A method node can also feed text, script, image or video-prompt nodes so ChatGPT and Claude write its way:

| Method | Source (MIT) | Good for |
| --- | --- | --- |
| Q版蜡笔手绘 (chibi crayon) | [kaomei/hand-drawn-video-prompts](https://github.com/kaomei/hand-drawn-video-prompts) | Vertical tech, finance and knowledge talks |
| 复古纸质拼贴 (retro paper collage) | [Alisa0808/vox-director](https://github.com/Alisa0808/vox-director) | History, people, brand stories, explainers |
| 手绘口播 (draw-as-you-talk) | [threerocks/sweety-handdraw-video](https://github.com/threerocks/sweety-handdraw-video) | Explainers, fables, how products work |
| 自动选题出片 (auto topic: whiteboard / investigation) | [trustfuture/simon-skills](https://github.com/trustfuture/simon-skills) | Tech and business takes, consumer investigations |
| 艺术动画 (art animation) | [alchaincyf/huashu-art-motion](https://github.com/alchaincyf/huashu-art-motion) | Artistic shorts, explainer animation |
| 机械交互图解 (mechanical diagrams) | [wheresryan22/anatomy](https://github.com/wheresryan22/anatomy) | How technology and products work |

These repositories are complete video toolkits for AI coding assistants. The AI reads their full guides (shipped with the app, each with its LICENSE); any paid cloud services they mention (Volcano Engine, Atlas Cloud…) are replaced with local tools, and rendering always uses HyperFrames.

### Voice-over (text to speech)

Set an audio node's type to **配音** (voice) to read text aloud: what you type or connected text / scripts, or choose **AI 写口播** to have the node's ChatGPT or Claude rewrite it as a script first. Nine voices (soft / bright female, deep male, Beijing, Sichuan, English, Japanese, Korean…) and many tones (gentle, rousing, suspense, newsreader, storytelling…).

It uses the open-source [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) (Apache-2.0) through [mlx-audio](https://github.com/Blaizzy/mlx-audio) (MIT) on Apple silicon; without it, **系统语音** (macOS voices) is available.

**转旁白 / 转音乐** (to narration / to music): select a text node and click one in its toolbar to get a connected voice or music node. Choose the voice and tone, optionally type reading directions (e.g. "a little slower, smiling" — with text connected these are directions, not read aloud), then click ↑.

**Voice cloning**: set the type to **克隆声音** (clone) and connect a recording (an audio node; 3–15 s of clear speech works best). Whisper transcribes it, then the Qwen3-TTS Base model clones it; the first use downloads about 4 GB. Only clone your own voice or one you have permission to use.

### Image design methods

An image node's **设计** (design) option applies a design method distilled from [Anthropic Skills](https://github.com/anthropics/skills) (Apache-2.0) and [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) (MIT):

| Design | Source | Result |
| --- | --- | --- |
| 海报设计 (poster) | canvas-design | A visual philosophy first; 90% image, 10% text |
| 算法艺术 (algorithmic art) | algorithmic-art | Flow fields, particles, recursion |
| 主题配色 (theme colours) | theme-factory | Ten palettes (deep sea, sunset boulevard, canopy, arctic frost…) |
| 界面设计 (interface) | frontend-design | Interfaces with a clear aesthetic, not templates |
| Banner 横幅 | banner-design | Banners with safe areas and three information levels |
| UI 风格库 (UI styles) | UI/UX Pro Max | 50 interface styles (glassmorphism, neumorphism, Swiss minimal…) |

### Files and assets

- **Drag** videos, pictures and sound onto the canvas, or click **上传视频** in an empty video node; files are saved in the current project's folder.
- **⌘V a link** on the canvas: direct links to pictures, videos and sound download as they are; **Douyin** links (or the whole text from Share → Copy link) are opened in the background by the app to get the video without watermark — no login or API; pages on Bilibili, Xiaohongshu, YouTube and others download through [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense, about 35 MB on first use). Videos that need a login can't be downloaded — save them in the app first, then drag them in.
- **⌘V text** becomes a text node.
- Generated images are saved in the project folder too.
- **Right-click → 在访达中显示** (Show in Finder) on any media node or file.
- **资产管理** (Assets, bottom left):
  - **当前项目** (this project): the project's files in picture / video / sound folders (the folders on disk are sorted the same way; older projects are sorted once when first opened, with every reference updated). The search box at the top **finds files by describing them**, e.g. "a woman in a trench coat" or "night scene" — [Chinese-CLIP](https://github.com/OFA-Sys/Chinese-CLIP) (MIT) understands the pictures on your Mac; about 130 MB on first use. (Descriptions work best in Chinese.)
  - **品牌资产** (brand assets): logos, brand colours, product shots — shared by all projects; drag onto the canvas and connect as references.
  - **收藏夹** (favourites): keep your best pictures and videos in folders of your own, shared by all projects.
  - Right-click a node or file to **加入品牌资产库** (add to brand assets) or **收藏** (add to favourites).
- **Option-drag** a node to pull out an unlinked copy (add Shift to copy its links too); **double-click a link** to delete it. A selection box picks every node it touches.
- **🔍 智能搜索** (Smart search, ⌘F, bottom bar): finds canvas nodes by name, prompt or text as you type; after a short pause it also finds pictures and videos by what they show, in this project, brand assets and favourites. Click one already on the canvas to jump to it, or another to add it.
- **?** in the bottom bar opens the tour of new features.
- **素材库 → 风格库** (library → styles): styles in photography / illustration / design; **图片玩法** holds one-click image presets (nine-angle grid, character turnaround, story continuation…), made with ChatGPT.

### 3D director stage

Add a **导演台** (director stage) node and double-click it:

- **Build a scene**: add posable mannequins, cameras and props (boxes, walls, tables and chairs, doors, trees, cars…); move / rotate / scale with W / E / R and fine-tune position, rotation, scale and colour on the right.
- **Poses**: standing, walking, running, sitting, crouching, waving, pointing, hands on hips, thinking, hands up, hugging, jumping… and per-joint tweaks.
- **Cameras**: switch between director view and camera view, pick the aspect ratio (16:9, 9:16, 2.39:1…) and field of view; snap a camera to the current view; make it look at a person or prop.
- **Keyframe animation**: move the playhead, select an object, **添加关键帧** (K); at another time move it, change its pose or field of view and a new keyframe is recorded. Drag keyframes to retime them; transitions can be linear, ease in/out or hold. Auto-record keys every change. Space plays, ← / → step frames.
- **AI**: the input at the bottom has three modes (connect reference pictures to the node first if you like):
  - **搭场景** (build): describe a scene and it places people, props and cameras;
  - **生成动画** (animate): describe action and camera (e.g. "the person walks to the bench and sits; the camera follows and slowly pushes in") and it keyframes the people and cameras — still editable frame by frame;
  - **生成模型** (model): describe an object (e.g. "a vintage red bicycle") and it's built from primitives in the scene.
- **Motion capture**: under a person's pose & motion, capture movement from a video on the canvas or on disk (Google MediaPipe, on your Mac). It plays from the playhead and works with position keyframes. Best with one person, full body, clear footage; captures are saved in a shared motion library.
- **Snapshot / export video**: render the camera's view as a picture, or the whole animation as 1080p video, onto the canvas.

### Music from text

Describe the music in an audio node (style, mood, instruments, tempo), choose the engine, vocals and length, and generate:

- **ACE-Step 歌曲** (song, default): ChatGPT or Claude writes lyrics (verses, chorus…) and an English style description; the open-source [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) (MIT) makes a complete song with vocals or instrumental, Chinese lyrics included. A 30 s song takes about a minute on an M1 Max (plus engine start-up the first time).
- **合成小样** (synth sketch): the AI writes a score and WCcanvastv synthesises an electronic demo locally; no vocals, nothing to install.

### Local engines

**本地引擎** (Local engines, top right) installs Qwen3-TTS voice (about 4 GB), ACE-Step music (about 15 GB) and HyperFrames video (about 500 MB) in one click. They live in `~/Library/Application Support/WCcanvastv/engines` and can be removed any time; mirrors in mainland China are used automatically when HuggingFace, npm or nodejs.org can't be reached. They run only on your Mac, with no account or API key. 16 GB of memory or more is recommended.

### Video tools

Select a video node; its toolbar has:

- **逐帧拉片** (shot breakdown): finds the cuts and a key frame per shot, and has ChatGPT / Claude analyse each shot's framing, camera move, light and colour (and guess sound and music), as a storyboard node. It can also split the video into one clip per shot.
- **画面裁切** (crop): drag a region (free, 16:9, 9:16, 1:1…) and export a new video.
- **音视频分离** (split sound): a silent video and a sound file.
- **深度提取** (depth): frame-by-frame depth with [Depth Anything V2](https://github.com/DepthAnything/Depth-Anything-V2) (Apache-2.0) on your Mac, as a black-and-white depth video (nearer is whiter) at 480P / 720P — for ControlNet, compositing or relighting. Takes 1–3× the video's length; the model (about 47 MB) downloads on first use.

Everything is saved in the project folder. Video processing uses the bundled [FFmpeg](https://ffmpeg.org) (licence in the app's `bin/ffmpeg.LICENSE`).

### Local tools (free, offline)

Select a picture, sound or video node and a row of **tools** appears above it (hover a button for what it does). Results appear as new nodes on the right and are saved in the project folder. They all run on your Mac — free, no ChatGPT quota — and download what they need the first time (with mirrors in mainland China), then work offline.

- **Pictures**: cutout, layer split (background + subjects; export the group as PSD), **扩图** outpaint (drag any edge outward), **元素编辑** element edit (click, box or brush an object; change, remove or move it), **文字编辑** text edit (the text in the picture is recognised; retype or delete lines in the same lettering), magic eraser, upscale (2× / 4×), text recognition, palette, compress / convert (WebP, JPEG, PNG)
- **Sound**: speech to text (timed), vocals / accompaniment split, noise removal
- **Video**: trim (ends, several ranges, speed), frame interpolation (double the frame rate), **视频高清** video upscale (2×, up to 4K), **智能去字幕** subtitle removal (found automatically), background removal (transparent WebM / ProRes, green screen, white), watermark removal (mark the area), plus the three sound tools. Scene splitting is in 逐帧拉片.

Each tool's open-source project, download size, memory and measured speed are in [docs/LOCAL_TOOLS.md](docs/LOCAL_TOOLS.md) (Chinese). Everything together downloads about 1.4 GB.

### My preferences

**我的偏好** (top right): write your style, tone, role and habits (you can copy them from ChatGPT's Settings → Personalization → Custom instructions / Memory); every generation includes them.

### Also

Style and effect libraries, toolbox workflow templates, the character studio (**@name** in a prompt), groups, tidy canvas (connected nodes laid out left to right in layers, groups side by side, one-click undo), undo / redo, ⌘F smart search. The keyboard icon in the bottom bar lists all shortcuts.

## FAQ

**"Damaged and can't be opened" or "developer cannot be verified"**
Allow it as in [Step 1](#step-1-install-wccanvastv), point 3.

**Top right says ChatGPT is not installed / not signed in**
Check [Step 2](#step-2-set-up-chatgpt), then quit WCcanvastv completely (⌘Q) and reopen it.

**Top right says Claude is not signed in**
Run `claude auth login` in Terminal, then reopen WCcanvastv.

**Generations don't appear in the ChatGPT app**
That's expected: WCcanvastv calls it in the background without saving a conversation. It still uses your account and quota.

**Does ChatGPT's memory apply?**
No. The command line can't read ChatGPT's memory or custom instructions; copy what you need into 我的偏好.

**Port 5174 is in use**
WCcanvastv runs its built-in service on port 5174 (local access only). Close whatever is using that port and try again.

**Where are my files?**
`~/Movies/WCcanvastv/`, one folder per project; brand assets and favourites are the `品牌资产库` and `收藏夹` folders beside them. Characters, toolbox and preferences are in `~/Movies/WCcanvastv/.libcanvas/` (hidden).

## Building from source

Requires [Node.js](https://nodejs.org) 22 or later.

```bash
git clone <this repository>
cd <repository folder>
npm install
npm run app
```

The app is built at `release/WCcanvastv-darwin-arm64/WCcanvastv.app`.

For development you can skip packaging: run `npm start` and open http://localhost:5174.

### Layout

- `server/index.mjs`: the local service (listens on 127.0.0.1 only, refuses requests from other sites); calls ChatGPT / Claude Code, reads and writes projects and files
- `electron/`: the Mac app shell (window, menus, packaging, icon)
- `src/canvas/`: the canvas front end (React + React Flow)
