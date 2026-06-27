export const messages = {
  'zh-CN': {
    common: {
      appName: 'AI SEO 工作台',
      appSubtitle: '页面诊断、关键词与内容优化',
      languageSwitcher: {
        ariaLabel: '切换界面语言',
        placeholder: '语言',
      },
      languages: {
        zh: '中文',
        en: 'English',
      },
      actions: {
        close: '关闭',
        refreshBalance: '刷新余额',
        closeAlert: '关闭提示',
      },
    },
    home: {
      header: {
        logoAria: '返回 SEO Agent 首页',
      },
      navigation: {
        ariaLabel: '首页导航',
        product: '产品',
        workflow: '工作流',
        useCases: '使用场景',
        pricing: '价格',
        resources: '资源',
      },
      workflow: {
        ariaLabel: 'SEO Agent 工作流示意',
      },
      hero: {
        title: '把页面变成可搜索的 SEO 简报',
        description: '一个面向页面诊断、关键词和内容规划的 AI 工作台，让输出始终基于真实页面上下文。',
      },
      actions: {
        openWorkspace: '打开工作台',
        openWorkspaceAria: '打开 AI SEO 工作台',
        analyze: '分析页面',
        analyzeAria: '在 SEO Agent 工作台分析页面',
        viewExample: '查看示例',
      },
      suggestions: {
        ariaLabel: '示例任务',
        hint: '从一个示例开始：',
        audit: {
          label: '诊断落地页 SEO',
          prompt: '帮我诊断这个落地页的 SEO：重点看 title、description、页面结构和关键词覆盖。',
        },
        keywords: {
          label: '生成关键词想法',
          prompt: '基于我的产品页生成 SEO 关键词想法：核心词、长尾词和不同搜索意图。',
        },
        content: {
          label: '规划内容结构',
          prompt: '帮我规划这个页面的内容结构：H1、H2/H3、FAQ 和转化段落。',
        },
      },
      form: {
        ariaLabel: 'SEO Agent 静态输入示例',
        topicLabel: '页面主题',
        placeholder: '粘贴 URL 或描述你要优化的页面...',
        animatedPrompts: {
          url: '粘贴产品页 URL，开始一次页面诊断...',
          brief: '描述落地页，生成可执行的 SEO 简报...',
          keywords: '输入关键词目标，规划内容结构和优化方向...',
        },
        submit: '提交示例',
      },
    },
    navigation: {
      pageAudit: '页面诊断',
      keywordIdeas: '关键词想法',
      contentPlan: '内容计划',
      seoChecklist: 'SEO 检查清单',
      history: '历史对话',
      settings: '设置',
    },
    layout: {
      sidebar: {
        expand: '展开导航',
        collapse: '收起导航',
        close: '关闭导航',
        chatOptions: '对话选项',
        deleteChat: '删除对话',
        newChat: '新建对话',
        productSubtitle: 'SEO 聊天工作台',
        recentChats: '最近对话',
        renameChat: '重命名',
        searchRecentChats: '搜索最近对话',
        emptyRecentTitle: '还没有历史任务',
        emptyRecentDescription: '发起一次页面诊断后，这里会保留最近的 SEO 对话。',
      },
      mobileNavigation: {
        open: '打开导航',
        title: '导航',
        description: '主导航和最近对话',
      },
      themeSwitcher: {
        ariaLabel: '切换工作台颜色主题',
        placeholder: '主题',
        themes: {
          warmLedger: {
            label: '经典浅色',
            shortLabel: '浅色',
          },
          oliveEmber: {
            label: '橄榄余烬',
            shortLabel: '余烬',
          },
        },
      },
      settings: {
        trigger: '用户设置',
        close: '关闭设置',
        account: '账户信息',
        notifications: '通知设置',
        help: '使用帮助',
        preferences: '偏好设置',
        balanceTitle: 'DeepSeek 余额',
      },
    },
    conversation: {
      avatarAlt: 'AI 助手头像',
      emptyTitle: '今天要优化哪个页面？',
      emptyDescription: '直接输入页面主题、目标关键词或产品信息。AI SEO Agent 会围绕页面诊断、关键词、内容结构和转化建议继续追问。',
      lastReply: '上次回复 {time}',
      loading: '正在分析 SEO 任务...',
      aborted: '已停止生成',
      fallbackError: '模型服务暂时没有返回结果，你的输入已保留，可以稍后重试。',
      actions: {
        copyReply: '复制',
        copiedReply: '已复制',
      },
      starterPrompts: {
        audit: {
          label: '诊断落地页 SEO',
          description: 'title、description、页面结构',
          prompt: '请帮我诊断一个落地页的 SEO，重点看 title、description、页面结构和关键词覆盖。我会补充页面主题和目标关键词。',
        },
        keywords: {
          label: '生成关键词想法',
          description: '核心词、长尾词、搜索意图',
          prompt: '请基于一个产品页面帮我生成 SEO 关键词想法，包括核心关键词、长尾关键词和不同搜索意图。我会提供产品和目标市场。',
        },
        content: {
          label: '规划内容结构',
          description: 'H1-H3、FAQ、转化段落',
          prompt: '请帮我规划一个 SEO 页面内容结构，包括 H1、H2/H3、FAQ 和转化段落。我会提供页面主题、目标用户和关键词。',
        },
      },
    },
    composer: {
      placeholder: '输入页面主题、关键词或你想优化的 SEO 问题...',
      modelSelectAria: '选择模型',
      modelPlaceholder: 'DeepSeek 模型',
      reset: '重置当前对话',
      send: '发送消息',
    },
    runtime: {
      balance: {
        loading: '正在读取余额',
        empty: '余额 --',
      },
      errors: {
        models: '模型列表读取失败，已使用默认 DeepSeek 模型',
        balance: '余额读取失败，请稍后重试',
      },
    },
  },
  'en-US': {
    common: {
      appName: 'AI SEO Workspace',
      appSubtitle: 'Page audits, keywords, and content optimization',
      languageSwitcher: {
        ariaLabel: 'Switch interface language',
        placeholder: 'Language',
      },
      languages: {
        zh: '中文',
        en: 'English',
      },
      actions: {
        close: 'Close',
        refreshBalance: 'Refresh balance',
        closeAlert: 'Close alert',
      },
    },
    home: {
      header: {
        logoAria: 'Back to SEO Agent home',
      },
      navigation: {
        ariaLabel: 'Home navigation',
        product: 'Product',
        workflow: 'How it works',
        useCases: 'Use cases',
        pricing: 'Pricing',
        resources: 'Resources',
      },
      workflow: {
        ariaLabel: 'SEO Agent workflow visual',
      },
      hero: {
        title: 'Turn pages into search-ready briefs',
        description: 'An AI workspace for audits, keywords, and content plans that stays grounded in page context.',
      },
      actions: {
        openWorkspace: 'Open workspace',
        openWorkspaceAria: 'Open AI SEO workspace',
        analyze: 'Analyze a page',
        analyzeAria: 'Analyze a page in SEO Agent workspace',
        viewExample: 'View example',
      },
      suggestions: {
        ariaLabel: 'Example tasks',
        hint: 'Start from an example:',
        audit: {
          label: 'Audit landing page SEO',
          prompt: 'Audit this landing page for SEO — focus on title, description, page structure, and keyword coverage.',
        },
        keywords: {
          label: 'Generate keyword ideas',
          prompt: 'Generate SEO keyword ideas for my product page: head terms, long-tail variants, and different search intents.',
        },
        content: {
          label: 'Plan content structure',
          prompt: 'Plan the content structure for this page: H1, H2/H3, FAQ, and conversion sections.',
        },
      },
      form: {
        ariaLabel: 'SEO Agent static input example',
        topicLabel: 'Page topic',
        placeholder: 'Drop a URL or describe the page...',
        animatedPrompts: {
          url: 'Paste a product page URL for an audit...',
          brief: 'Describe a landing page to shape the SEO brief...',
          keywords: 'Ask for keywords, fixes, or content angles...',
        },
        submit: 'Submit static example',
      },
    },
    navigation: {
      pageAudit: 'Page audit',
      keywordIdeas: 'Keyword ideas',
      contentPlan: 'Content plan',
      seoChecklist: 'SEO checklist',
      history: 'Chat history',
      settings: 'Settings',
    },
    layout: {
      sidebar: {
        expand: 'Expand navigation',
        collapse: 'Collapse navigation',
        close: 'Close navigation',
        chatOptions: 'Chat options',
        deleteChat: 'Delete chat',
        newChat: 'New chat',
        productSubtitle: 'SEO chat workspace',
        recentChats: 'Recent chats',
        renameChat: 'Rename',
        searchRecentChats: 'Search recent chats',
        emptyRecentTitle: 'No history yet',
        emptyRecentDescription: 'After you start a page audit, recent SEO chats will appear here.',
      },
      mobileNavigation: {
        open: 'Open navigation',
        title: 'Navigation',
        description: 'Main navigation and recent chats',
      },
      themeSwitcher: {
        ariaLabel: 'Switch workspace color theme',
        placeholder: 'Theme',
        themes: {
          warmLedger: {
            label: 'Classic light',
            shortLabel: 'Light',
          },
          oliveEmber: {
            label: 'Olive ember',
            shortLabel: 'Ember',
          },
        },
      },
      settings: {
        trigger: 'User settings',
        close: 'Close settings',
        account: 'Account',
        notifications: 'Notifications',
        help: 'Help',
        preferences: 'Preferences',
        balanceTitle: 'DeepSeek balance',
      },
    },
    conversation: {
      avatarAlt: 'AI assistant avatar',
      emptyTitle: 'Which page are we optimizing today?',
      emptyDescription: 'Enter a page topic, target keywords, or product details. The AI SEO Agent will ask follow-up questions around page audits, keywords, content structure, and conversion ideas.',
      lastReply: 'Last reply {time}',
      loading: 'Analyzing the SEO task...',
      aborted: 'Generation stopped',
      fallbackError: 'The model service did not return a response. Your input is still here, so you can try again later.',
      actions: {
        copyReply: 'Copy',
        copiedReply: 'Copied',
      },
      starterPrompts: {
        audit: {
          label: 'Audit landing page SEO',
          description: 'title, description, page structure',
          prompt: 'Help me audit a landing page for SEO. Focus on title, description, page structure, and keyword coverage. I will provide the page topic and target keywords.',
        },
        keywords: {
          label: 'Generate keyword ideas',
          description: 'Seed terms, long-tail terms, search intent',
          prompt: 'Help me generate SEO keyword ideas for a product page, including seed keywords, long-tail keywords, and search intent groups. I will provide the product and target market.',
        },
        content: {
          label: 'Plan content structure',
          description: 'H1-H3, FAQ, conversion copy',
          prompt: 'Help me plan an SEO page content structure, including H1, H2/H3, FAQ, and conversion sections. I will provide the topic, audience, and keywords.',
        },
      },
    },
    composer: {
      placeholder: 'Enter a page topic, keywords, or the SEO question you want to optimize...',
      modelSelectAria: 'Select model',
      modelPlaceholder: 'DeepSeek model',
      reset: 'Reset current chat',
      send: 'Send message',
    },
    runtime: {
      balance: {
        loading: 'Loading balance',
        empty: 'Balance --',
      },
      errors: {
        models: 'Failed to load models. Using the default DeepSeek models.',
        balance: 'Failed to load balance. Please try again later.',
      },
    },
  },
} as const
