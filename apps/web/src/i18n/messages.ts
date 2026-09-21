export const messages = {
  'zh-CN': {
    common: {
      appName: 'Agent 工作台',
      appSubtitle: '知识库问答与多轮对话',
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
        logoAria: '返回 Agent 工作台首页',
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
        ariaLabel: 'Agent 工作流示意',
      },
      hero: {
        title: '把站内知识变成有据可查的回答',
        description: '一个面向知识库问答与多轮对话的 Agent 工作台，让每条回答都基于可核对的站内资料。',
      },
      actions: {
        openWorkspace: '打开工作台',
        openWorkspaceAria: '打开 Agent 工作台',
        analyze: '开始对话',
        analyzeAria: '在 Agent 工作台开始对话',
        viewExample: '查看示例',
      },
      suggestions: {
        ariaLabel: '示例任务',
        hint: '从一个示例开始：',
        ask: {
          label: '基于站内资料提问',
          prompt: '请基于站内文章回答我的问题，并注明引用来源。我会在下一条消息里描述问题。',
        },
        search: {
          label: '按关键词找文章',
          prompt: '帮我按关键词查找站内已有文章，列出标题、简介和 sourceId。我会给出关键词。',
        },
        capabilities: {
          label: '了解它能做什么',
          prompt: '介绍一下你能做什么：可以查哪些资料、有哪些工具、什么情况下会引用来源。',
        },
      },
      form: {
        ariaLabel: 'Agent 静态输入示例',
        topicLabel: '你的问题',
        placeholder: '输入问题，或描述你想了解的内容...',
        animatedPrompts: {
          question: '输入一个问题，从站内资料里找答案...',
          retrieve: '让 Agent 检索相关文章并注明来源...',
          followUp: '继续追问，回答会带上可核对的引用...',
        },
        submit: '提交示例',
      },
    },
    navigation: {
      knowledgeQa: '知识库问答',
      articleSearch: '文章检索',
      citedSources: '引用来源',
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
      },
    },
    conversation: {
      avatarAlt: 'AI 助手头像',
      emptyTitle: '今天想了解什么？',
      lastReply: '上次回复 {time}',
      loading: '正在处理你的问题...',
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
      grounding: {
        status: {
          answered: '这条回答引用了检索到的资料。',
          conflicting: '检索到的资料之间存在冲突，请自行核对下面的内容。',
          insufficientWithEvidence: '检索到了相关资料，但内容不足以支撑确定结论。',
          insufficientNone: '本次没有检索到可用资料，无法据此确认。',
          insufficientUnavailable: '本次检索能力暂时不可用，没有取到任何资料。',
        },
        note: {
          partial: '本次有部分资料链未能取到，下面只列出通过来源校验的内容。',
        },
        sources: {
          answered: '引用来源（{count}）',
          checked: '已检查的资料（{count}）',
          conflicting: '存在冲突的资料（{count}）',
        },
        granularity: {
          article: '整篇文章',
          chunk: '文章片段',
        },
      },
      starterPrompts: {
        ask: {
          label: '基于站内资料提问',
          prompt: '请基于站内文章回答我的问题，并注明引用来源；资料不足时直接说明无法确认。我会在下一条消息里描述问题。',
        },
        search: {
          label: '按关键词找文章',
          prompt: '请帮我按关键词查找站内已有文章，列出标题、简介和 sourceId，方便我进一步读取全文。我会给出关键词。',
        },
        capabilities: {
          label: '了解它能做什么',
          prompt: '请介绍一下你能做什么：可以查哪些资料、有哪些工具、什么情况下会引用来源，以及什么情况下会说明无法确认。',
        },
      },
    },
    composer: {
      placeholder: '输入你的问题，或让我检索站内资料...',
      modelSelectAria: '选择模型与思考强度',
      modelPlaceholder: '选择模型',
      reasoningEffortLabel: '思考强度',
      reasoningEffortDefault: '默认',
      reasoningEffort: {
        minimal: 'Minimal',
        low: 'Low',
        medium: 'Medium',
        high: 'High',
        xhigh: 'XHigh',
        max: 'Max',
      },
      reset: '重置当前对话',
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
        balance: '余额读取失败，请稍后重试',
      },
    },
  },
  'en-US': {
    common: {
      appName: 'Agent Workspace',
      appSubtitle: 'Knowledge base Q&A and multi-turn chat',
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
        logoAria: 'Back to Agent workspace home',
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
        ariaLabel: 'Agent workflow visual',
      },
      hero: {
        title: 'Turn your articles into cited answers',
        description: 'An agent workspace for knowledge base Q&A and conversation that stays grounded in your own sources.',
      },
      actions: {
        openWorkspace: 'Open workspace',
        openWorkspaceAria: 'Open Agent workspace',
        analyze: 'Start a chat',
        analyzeAria: 'Start a chat in the Agent workspace',
        viewExample: 'View example',
      },
      suggestions: {
        ariaLabel: 'Example tasks',
        hint: 'Start from an example:',
        ask: {
          label: 'Ask the knowledge base',
          prompt: 'Answer my question from the article library and cite your sources. I will describe the question in my next message.',
        },
        search: {
          label: 'Find articles by keyword',
          prompt: 'Find existing articles in the library by keyword and list their titles, summaries, and sourceIds. I will provide the keywords.',
        },
        capabilities: {
          label: 'See what it can do',
          prompt: 'Tell me what you can do: which material you can look up, which tools you have, and when you cite sources.',
        },
      },
      form: {
        ariaLabel: 'Agent static input example',
        topicLabel: 'Your question',
        placeholder: 'Ask a question or describe what you need...',
        animatedPrompts: {
          question: 'Ask a question and get answers from your articles...',
          retrieve: 'Let the agent retrieve articles and cite the sources...',
          followUp: 'Keep asking; every reply carries checkable citations...',
        },
        submit: 'Submit static example',
      },
    },
    navigation: {
      knowledgeQa: 'Knowledge Q&A',
      articleSearch: 'Article search',
      citedSources: 'Cited sources',
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
      },
    },
    conversation: {
      avatarAlt: 'AI assistant avatar',
      emptyTitle: 'What would you like to know today?',
      lastReply: 'Last reply {time}',
      loading: 'Working on your question...',
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
      grounding: {
        status: {
          answered: 'This reply cites material found by retrieval.',
          conflicting: 'The retrieved material disagrees. Check the sources below yourself.',
          insufficientWithEvidence: 'Related material was found, but it is not enough to support a firm conclusion.',
          insufficientNone: 'No usable material was found for this question, so nothing could be confirmed.',
          insufficientUnavailable: 'Retrieval was temporarily unavailable, so no material was fetched.',
        },
        note: {
          partial: 'Part of the evidence chain could not be fetched. Only material that passed source validation is listed.',
        },
        sources: {
          answered: 'Cited sources ({count})',
          checked: 'Material checked ({count})',
          conflicting: 'Conflicting material ({count})',
        },
        granularity: {
          article: 'Full article',
          chunk: 'Article section',
        },
      },
      starterPrompts: {
        ask: {
          label: 'Ask the knowledge base',
          prompt: 'Please answer my question from the article library and cite your sources. If the material is not enough, say so instead of guessing. I will describe the question in my next message.',
        },
        search: {
          label: 'Find articles by keyword',
          prompt: 'Please find existing articles in the library by keyword and list their titles, summaries, and sourceIds so I can read the full text later. I will provide the keywords.',
        },
        capabilities: {
          label: 'See what it can do',
          prompt: 'Please tell me what you can do: which material you can look up, which tools you have, when you cite sources, and when you will say something cannot be confirmed.',
        },
      },
    },
    composer: {
      placeholder: 'Ask a question or have me search the article library...',
      modelSelectAria: 'Select model and reasoning effort',
      modelPlaceholder: 'Select a model',
      reasoningEffortLabel: 'Effort',
      reasoningEffortDefault: 'Default',
      reasoningEffort: {
        minimal: 'Minimal',
        low: 'Low',
        medium: 'Medium',
        high: 'High',
        xhigh: 'XHigh',
        max: 'Max',
      },
      reset: 'Reset current chat',
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
        balance: 'Failed to load balance. Please try again later.',
      },
    },
  },
} as const
