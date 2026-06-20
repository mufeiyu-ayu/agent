---
name: AI SEO Agent
description: 一个克制、舒适、面向产品运营的 SEO 聊天工作台视觉系统。
colors:
  canvas: "oklch(0.955 0.007 72)"
  sidebar: "oklch(0.915 0.010 72)"
  surface: "oklch(0.978 0.004 72)"
  surface-raised: "oklch(0.992 0.002 72)"
  surface-sunken: "oklch(0.890 0.012 72)"
  ink: "oklch(0.190 0.018 65)"
  ink-soft: "oklch(0.300 0.018 65)"
  ink-muted: "oklch(0.455 0.014 65)"
  ink-faint: "oklch(0.610 0.010 65)"
  border: "oklch(0.780 0.012 72)"
  border-soft: "oklch(0.855 0.009 72)"
  border-subtle: "oklch(0.905 0.006 72)"
  primary: "oklch(0.205 0.020 65)"
  primary-hover: "oklch(0.270 0.024 65)"
  accent: "oklch(0.455 0.080 38)"
  accent-soft: "oklch(0.915 0.026 45)"
  moss: "oklch(0.400 0.060 145)"
  moss-soft: "oklch(0.920 0.026 145)"
  copper: "oklch(0.540 0.075 70)"
  copper-soft: "oklch(0.925 0.030 70)"
  user-bubble: "oklch(0.925 0.008 72)"
  user-bubble-text: "oklch(0.190 0.018 65)"
  user-bubble-border: "oklch(0.820 0.010 72)"
  success: "oklch(0.400 0.060 145)"
  warning: "oklch(0.540 0.075 70)"
  danger: "oklch(0.500 0.135 25)"
  brand-olive-canvas: "oklch(0.196 0.010 125)"
  brand-olive-surface: "oklch(0.206 0.012 115)"
  brand-olive-raised: "oklch(0.233 0.016 85)"
  brand-olive-ink: "oklch(0.905 0.024 86)"
  brand-olive-ink-soft: "oklch(0.848 0.029 85)"
  brand-olive-ember: "oklch(0.632 0.109 61)"
  brand-olive-copper: "oklch(0.468 0.082 62)"
  brand-olive-moss: "oklch(0.618 0.056 126)"
typography:
  headline:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, SF Pro Text, SF Pro Display, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "0"
  title:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, SF Pro Text, SF Pro Display, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0"
  body:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, SF Pro Text, SF Pro Display, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.65
    letterSpacing: "0"
  label:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, SF Pro Text, SF Pro Display, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0"
rounded:
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  "2xl": "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "44px"
  button-soft:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "40px"
  composer:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "12px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "44px"
---

# Design System: AI SEO Agent

## 1. Overview

**Creative North Star: "Warm Ledger Workbench"**

AI SEO Agent 的界面应该像一个温暖克制的运营账本工作台：暖灰纸面、深墨文字、低饱和陶土强调和少量语义状态色。它借鉴 Claude 网页端的暖中性、低饱和、文档工具感，但不照搬 Claude 的品牌色和具体视觉语言。页面仍然是给产品运营长期使用的 SEO 聊天工作台。

当前系统采用单一 sans 字体、暖灰主背景、接近纸白的 surface、深墨主操作和低饱和陶土强调。首页 hero 允许使用更强的深色品牌表达：橄榄黑底、烟煤棕层级、低亮羊皮纸文字、少量铜橙和暗橄榄节点，形成进入产品前的品牌记忆。未来 polish 的目标不是把页面做花，而是把聊天场景打磨成可信的 SEO 任务工作台：像 ChatGPT 一样直接可聊，但信息结构更服务 SEO 运营。

这个系统明确拒绝：直接照搬 Claude 或其他 AI 产品外观、复杂沉重的后台菜单、过度装饰、颜色偏重或不搭配、组件库样式堆叠导致的视觉复杂度。

**Key Characteristics:**

- 以聊天为主入口，以 SEO 任务为内容骨架。
- 温暖、清晰、克制，适合长时间运营工作。
- 陶土、深绿、琥珀只用于关键状态和任务提示，不作为大面积装饰。
- 业务布局优先可读，组件库只承接复杂交互。

## 2. Colors

这是一套 restrained product palette，当前命名为 **Warm Ledger Workbench**：暖灰承载应用外壳，纸白 surface 承载输入、浮层和可点击任务，深墨承载主操作，陶土、深绿和琥珀只作为稀缺状态 / 任务信号。

### Primary

- **Ledger Ink Primary** (`primary`): 主按钮、发送按钮、用户头像等关键控制使用的深墨色。它比普通亮蓝更稳，避免页面落入常见 SaaS 模板。
- **Clay Accent** (`accent`): 只用于当前选择、重要 CTA 或 Agent 状态提示。它不是 Claude 的陶土橙复刻，而是更暗、更商业化的低饱和陶土色，面积必须小，出现越少越有意义。
- **Olive Ember Brand** (`brand-olive-*`): 首页 hero 的橄榄余烬色。橄榄黑承载背景和输入框，烟煤棕承载 surface 层级，低亮羊皮纸色承载正文，铜橙用于路径、节点、focus 和主操作，暗橄榄只用于运行感节点。它可以用于 `/workspace` 的配套暗色主题，但不能把首页的大面积宣传视觉搬进工作台。

