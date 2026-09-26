export const messages = {
  'zh-CN': {
    common: {
      appName: 'Agent 工作台',
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
      knowledgeQa: '知识库问答',
      articleSearch: '文章检索',
      runTrace: '运行轨迹',
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
        recentChats: '最近对话',
        renameChat: '重命名',
        searchRecentChats: '搜索最近对话',
        emptyRecentTitle: '还没有历史任务',
      },
      mobileNavigation: {
        open: '打开导航',
        title: '导航',
        description: '主导航和最近对话',
      },
      themeSwitcher: {
        themes: {
          warmLedger: {
            shortLabel: '浅色',
          },
          oliveEmber: {
            shortLabel: '余烬',
          },
        },
      },
      settings: {
        trigger: '用户设置',
        open: '设置',
        title: '设置',
        close: '关闭设置',
        nav: {
          general: '通用',
        },
        sections: {
          appearance: '外观',
          language: '语言',
        },
        theme: {
          label: '主题',
        },
        inkLevel: {
          label: '文字亮度',
          options: {
            soft: '柔和',
            standard: '标准',
            bright: '高亮',
          },
        },
        language: {
          label: '界面语言',
        },
      },
    },
    conversation: {
      avatarAlt: 'AI 助手头像',
      userAvatarAlt: '我的头像',
      emptyTitle: '今天想了解什么？',
      thinking: '思考中',
      aborted: '已停止生成',
      fallbackError: '模型服务暂时没有返回结果，你的输入已保留，可以稍后重试。',
      actions: {
        copyReply: '复制',
        copiedReply: '已复制',
        scrollToBottom: '直达底部',
        codeBlock: {
          copy: '复制代码',
          copied: '已复制',
          preview: '预览（暂不可用）',
          code: '代码',
          generating: '正在生成...',
        },
      },
      starterPrompts: {
        ask: {
          label: '基于站内资料提问',
          prompt: '请基于站内文章回答我的问题；资料不足时直接说明无法确认。我会在下一条消息里描述问题。',
        },
        search: {
          label: '按关键词找文章',
          prompt: '请帮我按关键词查找站内已有文章，列出标题、简介和 sourceId。我会给出关键词。',
        },
        capabilities: {
          label: '了解它能做什么',
          prompt: '请介绍一下你能做什么：可以查哪些资料、有哪些工具，以及什么情况下会说明无法确认。',
        },
      },
    },
    composer: {
      placeholderHints: {
        ask: '输入你的问题，或让我检索站内资料…',
        search: '按关键词找找相关文章…',
      },
      modelSelectAria: '选择模型与思考强度',
      modelPlaceholder: '选择模型',
      reasoningEffortLabel: '思考强度',
      moreModels: '更多模型',
      reasoningEffortDefault: '默认',
      reasoningEffortDefaultWith: '默认（{effort}）',
      reasoningEffort: {
        low: 'Low',
        medium: 'Medium',
        high: 'High',
        xhigh: 'XHigh',
        max: 'Max',
      },
      replyPlaceholder: '继续追问…',
      attachSoon: '添加内容（即将支持）',
      disclaimer: '回答由 AI 生成，可能出错。',
      send: '发送消息',
      stop: '停止生成',
    },
    runtime: {
      balance: {
        loading: '正在读取余额',
        empty: '余额 --',
      },
      errors: {
        models: '模型列表读取失败，请检查后台模型配置',
      },
      modelReplaced: '所选模型已不可用，已切换为 {name}',
      modelUnavailable: '所选模型已不可用，后台当前没有可用模型',
    },
  },
  'en-US': {
    common: {
      appName: 'Agent Workspace',
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
      knowledgeQa: 'Knowledge Q&A',
      articleSearch: 'Article search',
      runTrace: 'Run trace',
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
        recentChats: 'Recent chats',
        renameChat: 'Rename',
        searchRecentChats: 'Search recent chats',
        emptyRecentTitle: 'No history yet',
      },
      mobileNavigation: {
        open: 'Open navigation',
        title: 'Navigation',
        description: 'Main navigation and recent chats',
      },
      themeSwitcher: {
        themes: {
          warmLedger: {
            shortLabel: 'Light',
          },
          oliveEmber: {
            shortLabel: 'Ember',
          },
        },
      },
      settings: {
        trigger: 'User settings',
        open: 'Settings',
        title: 'Settings',
        close: 'Close settings',
        nav: {
          general: 'General',
        },
        sections: {
          appearance: 'Appearance',
          language: 'Language',
        },
        theme: {
          label: 'Theme',
        },
        inkLevel: {
          label: 'Text brightness',
          options: {
            soft: 'Soft',
            standard: 'Standard',
            bright: 'Bright',
          },
        },
        language: {
          label: 'Interface language',
        },
      },
    },
    conversation: {
      avatarAlt: 'AI assistant avatar',
      userAvatarAlt: 'My avatar',
      emptyTitle: 'What would you like to know today?',
      thinking: 'Thinking',
      aborted: 'Generation stopped',
      fallbackError: 'The model service did not return a response. Your input is still here, so you can try again later.',
      actions: {
        copyReply: 'Copy',
        copiedReply: 'Copied',
        scrollToBottom: 'Scroll to bottom',
        codeBlock: {
          copy: 'Copy code',
          copied: 'Copied',
          preview: 'Preview (unavailable)',
          code: 'Code',
          generating: 'Generating...',
        },
      },
      starterPrompts: {
        ask: {
          label: 'Ask the knowledge base',
          prompt: 'Please answer my question from the article library. If the material is not enough, say so instead of guessing. I will describe the question in my next message.',
        },
        search: {
          label: 'Find articles by keyword',
          prompt: 'Please find existing articles in the library by keyword and list their titles, summaries, and sourceIds. I will provide the keywords.',
        },
        capabilities: {
          label: 'See what it can do',
          prompt: 'Please tell me what you can do: which material you can look up, which tools you have, and when you will say something cannot be confirmed.',
        },
      },
    },
    composer: {
      placeholderHints: {
        ask: 'Ask a question or have me search the article library…',
        search: 'Find related articles by keyword…',
      },
      modelSelectAria: 'Select model and reasoning effort',
      modelPlaceholder: 'Select a model',
      reasoningEffortLabel: 'Effort',
      moreModels: 'More models',
      reasoningEffortDefault: 'Default',
      reasoningEffortDefaultWith: 'Default ({effort})',
      reasoningEffort: {
        low: 'Low',
        medium: 'Medium',
        high: 'High',
        xhigh: 'XHigh',
        max: 'Max',
      },
      replyPlaceholder: 'Reply…',
      attachSoon: 'Add content (coming soon)',
      disclaimer: 'Answers are AI-generated and may be wrong.',
      send: 'Send message',
      stop: 'Stop generation',
    },
    runtime: {
      balance: {
        loading: 'Loading balance',
        empty: 'Balance --',
      },
      errors: {
        models: 'Failed to load models. Check the model settings in Admin.',
      },
      modelReplaced: 'The selected model is no longer available. Switched to {name}.',
      modelUnavailable: 'The selected model is no longer available, and no other model is enabled.',
    },
  },
} as const
