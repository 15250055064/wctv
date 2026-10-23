// Image presets (风格库 → 图片玩法): one click turns the selected picture into a grid of
// camera angles, a character sheet, the next beat of the story… They are prompts for ChatGPT's
// image generation (each run uses one image from the ChatGPT quota); the same ideas as LibTV's
// slash presets, written for ChatGPT.

import { defaultParams } from './config';
import { absPos, currentOutput, sizeOf, useCanvas } from './store';
import type { CanvasNode } from './types';
import { useUI } from './ui';

export interface ImagePreset {
  id: string;
  name: string;
  /** One line shown under the name. */
  desc: string;
  /** 'source' keeps the picture's own shape; otherwise one of the image node's ratios. */
  ratio: 'source' | '1:1' | '16:9' | '9:16';
  prompt: string;
}

const KEEP = '人物的脸、发型、服装、配饰，以及场景、光线和色调都与参考图保持一致。';

export const IMAGE_PRESETS: ImagePreset[] = [
  {
    id: 'grid9',
    name: '多机位九宫格',
    desc: '同一时刻的 9 个机位',
    ratio: '1:1',
    prompt: `以参考图为基础，生成一张 3×3 九宫格：同一时刻、同一场景的 9 个不同机位——远景、全景、中景、近景、特写、俯拍、仰拍、侧面、背面。${KEEP}格与格之间用细白线分隔，画面里不要文字。`,
  },
  {
    id: 'char3',
    name: '角色三视图',
    desc: '正面、侧面、背面全身',
    ratio: '16:9',
    prompt: `白底角色三视图：同一角色的正面、侧面、背面全身像从左到右并排，身高比例一致，自然站姿，均匀柔和的影棚光。${KEEP}不要文字和标注。`,
  },
  {
    id: 'face3',
    name: '角色脸部三视图',
    desc: '正脸、45°、侧脸特写',
    ratio: '16:9',
    prompt: `白底脸部三视图：同一人物头部的正面、45 度侧面、90 度侧面肖像特写从左到右并排，五官、发型、肤色、妆容与参考图完全一致，柔和均匀的影棚光，不要文字。`,
  },
  {
    id: 'charSheet',
    name: '角色设定图',
    desc: '主视觉 + 表情 + 服装道具拆解',
    ratio: '16:9',
    prompt: `角色设定图（character sheet）：左侧一幅大的全身主视觉，右侧排布 4 个表情特写（喜、怒、哀、惊）、服装与配饰细节、随身道具和配色色块，浅色干净背景，版式整洁。${KEEP}不要多余文字。`,
  },
  {
    id: 'sceneSheet',
    name: '场景设定图',
    desc: '主视角 + 多角度细节',
    ratio: '16:9',
    prompt: `场景设定图：以参考图的场景为基础，一张主视角大图加 3–4 张不同角度和细节的小图，展示空间结构、关键道具、材质和光线氛围，排版干净统一。场景风格、色调与参考图一致，不要文字。`,
  },
  {
    id: 'productSheet',
    name: '产品设定图',
    desc: '多角度 + 细节特写',
    ratio: '16:9',
    prompt: `产品设定图：白底，展示产品的正面、侧面、背面、俯视，以及 2–3 个材质和结构的细节特写，排版整洁统一，柔和的影棚光。产品外观、颜色、材质、标识与参考图完全一致，不要额外文字。`,
  },
  {
    id: 'beat4',
    name: '剧情推演四宫格',
    desc: '起、承、转、合',
    ratio: '1:1',
    prompt: `以参考图为第一格，推演接下来发生的剧情，生成 2×2 四宫格连贯分镜：起、承、转、合四个时刻，镜头景别有变化，富有电影感。${KEEP}格间细白线分隔，不要文字。`,
  },
  {
    id: 'board25',
    name: '25 宫格连贯分镜',
    desc: '一段小剧情的连续分镜',
    ratio: '1:1',
    prompt: `以参考图为起点，生成 5×5 共 25 格的连续分镜长图，按从左到右、从上到下的顺序讲一段连贯的小剧情，镜头景别和角度丰富变化。${KEEP}格间细白线分隔，不要文字。`,
  },
  {
    id: 'cinematic',
    name: '电影级光影校正',
    desc: '只重塑光影，内容不变',
    ratio: 'source',
    prompt: `对参考图做电影级光影校正：构图、人物、动作和所有内容完全不变，只重塑光线——明确的主光方向、柔和的轮廓光、有层次的明暗和电影感调色，提升质感和氛围。`,
  },
  {
    id: 'plus3',
    name: '画面推演 · 3 秒后',
    desc: '同一镜头往后 3 秒',
    ratio: 'source',
    prompt: `根据参考图推演 3 秒之后的画面：同一场景、同一机位和景别、同样的光线，人物的动作和表情自然地向前推进 3 秒。${KEEP}`,
  },
  {
    id: 'minus5',
    name: '画面推演 · 5 秒前',
    desc: '同一镜头往前 5 秒',
    ratio: 'source',
    prompt: `根据参考图推演 5 秒之前的画面：同一场景、同一机位和景别、同样的光线，表现这一刻之前 5 秒人物的动作和状态。${KEEP}`,
  },
];

const RATIOS = { '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16, '4:3': 4 / 3, '3:4': 3 / 4, '21:9': 21 / 9 } as const;
/** The image node's ratio closest to a w×h picture. */
const nearestRatio = (w: number, h: number) => (Object.keys(RATIOS) as (keyof typeof RATIOS)[]).reduce((a, b) => (Math.abs(Math.log(RATIOS[b] / (w / h))) < Math.abs(Math.log(RATIOS[a] / (w / h))) ? b : a));

/** A new image node to the right of `src` (or mid-canvas), wired from it, using the preset. */
export function applyPreset(preset: ImagePreset, src: CanvasNode | undefined, center: { x: number; y: number }) {
  const s = useCanvas.getState();
  const media = src ? currentOutput(src.data)?.media : undefined;
  const ratio = preset.ratio === 'source' ? (media?.w && media?.h ? nearestRatio(media.w, media.h) : '16:9') : preset.ratio;
  const at = src ? (() => {
    const p = absPos(src, s.nodes);
    return { x: p.x + sizeOf(src).w + 120, y: p.y };
  })() : center;
  const id = s.addNode('image', at, {
    from: src?.id,
    data: { title: preset.name, prompt: preset.prompt, params: { ...defaultParams('image'), ratio } },
  });
  if (src) s.run([id]);
  useUI.getState().notify(src ? `正在用 ChatGPT 生成「${preset.name}」（约 1 分钟）` : `已添加「${preset.name}」节点：连一张参考图，或补充描述后点 ↑ 生成`);
}

