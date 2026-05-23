import process from 'node:process'

import { AgentRunner } from '../agent/runner.js'
import { createDeepSeekClient } from '../deepseek/client.js'

const agent = new AgentRunner({
  client: createDeepSeekClient(),
  systemPrompt: [
    '你是一个用于学习 Agent 开发的助手。',
    '当用户询问当前时间时，优先使用工具，而不是凭空猜测。',
    '回答要简洁，并说明工具在流程中的作用。',
  ].join('\n'),
})

async function main() {
  const answer = await agent.ask('现在上海是什么时间？顺便解释一下这次工具调用发生在 Agent loop 的哪一步。')

  console.log(answer)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
