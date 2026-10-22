import type { ParamValue } from './types';
import { UI_STYLES } from './uiStyles';

// Design approaches for image generation, distilled from Anthropic's skills (Apache-2.0:
// canvas-design, algorithmic-art, theme-factory, frontend-design) and UI/UX Pro Max (MIT:
// banner-design and its style catalogue). Chosen in the image node's 「设计」 option.

/** theme-factory's ten themes: palette (hex) and the character each is for. */
export const THEMES: Record<string, { colors: string; mood: string }> = {
  'Ocean Depths 深海': { colors: '#1a2332 深海军蓝, #2d8b8b 青绿, #a8dadc 海沫绿, #f1faee 奶白', mood: '专业、平静、值得信赖' },
  'Sunset Boulevard 日落大道': { colors: '#e76f51 珊瑚橙, #f4a261 杏橙, #e9c46a 暖黄, #264653 深青', mood: '温暖、热烈、有活力' },
  'Forest Canopy 林冠': { colors: '#2d4a2b 深林绿, #7d8471 苔灰, #a4ac86 鼠尾草绿, #faf9f6 米白', mood: '自然、沉稳、朴实' },
  'Modern Minimalist 现代极简': { colors: '#36454f 炭灰, #708090 石板灰, #d3d3d3 浅灰, #ffffff 白', mood: '干净、克制、当代' },
  'Golden Hour 金色时光': { colors: '#f4a900 琥珀金, #c1666b 玫瑰红, #d4b896 麦色, #4a403a 深棕', mood: '温暖、丰收、秋意' },
  'Arctic Frost 北极霜': { colors: '#d4e4f7 冰蓝, #4a6fa5 钢蓝, #c0c0c0 银, #fafafa 雪白', mood: '清冷、清爽、冬日' },
  'Desert Rose 沙漠玫瑰': { colors: '#d4a5a5 灰粉, #b87d6d 赤陶, #e8d5c4 沙色, #5d2e46 深莓', mood: '柔和、雅致、复古' },
  'Tech Innovation 科技创新': { colors: '#0066ff 电光蓝, #00ffff 青, #1e1e1e 近黑, #ffffff 白', mood: '大胆、现代、科技' },
  'Botanical Garden 植物园': { colors: '#4a7c59 叶绿, #f9a620 向日葵黄, #b7472a 砖红, #f5f3ed 纸白', mood: '清新、有机、生机' },
  'Midnight Galaxy 午夜星河': { colors: '#2b1e3e 深紫, #4a4e8f 靛蓝, #a490c2 薰衣草, #e6e6fa 淡紫白', mood: '戏剧、神秘、宇宙' },
};

export const DESIGN_OPTIONS = ['无', '海报设计', '算法艺术', '主题配色', '界面设计', 'Banner 横幅', 'UI 风格库'];
export const UI_STYLE_NAMES = UI_STYLES.map((s) => s.name);

const RULES: Record<string, string> = {
  海报设计: `【设计方法：海报与视觉作品（提炼自 Anthropic canvas-design）】
- 先为这张图确立一种「视觉哲学」：给它起一个 1–2 个词的流派名（如「混凝土诗」「色彩语言」「几何静默」），想清楚它如何体现在空间与形体、色彩与材质、尺度与节奏、构图与平衡、视觉层级上；在生成思路之外不要写成文字，直接用画面表达。
- 画面 90% 是视觉设计，10% 是必要文字：文字极少，作为视觉元素融入构图（巨大的一个词 + 很小的标注），从不出现段落。
- 用空间、形体、色块和构图传达信息，而不是解释；大胆的留白、明确的网格与视觉重心。
- 质感要像顶尖设计师花了无数小时精心打磨：对齐精确、比例考究、色彩校准过，无廉价模板感、无随意装饰。
- 原创构图，不模仿已有作品或某位艺术家的具体作品。`,
  算法艺术: `【设计方法：算法生成艺术（提炼自 Anthropic algorithmic-art）】
- 把画面当作一个生成系统的输出：先定一种「算法哲学」（如流场、粒子系统、递归细分、噪声地形、反应扩散、维诺图），让形态从规则中生长出来，而不是手绘的具象画面。
- 体现计算之美：成千上万的细线 / 粒子 / 单元按同一规则排列，局部有随机变化、整体有秩序；能看出参数与节奏。
- 色彩克制而有体系（2–4 个主色 + 透明度层叠），背景干净，构图有呼吸感。
- 精致度要像博物馆级别的生成艺术作品，原创，不模仿已有艺术家的作品。`,
  主题配色: `【设计方法：主题配色（来自 Anthropic theme-factory）】
- 整张图严格使用下面这套主题配色，主色、强调色、浅色和文字色各司其职，保证对比度和可读性；不额外引入其他颜色。`,
  界面设计: `【设计方法：有辨识度的界面设计（提炼自 Anthropic frontend-design）】
- 先确定一个明确的审美方向（如编辑杂志感、粗野主义、复古未来、柔和有机、奢华极简、玩具感），整张界面贯彻到底，不做「安全但平庸」的模板化设计。
- 字体有个性：标题与正文字体对比鲜明，层级清楚，避免千篇一律的默认无衬线体。
- 配色有主张：一个主导色 + 锐利的强调色，避免泛滥的紫色渐变和平均分配的颜色。
- 构图出人意料：不对称、重叠、对角线流动或大量留白，打破标准网格；背景有氛围（渐变网格、噪点、几何纹理、层叠透明），而不是纯色。
- 细节精致：间距统一、对齐精确、图标风格一致、状态清晰，看起来像真实可用的产品界面截图。`,
  'Banner 横幅': `【设计方法：Banner 横幅（提炼自 UI/UX Pro Max banner-design）】
- 先明确用途（社媒封面、广告横幅、网站首屏、活动印刷）和尺寸比例，主要信息全部放在安全区内，边缘留出裁切余量。
- 信息层级只有三层：主标题（大、短、有力）→ 副标题 / 卖点 → 行动按钮或 Logo 位，阅读路径一眼清楚。
- 选定一种艺术方向（极简留白、大字报、渐变氛围、产品主视觉、插画、拼贴等）并贯彻，主体与文字区域互不遮挡。
- 文字要清晰可读：与背景有足够对比；需要精确的品牌名、价格、日期时，在生成思路里提示后期用真实文字叠加。`,
};

/** Instructions for an image request, from the node's 设计 / 主题 / UI 风格 options. */
export function designRules(params: Record<string, ParamValue>): { rules: string; label: string } | null {
  const d = String(params.design ?? '无');
  if (d === '无' || !d) return null;
  if (d === '主题配色') {
    const name = String(params.theme ?? Object.keys(THEMES)[0]);
    const t = THEMES[name] ?? Object.values(THEMES)[0];
    return { rules: `${RULES[d]}\n- 主题：${name}（${t.mood}）\n- 配色：${t.colors}`, label: `主题配色 · ${name}` };
  }
  if (d === 'UI 风格库') {
    const s = UI_STYLES.find((x) => x.name === params.uiStyle) ?? UI_STYLES[0];
    return {
      rules: `【设计方法：UI 风格「${s.name}」（来自 UI/UX Pro Max 风格库）】\n- 关键词：${s.keywords}\n- 主色：${s.colors}\n- 适合：${s.bestFor}\n- 整张图统一贯彻这种风格的形状、质感、光影和配色，细节精致，像真实的产品设计稿。`,
      label: `UI 风格 · ${s.name}`,
    };
  }
  const r = RULES[d];
  return r ? { rules: r, label: d } : null;
}
