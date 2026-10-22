// UI style catalogue from nextlevelbuilder/ui-ux-pro-max-skill (MIT), data/styles.csv: active styles only.
// Regenerate from that file rather than editing by hand.
export interface UiStyle {
  name: string;
  keywords: string;
  colors: string;
  bestFor: string;
}

export const UI_STYLES: UiStyle[] = [
 {
  "name": "Minimalism & Swiss Style",
  "keywords": "Design a minimalist landing page. Use: white space, geometric layouts, sans-serif fonts, high contrast, grid-based structure, essential elements only. Avoid shadows and gradients. Focus on clarity and functionality.",
  "colors": "Monochromatic, Black #000000, White #FFFFFF",
  "bestFor": "Enterprise apps, dashboards, documentation sites, SaaS platforms, professional tools"
 },
 {
  "name": "Neumorphism",
  "keywords": "Create a neumorphic UI with soft 3D effects. Use light pastels, rounded corners (12-16px), subtle soft shadows (multiple layers), no hard lines, monochromatic color scheme with light/dark variations. Embossed/debossed effect on interactive elements.",
  "colors": "Light pastels: Soft Blue #C8E0F4, Soft Pink #F5E0E8, Soft Grey #E8E8E8",
  "bestFor": "Health/wellness apps, meditation platforms, fitness trackers, minimal interaction UIs"
 },
 {
  "name": "Glassmorphism",
  "keywords": "Design a glassmorphic interface with frosted glass effect. Use backdrop blur (10-20px), translucent overlays (rgba 10-30% opacity), vibrant background colors, subtle borders, light source reflection, layered depth. Perfect for modern overlays and cards.",
  "colors": "Translucent white: rgba(255,255,255,0.1-0.3)",
  "bestFor": "Modern SaaS, financial dashboards, high-end corporate, lifestyle apps, modal overlays, navigation"
 },
 {
  "name": "Brutalism",
  "keywords": "Create a brutalist design with raw, unpolished, stark aesthetic. Use pure primary colors (red, blue, yellow), black & white, no smooth transitions (instant), sharp corners, bold large typography, visible grid lines, default system fonts, intentional 'broken' d",
  "colors": "Primary: Red #FF0000, Blue #0000FF, Yellow #FFFF00, Black #000000, White #FFFFFF",
  "bestFor": "Design portfolios, artistic projects, counter-culture brands, editorial/media sites, tech blogs"
 },
 {
  "name": "3D & Hyperrealism",
  "keywords": "Build an immersive 3D interface using realistic textures, 3D models (Three.js/Babylon.js), complex shadows, realistic lighting, parallax scrolling (3-5 layers), physics-based motion. Include skeuomorphic elements with tactile detail.",
  "colors": "Deep Navy #001F3F, Forest Green #228B22, Burgundy #800020, Gold #FFD700, Silver #C0C0C0",
  "bestFor": "Gaming, product showcase, immersive experiences, high-end e-commerce, architectural viz, VR/AR"
 },
 {
  "name": "Vibrant & Block-based",
  "keywords": "Design an energetic, vibrant interface with bold block layouts, geometric shapes, high color contrast, large typography (32px+), animated background patterns, duotone effects. Perfect for startups and youth-focused apps. Use 4-6 contrasting colors from complem",
  "colors": "Neon Green #39FF14, Electric Purple #BF00FF, Vivid Pink #FF1493, Bright Cyan #00FFFF, Sunburst #FFAA00",
  "bestFor": "Startups, creative agencies, gaming, social media, youth-focused, entertainment, consumer"
 },
 {
  "name": "Dark Mode (OLED)",
  "keywords": "Create an OLED-optimized dark interface with deep black (#000000), dark grey (#121212), midnight blue accents. Use minimal glow effects, vibrant neon accents (green, blue, gold, purple), high contrast text. Optimize for eye comfort and OLED power saving.",
  "colors": "Deep Black #000000, Dark Grey #121212, Midnight Blue #0A0E27",
  "bestFor": "Night-mode apps, coding platforms, entertainment, eye-strain prevention, OLED devices, low-light"
 },
 {
  "name": "Accessible & Ethical",
  "keywords": "Design toward enhanced accessibility criteria; verify complete-page conformance. Include: high contrast (7:1+), large text (16px+), keyboard navigation, screen reader compatibility, focus states visible (3-4px ring), semantic HTML, ARIA labels, skip links, red",
  "colors": "Measured high-contrast pairs (4.5:1 normal-text baseline; 7:1 enhanced target), simple primary, clear secondary, high luminosity (7:1+)",
  "bestFor": "Government, healthcare, education, inclusive products, large audience, legal compliance, public"
 },
 {
  "name": "Claymorphism",
  "keywords": "Design a playful, toy-like interface with soft 3D, chunky elements, bubbly aesthetic, rounded edges (16-24px), thick borders (3-4px), double shadows (inner + outer), pastel colors, smooth animations. Perfect for children's apps and creative tools.",
  "colors": "Pastel: Soft Peach #FDBCB4, Baby Blue #ADD8E6, Mint #98FF98, Lilac #E6E6FA, light BG",
  "bestFor": "Educational apps, children's apps, SaaS platforms, creative tools, fun-focused, onboarding, casual games"
 },
 {
  "name": "Aurora UI",
  "keywords": "Create a vibrant gradient interface inspired by Northern Lights with mesh gradients, smooth color blends, flowing animations. Use complementary color pairs (blue-orange, purple-yellow), flowing background gradients, subtle continuous animations (8-12s loops), ",
  "colors": "Complementary: Blue-Orange, Purple-Yellow, Electric Blue #0080FF, Magenta #FF1493, Cyan #00FFFF",
  "bestFor": "Modern SaaS, creative agencies, branding, music platforms, lifestyle, premium products, hero sections"
 },
 {
  "name": "Retro-Futurism",
  "keywords": "Build a retro-futuristic (cyberpunk/vaporwave) interface with neon colors (blue, pink, cyan), deep black background, 80s aesthetic, CRT scanlines, glitch effects, neon glow text/borders, monospace fonts, geometric patterns. Use neon text-shadow and animated gl",
  "colors": "Neon Blue #0080FF, Hot Pink #FF006E, Cyan #00FFFF, Deep Black #1A1A2E, Purple #5D34D0",
  "bestFor": "Gaming, entertainment, music platforms, tech brands, artistic projects, nostalgic, cyberpunk"
 },
 {
  "name": "Flat Design",
  "keywords": "Create a flat, 2D interface with bold colors, no shadows/gradients, clean lines, simple geometric shapes, icon-heavy, typography-focused, minimal ornamentation. Use 4-6 solid, bright colors in a limited palette with high saturation.",
  "colors": "Solid bright: Red, Orange, Blue, Green, limited palette (4-6 max)",
  "bestFor": "Web apps, mobile apps, cross-platform, startup MVPs, user-friendly, SaaS, dashboards, corporate"
 },
 {
  "name": "Skeuomorphism",
  "keywords": "Design a realistic, textured interface with 3D depth, real-world metaphors (leather, wood, metal), complex gradients (8-12 stops), realistic shadows, grain/texture overlays, tactile press animations. Perfect for premium/luxury products.",
  "colors": "Rich realistic: wood, leather, metal colors, detailed gradients (8-12 stops), metallic effects",
  "bestFor": "Legacy apps, gaming, immersive storytelling, premium products, luxury, realistic simulations, education"
 },
 {
  "name": "Liquid Glass",
  "keywords": "Apply Apple Liquid Glass sparingly to navigation and controls. Use dynamic translucent material, lensing, and fluid transitions while keeping content clear. Respect reduced transparency and reduced motion settings.",
  "colors": "Adaptive translucent material derived from surrounding content; use color judiciously",
  "bestFor": "Apple-platform navigation, controls, and system-aligned app chrome"
 },
 {
  "name": "Motion-Driven",
  "keywords": "Build an animation-heavy interface with scroll-triggered animations, microinteractions, parallax scrolling (3-5 layers), smooth transitions (300-400ms), entrance animations, page transitions. Use Intersection Observer for scroll effects, transform for performa",
  "colors": "Bold colors emphasize movement, high contrast animated, dynamic gradients, accent action colors",
  "bestFor": "Portfolio sites, storytelling platforms, interactive experiences, entertainment apps, creative, SaaS"
 },
 {
  "name": "Micro-interactions",
  "keywords": "Design with delightful micro-interactions: small 50-100ms animations, gesture-based responses, tactile feedback, loading spinners, success/error states, subtle hover effects, haptic feedback triggers for mobile. Focus on responsive, contextual interactions.",
  "colors": "Subtle color shifts (10-20%), feedback: Green #22C55E, Red #EF4444, Amber #F59E0B",
  "bestFor": "Mobile apps, touchscreen UIs, productivity tools, user-friendly, consumer apps, interactive components"
 },
 {
  "name": "Inclusive Design",
  "keywords": "Design for universal accessibility: high contrast (7:1+), large text (16px+), keyboard-only navigation, screen reader optimization, enhanced accessibility criteria with complete-page verification, symbol-based color indicators (not color-only), haptic feedback",
  "colors": "Measured contrast pairs targeting 7:1 for normal text, avoid red-green only, symbol-based indicators, high contrast primary",
  "bestFor": "Public services, education, healthcare, finance, government, accessible consumer, inclusive"
 },
 {
  "name": "Zero Interface",
  "keywords": "Create a voice-first, gesture-based, AI-driven interface with minimal visible UI, progressive disclosure, voice recognition UI, gesture detection, AI predictions, smart suggestions, context-aware actions. Hide controls until needed.",
  "colors": "Neutral backgrounds: Soft white #FAFAFA, light grey #F0F0F0, warm off-white #F5F1E8",
  "bestFor": "Voice assistants, AI platforms, future-forward UX, smart home, contextual computing, ambient experiences"
 },
 {
  "name": "Soft UI Evolution",
  "keywords": "Design evolved neumorphism with improved contrast (measured contrast targets), modern aesthetics, subtle depth, accessibility focus. Use soft shadows (softer than flat but clearer than pure neumorphism), better color hierarchy, improved focus states, modern 20",
  "colors": "Improved contrast pastels: Soft Blue #87CEEB, Soft Pink #FFB6C1, Soft Green #90EE90, better hierarchy",
  "bestFor": "Modern enterprise apps, SaaS platforms, health/wellness, modern business tools, professional, hybrid"
 },
 {
  "name": "Data-Dense Dashboard",
  "keywords": "Design a data-dense dashboard. Use: multiple chart widgets, KPI cards row, data tables with sorting, minimal padding (8-12px), efficient grid layout, filter sidebar, dense but readable typography, maximum information density.",
  "colors": "Neutral primary (light grey/white #F5F5F5), data colors (blue/green/red), dark text #333333",
  "bestFor": "Business intelligence dashboards, financial analytics, enterprise reporting, operational dashboards, data warehousing"
 },
 {
  "name": "Neubrutalism",
  "keywords": "Design a neubrutalist interface. Use: high contrast, hard black borders (3px+), bright pop colors, no blur, sharp or slightly rounded corners, bold typography, hard shadows (offset 4px 4px), raw aesthetic but functional.",
  "colors": "#FFEB3B (Yellow), #FF5252 (Red), #2196F3 (Blue), #000000 (Black borders)",
  "bestFor": "Gen Z brands, startups, creative agencies, Figma-style apps, Notion-style interfaces, tech blogs"
 },
 {
  "name": "Bento Box Grid",
  "keywords": "Design a Bento Box grid layout. Use: modular cards with varied sizes (1x1, 2x1, 2x2), Apple-style aesthetic, rounded corners (16-24px), soft shadows, clean hierarchy, asymmetric grid, neutral backgrounds (#F5F5F7), hover effects.",
  "colors": "Neutral base + brand accent, #FFFFFF, #F5F5F5, brand primary",
  "bestFor": "Dashboards, product pages, portfolios, Apple-style marketing, feature showcases, SaaS"
 },
 {
  "name": "Y2K Aesthetic",
  "keywords": "Design a Y2K aesthetic interface. Use: neon pink/cyan colors, chrome/metallic textures, bubblegum gradients, glossy buttons, iridescent effects, 2000s futurism, star/sparkle decorations, bubble shapes, tech-optimistic vibe.",
  "colors": "#FF69B4 (Hot Pink), #00FFFF (Cyan), #C0C0C0 (Silver), #9400D3 (Purple)",
  "bestFor": "Fashion brands, music platforms, Gen Z brands, nostalgia marketing, entertainment, youth-focused"
 },
 {
  "name": "Cyberpunk UI",
  "keywords": "Design a cyberpunk interface. Use: neon colors on dark (#0D0D0D), terminal/HUD aesthetic, glitch effects, scanlines overlay, matrix green accents, monospace fonts, angular shapes, dystopian tech feel.",
  "colors": "#00FF00 (Matrix Green), #FF00FF (Magenta), #00FFFF (Cyan), #0D0D0D (Dark)",
  "bestFor": "Gaming platforms, tech products, crypto apps, sci-fi applications, developer tools, entertainment"
 },
 {
  "name": "Organic Biophilic",
  "keywords": "Design a biophilic organic interface. Use: nature-inspired colors (greens, browns), organic curved shapes, rounded corners (16-24px), natural textures (wood, stone), flowing SVG elements, wellness aesthetic, earthy palette.",
  "colors": "#228B22 (Forest Green), #8B4513 (Earth Brown), #87CEEB (Sky Blue), #F5F5DC (Beige)",
  "bestFor": "Wellness apps, sustainability brands, eco products, health apps, meditation, organic food brands"
 },
 {
  "name": "AI-Native UI",
  "keywords": "Design an AI-native interface. Use: minimal chrome, conversational layout, streaming text area, typing indicators (3-dot pulse), context cards, subtle AI accent color (#6366F1), clean input field, response bubbles.",
  "colors": "Neutral + single accent, #6366F1 (AI Purple), #10B981 (Success), #F5F5F5 (Background)",
  "bestFor": "AI products, chatbots, voice assistants, copilots, AI-powered tools, conversational interfaces"
 },
 {
  "name": "Memphis Design",
  "keywords": "Design a Memphis style interface. Use: bold geometric shapes (triangles, squiggles, circles), bright clashing colors, 80s postmodern aesthetic, playful patterns, dotted textures, asymmetric layouts, decorative elements.",
  "colors": "#FF71CE (Hot Pink), #FFCE5C (Yellow), #86CCCA (Teal), #6A7BB4 (Blue Purple)",
  "bestFor": "Creative agencies, music sites, youth brands, event promotion, artistic portfolios, entertainment"
 },
 {
  "name": "Dimensional Layering",
  "keywords": "Design with dimensional layering. Use: z-index depth (multiple layers), overlapping cards, elevation shadows (4 levels), floating elements, parallax depth, backdrop blur for hierarchy, spatial UI feel.",
  "colors": "Neutral base (#FFFFFF, #F5F5F5, #E0E0E0) + brand accent for elevated elements",
  "bestFor": "Dashboards, card layouts, modals, navigation, product showcases, SaaS interfaces"
 },
 {
  "name": "Exaggerated Minimalism",
  "keywords": "Design with exaggerated minimalism. Use: oversized typography (clamp 3rem-12rem), extreme negative space, black/white primary, single accent color only, bold statements, minimal elements, dramatic contrast.",
  "colors": "#000000 (Black), #FFFFFF (White), single vibrant accent only",
  "bestFor": "Fashion, architecture, portfolios, agency landing pages, luxury brands, editorial"
 },
 {
  "name": "Kinetic Typography",
  "keywords": "Design with kinetic typography. Use: animated text, scroll-triggered reveals, typing effects, letter-by-letter animations, morphing text, gradient text fills, oversized hero text, text as the main visual element.",
  "colors": "Flexible - high contrast recommended, bold colors for emphasis, animation-friendly palette",
  "bestFor": "Hero sections, marketing sites, video platforms, storytelling, creative portfolios, landing pages"
 },
 {
  "name": "Parallax Storytelling",
  "keywords": "Design a parallax storytelling page. Use: scroll-driven narrative, layered backgrounds (3-5 layers), fixed/sticky sections, cinematic transitions, progressive disclosure, full-screen chapters, depth perception.",
  "colors": "Story-dependent, often gradients and natural colors, section-specific palettes",
  "bestFor": "Brand storytelling, product launches, case studies, portfolios, annual reports, marketing campaigns"
 },
 {
  "name": "HUD / Sci-Fi FUI",
  "keywords": "Design a futuristic HUD (Heads Up Display) or FUI. Use: thin lines (1px), neon cyan/blue on black, technical markers, decorative brackets, data visualization, monospaced tech fonts, glowing elements, transparency.",
  "colors": "Neon Cyan #00FFFF, Holographic Blue #0080FF, Alert Red #FF0000",
  "bestFor": "Sci-fi games, space tech, cybersecurity, movie props, immersive dashboards"
 },
 {
  "name": "Pixel Art",
  "keywords": "Design a pixel art inspired interface. Use: pixelated fonts, 8-bit or 16-bit aesthetic, sharp edges (image-rendering: pixelated), limited color palette, blocky UI elements, retro gaming feel.",
  "colors": "Primary colors (NES Palette), brights, limited palette",
  "bestFor": "Indie games, retro tools, creative portfolios, nostalgia marketing, Web3/NFT"
 },
 {
  "name": "Spatial UI (VisionOS)",
  "keywords": "Design a VisionOS-style spatial interface. Use: frosted glass panels, depth layers, translucent backgrounds (15-30% opacity), vibrant colors for active states, gaze-hover effects, floating windows, immersive feel.",
  "colors": "Frosted Glass #FFFFFF (15-30% opacity), System White",
  "bestFor": "Spatial computing apps, VR/AR interfaces, immersive media, futuristic dashboards"
 },
 {
  "name": "E-Ink / Paper",
  "keywords": "Design an e-ink/paper style interface. Use: high contrast black on off-white, paper texture, no animations (instant transitions), reading-focused, minimal UI chrome, distraction-free, calm aesthetic, monochrome.",
  "colors": "Off-White #FDFBF7, Paper White #F5F5F5, Ink Black #1A1A1A",
  "bestFor": "Reading apps, digital newspapers, minimal journals, distraction-free writing, slow-living brands"
 },
 {
  "name": "Gen Z Chaos / Maximalism",
  "keywords": "Design a Gen Z chaos maximalist interface. Use: clashing bright colors, sticker overlays, collage aesthetic, raw/unpolished feel, mixed media, ironic elements, loud typography, GIF-heavy, internet culture references.",
  "colors": "Clashing Brights: #FF00FF, #00FF00, #FFFF00, #0000FF",
  "bestFor": "Gen Z lifestyle brands, music artists, creative portfolios, viral marketing, fashion"
 },
 {
  "name": "Biomimetic / Organic 2.0",
  "keywords": "Design a biomimetic organic interface. Use: cellular/fluid shapes, breathing animations, generative patterns, bioluminescent colors, physics-based movement, nature algorithms, life-like elements, flowing gradients.",
  "colors": "Cellular Pink #FF9999, Chlorophyll Green #00FF41, Bioluminescent Blue",
  "bestFor": "Sustainability tech, biotech, advanced health, meditation, generative art platforms"
 },
 {
  "name": "Anti-Polish / Raw Aesthetic",
  "keywords": "Design with anti-polish raw aesthetic. Use: hand-drawn elements, scanned textures, unfinished look, paper/pencil textures, collage style, authentic imperfection, sketch marks, tape/sticker overlays, human touch.",
  "colors": "Paper White #FAFAF8, Pencil Grey #4A4A4A, Marker Black #1A1A1A, Kraft Brown #C4A77D",
  "bestFor": "Creative portfolios, artist sites, indie brands, handmade products, authentic storytelling, editorial"
 },
 {
  "name": "Tactile Digital / Deformable UI",
  "keywords": "Design a tactile deformable interface. Use: jelly/squishy buttons, press deformation effect, bounce-back animations, chrome/clay materials, spring physics, haptic-like feedback, material response, 3D depth on interaction.",
  "colors": "Gradient metallics, Chrome Silver #C0C0C0, Jelly Pink #FF9ECD, Soft Blue #87CEEB",
  "bestFor": "Modern mobile apps, playful brands, entertainment, gaming UI, consumer products, interactive demos"
 },
 {
  "name": "Nature Distilled",
  "keywords": "Design with nature distilled aesthetic. Use: muted earthy colors (terracotta, sand, olive), organic materials feel, warm tones, handmade warmth, natural textures, artisan quality, sustainable vibe, soft gradients.",
  "colors": "Terracotta #C67B5C, Sand Beige #D4C4A8, Warm Clay #B5651D, Soft Cream #F5F0E1",
  "bestFor": "Wellness brands, sustainable products, artisan goods, organic food, spa/beauty, home decor"
 },
 {
  "name": "Interactive Cursor Design",
  "keywords": "Design with interactive cursor effects. Use: custom cursor, cursor morphing on hover, magnetic cursor pull, cursor trails, blend mode cursors, click feedback animations, cursor as interaction tool, pointer transformation.",
  "colors": "Brand-dependent, cursor accent color, high contrast for visibility",
  "bestFor": "Creative portfolios, interactive experiences, agency sites, product showcases, gaming, entertainment"
 },
 {
  "name": "Voice-First Multimodal",
  "keywords": "Design a voice-first multimodal interface. Use: voice waveform visualization, listening state indicator, speaking animation, minimal visible UI, audio feedback cues, hands-free optimized, conversational flow, ambient design.",
  "colors": "Calm neutrals: Soft White #FAFAFA, Muted Blue #6B8FAF, Gentle Purple #9B8FBB",
  "bestFor": "Voice assistants, accessibility apps, hands-free tools, smart home, automotive UI, cooking apps"
 },
 {
  "name": "3D Product Preview",
  "keywords": "Design a 3D product preview interface. Use: 360° rotation, drag-to-spin, pinch-to-zoom, AR preview button, material/color switcher, hotspot annotations, orbit controls, product configurator, smooth rendering.",
  "colors": "Product-dependent, neutral backgrounds: Soft Grey #E8E8E8, Pure White #FFFFFF",
  "bestFor": "E-commerce, furniture, fashion, automotive, electronics, jewelry, product configurators"
 },
 {
  "name": "Editorial Grid / Magazine",
  "keywords": "Design an editorial magazine layout. Use: asymmetric grid, pull quotes, drop caps, multi-column text, large imagery, bylines, section dividers, print-inspired typography, article hierarchy, white space balance.",
  "colors": "High contrast: Black #000000, White #FFFFFF, accent brand color",
  "bestFor": "News sites, blogs, magazines, editorial content, long-form articles, journalism, publishing"
 },
 {
  "name": "Vintage Analog / Retro Film",
  "keywords": "Design with vintage analog film aesthetic. Use: film grain overlay, faded/desaturated colors, warm sepia tones, light leaks, VHS tracking effect, polaroid frame, analog warmth, nostalgic photography feel.",
  "colors": "Faded Cream #F5E6C8, Warm Sepia #D4A574, Muted Teal #4A7B7C, Soft Pink #E8B4B8",
  "bestFor": "Photography portfolios, music/vinyl brands, vintage fashion, nostalgia marketing, film industry, cafes"
 },
 {
  "name": "Bauhaus (包豪斯)",
  "keywords": "Design a Bauhaus (包豪斯) mobile interface using bauhaus, geometric, constructivist, primary colors, hard shadow, bold, tactile, functional. Prioritize clear hierarchy, safe areas, touch targets, visible focus, and reduced-motion alternatives.",
  "colors": "Primary Red #D02020, Primary Blue #1040C0, Primary Yellow #F0C020",
  "bestFor": "Mobile-first apps needing high personality, onboarding flows, branding-forward product screens, artisan/design brands, e"
 },
 {
  "name": "Material 3 Expressive (Mobile)",
  "keywords": "Design a Material 3 Expressive mobile interface with vibrant semantic color, contrasting shapes, flexible typography, adaptive components, spring motion, and reduced-motion alternatives.",
  "colors": "Primary Violet #6750A4, Secondary Container #E8DEF8, Tertiary #7D5260",
  "bestFor": "Android, Wear OS, and Pixel-aligned products using Material 3 components"
 },
 {
  "name": "Fluent 2",
  "keywords": "Design a Fluent 2 product surface using calm hierarchy, standardized corners, semantic tokens, subtle depth, and platform-aware components. Preserve Microsoft interaction patterns and accessible focus states.",
  "colors": "Fluent neutral palette with brand and status tokens",
  "bestFor": "Microsoft 365, Windows, Copilot, and enterprise line-of-business tools"
 },
 {
  "name": "Shopify Polaris",
  "keywords": "Design a Shopify Polaris merchant workflow using official web components, admin-native hierarchy, clear actions, semantic status feedback, and consistent commerce patterns. Keep scope tied to Shopify surfaces.",
  "colors": "Shopify admin semantic tokens and merchant brand accents",
  "bestFor": "Shopify admin apps, merchant tools, checkout, customer accounts, POS, and extensions"
 },
 {
  "name": "Adobe Spectrum",
  "keywords": "Design an Adobe Spectrum professional tool with tokenized color, precise hierarchy, dense but legible controls, strong focus states, and cross-platform component consistency.",
  "colors": "Spectrum semantic colors with product-specific accents",
  "bestFor": "Creative tools, media workflows, document products, and Adobe-adjacent enterprise software"
 }
];
