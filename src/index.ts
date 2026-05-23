import process from 'node:process'

import { AgentRunner } from './agent/runner.js'
import { createDeepSeekClient } from './deepseek/client.js'

const agent = new AgentRunner({
  client: createDeepSeekClient(),
  systemPrompt: [
    '你是一个面向初学者的 Agent 开发学习搭档。',
    '回答时优先使用清晰的小例子，避免不必要的框架术语。',
  ].join('\n'),
})

async function main() {
  const answer = await agent.ask('请用三点说明：学习 Agent 开发时，为什么要先掌握模型调用、上下文和工具调用？')

  console.log(answer)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