### Neutral

- **Ledger Canvas** (`canvas`): 全局应用底色。它不是纯白，也不是天空蓝，用轻微暖灰建立纸面感，同时保持 light theme 的清晰度。
- **Ledger Sidebar** (`sidebar`): 侧边栏和移动导航背景，比主工作面略深，用来建立工具外壳层级，但不能变成传统后台深色 menu。
- **Paper Surface / Surface Raised / Surface Sunken** (`surface`, `surface-raised`, `surface-sunken`): 主内容、composer、抽屉、语言切换、hover/focus 的表面层级。静态界面尽量靠这些轻微明度差建立层级。
- **Ink / Ink Soft / Ink Muted / Ink Faint** (`ink`, `ink-soft`, `ink-muted`, `ink-faint`): 正文、次级正文和辅助标签。正文和 placeholder 必须足够深，不能因为底色变灰而降低可读性。
- **Border / Border Soft / Border Subtle** (`border`, `border-soft`, `border-subtle`): 分隔和控件边界。边界优先于大阴影。

### Tertiary

- **Ledger User Bubble** (`user-bubble`): 用户消息气泡的浅暖灰。它可以区分角色，但不要扩展成黄色或奶油色主题。
- **Moss / Copper** (`moss`, `copper`): 深绿用于余额、在线、成功等运行状态；琥珀用于内容、提示和温和警告。两者都只能小面积出现。
- **Success / Warning / Danger** (`success`, `warning`, `danger`): 只用于真实状态，不用于装饰。

### Workspace Themes

- **Warm Ledger Workbench**: `/workspace` 默认主题。保留当前暖灰纸面、深墨主操作和低饱和陶土强调，适合白天办公和长时间阅读。
- **Olive Ember Workspace**: `/workspace` 的首页配套主题。复用 `brand-olive-*` 的橄榄黑、烟煤棕、低亮羊皮纸、铜橙和暗橄榄，但在产品界面中仍遵守 restrained 策略：颜色用于当前选择、主操作、状态和少量导航提示，不用于装饰性大色块。
- 两个工作台主题都必须通过 `--agent-*` token 表达，不在业务组件中继续散落独立 hex 色值。首页 hero 作为品牌表面可以保留更强的局部视觉，但新颜色要回写到本节。

### Named Rules

**The Small Accent Rule.** 陶土、深绿、琥珀在任一屏幕上只能承担关键动作、当前选择、任务类别或状态提示；不要让强调色成为默认装饰。

**The No Heavy Color Rule.** 不要使用大面积高饱和色块。首页应是轻、静、耐看的聊天工作台。

**The Readable Placeholder Rule.** placeholder 也必须清晰可读，不能为了“轻”而低对比。

**The Ledger Light Rule.** 首页 light theme 不使用纯白作为大面积背景。纯白感只能存在于接近白的 raised surface，而不是整个应用 canvas。

**The Workspace Theme Rule.** `/workspace` 可以在暖色和橄榄余烬之间切换；默认暖色必须保留。新增主题只允许覆盖 token，不允许为了换色复制一套页面组件。

## 3. Typography

**Display Font:** Inter with system sans fallback
**Body Font:** Inter with system sans fallback
**Label/Mono Font:** none

**Character:** 字体系统单一、清晰、产品化。它不追求强烈品牌戏剧性，而是保证密集工作状态下的稳定阅读。

### Hierarchy

- **Headline** (800, 18px, 1.25): 顶部页面标题和主要模块标题。不要放大成 landing page hero。
- **Title** (600, 15px, 1.35): 抽屉标题、卡片标题、重要列表项。
- **Body** (500, 15px, 1.65): Agent 回复、用户输入、主要说明文字。长文本行宽建议控制在 65-75ch。
- **Label** (600, 13px, 1.35): 控件标签、状态、辅助说明。不要用大写拉开字距模拟后台标签。
- **Micro Label** (600-700, 12px): 次级状态和计数器，例如字符数、更新时间。必须保持可读，不要低于 `ink-faint`。

### Named Rules

**The Product Type Rule.** 不使用 display 字体和夸张字号；这是任务工具，不是宣传页。

**The One Language Rule.** 面向运营用户的 UI 文案优先中文；模型名、API 名称和协议字段保留英文。

## 4. Elevation

系统使用边界、色块和细微阴影混合表达层级。默认状态应接近平面；阴影只用于浮层、toast、抽屉、输入 composer 这类需要脱离背景的元素。大面积卡片和普通导航项不应同时使用明显边框和大 blur 阴影。

