import { Logger } from '@nestjs/common'

// 测试里故意制造的失败（代理连不上、Run 超时等）会打 WARN / ERROR，看起来像真报错；这里关掉 Nest 日志输出。
// 断言日志的用例 spy 的是 Logger 实例或原型方法，不受影响。
Logger.overrideLogger(false)
