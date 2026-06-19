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
        newChat: '新建对话',
        productSubtitle: 'SEO 聊天工作台',
        recentChats: '最近对话',
        searchRecentChats: '搜索最近对话',
        emptyRecentTitle: '还没有历史任务',
        emptyRecentDescription: '发起一次页面诊断后，这里会保留最近的 SEO 对话。',
      },
      mobileNavigation: {
        open: '打开导航',
        title: '导航',
        description: '主导航和最近对话',
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
    validation: {
      messageRequired: '请输入你想和 SEO Agent 讨论的问题。',
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
        newChat: 'New chat',
        productSubtitle: 'SEO chat workspace',
        recentChats: 'Recent chats',
        searchRecentChats: 'Search recent chats',
        emptyRecentTitle: 'No history yet',
        emptyRecentDescription: 'After you start a page audit, recent SEO chats will appear here.',
      },
      mobileNavigation: {
        open: 'Open navigation',
        title: 'Navigation',
        description: 'Main navigation and recent chats',
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
    validation: {
      messageRequired: 'Enter the question you want to discuss with the SEO Agent.',
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