### Shadow Vocabulary

- **Soft Control** (`0 8px 22px rgb(15 23 42 / 8%)`): 小型控件或 composer 的轻阴影。下一轮 polish 应优先降低它的存在感。
- **Accent Lift** (`0 16px 30px rgb(37 99 235 / 20%)`): 当前用于蓝色 CTA。未来只允许保留在一个最关键操作上，或者改为无阴影。
- **Panel Lift** (`0 24px 90px rgb(15 23 42 / 16%)`): 抽屉和移动面板。只用于真正覆盖主界面的浮层。
- **Toast Lift** (`0 18px 45px rgb(37 99 235 / 18%)`): 全局提示。必须短暂出现，不成为页面常驻风格。

### Named Rules

**The Flat-First Rule.** 静态界面默认平；hover、focus、抽屉和 toast 才允许出现提升感。

**The No Ghost-Card Rule.** 不要在普通卡片上同时使用 1px 边框和 16px 以上 blur 的柔影。

## 5. Components

### Buttons

- **Shape:** 主操作使用 pill；普通 icon button 使用 10-12px 圆角或 pill，不能每个控件都过度圆润。
- **Primary:** 深墨色背景、白字、高度 40-44px。发送按钮优先深墨色，避免全页面变成蓝色 SaaS。
- **Accent CTA:** 只允许一个主要入口使用，例如新建对话或当前任务启动。若页面已有发送按钮，侧边栏 CTA 应降低色彩权重。
- **Hover / Focus:** hover 只做轻微背景或边界变化；focus 必须有清楚 ring。不要用跳跃式动效。
- **Disabled:** 用低对比 neutral，但文字和图标仍需清楚表达不可用。

### Chips

- **Style:** 建议 chip 应是可点击的任务启动器，而不是像按钮的 `span`。
- **State:** 未选中使用浅 neutral；选中或 hover 可轻微加深边界。不要给每个 chip 加 shadow。

### Cards / Containers

- **Corner Style:** 业务容器优先 10-16px；composer 可以最多 16px。避免 24px+ 的大卡片圆角成为默认。
- **Background:** 纸白或 `app-surface`，不要新增奶油、甜米色、强渐变背景。
- **Shadow Strategy:** 默认不用阴影，靠边界和空间分层。浮层才使用 Panel Lift。
- **Border:** `border` 或 `border-soft`。边界要轻，不要叠加夸张阴影。
- **Internal Padding:** 普通面板 12-16px，主 composer 12px，聊天内容按文本节奏留白。

### Inputs / Fields

- **Style:** 输入区是核心工作面，应保持宽、稳定、低干扰。边框和背景比阴影更重要。
- **Focus:** focus 使用轻 ring 和边界变化，不能让页面产生强烈蓝光。
- **Placeholder:** 必须清楚、具体、中文为主，例如“输入页面主题、关键词或你想优化的 SEO 问题...”
- **Error / Disabled:** 错误状态使用 rose 系列，错误文案给出可执行修复方式。

### Navigation

- **Style:** 侧边栏是任务导航，不是传统后台 menu。导航项应该围绕 SEO 工作组织，例如页面诊断、关键词想法、内容计划、历史报告。
- **Default:** neutral 文字，轻 hover 背景，不使用大阴影。
- **Active:** 可以使用浅暖灰背景、细边界和低饱和陶土色文字，但不要使用重色块。
- **Mobile:** 抽屉保留，但只在需要时出现；不要让移动端先看到复杂导航。

### Chat Workspace

聊天是首页主场景。对话区域应像 ChatGPT 一样直接、熟悉、低学习成本，但内容结构必须服务 SEO 任务。空状态要提供可点击的 SEO 起始任务；Agent 回复要为后续结构化结果、检查项和下一步动作留出组件空间。

## 6. Do's and Don'ts

### Do:

- **Do** 保持首页是 SEO 聊天工作台，而不是学习演示页。
- **Do** 让用户第一眼看到可以输入 SEO 任务、页面主题、关键词或优化目标。
- **Do** 用中文承载主要 UI 文案，模型名和 API 名称保留英文。
- **Do** 使用深墨色承担主操作，陶土、深绿、琥珀只作为稀缺强调。
- **Do** 优先用边界、间距和层级表达精致感，少用大阴影。
- **Do** 保留强定制业务布局的可读性，复杂交互再交给组件库。

### Don't:

- **Don't** 直接照搬 Claude 或其他现成 AI 产品的外观。
- **Don't** 做成复杂、沉重、难读的后台系统，也不要出现死气沉沉的传统 menu 侧边栏体验。
- **Don't** 使用过度装饰、颜色偏重或不搭配的视觉方案。
- **Don't** 让组件库默认样式堆叠导致页面看起来复杂。
- **Don't** 把普通展示标签做成看似可点但不可交互的按钮。
- **Don't** 在普通卡片上同时使用 1px 边框和大 blur 阴影。
