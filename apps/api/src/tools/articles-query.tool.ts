import type { ArticleQueryInput } from '../articles/article-query.js'
import type { ToolDefinition, ToolExecutionContext, ToolExecutor, ValidatedToolInvocation } from './core/tool.types.js'
import { Inject, Injectable } from '@nestjs/common'
import { articleObservation, articleQuerySchema, parseArticleQuery } from '../articles/article-query.js'
import { ArticleService } from '../articles/article.service.js'

export const articlesQueryDefinition: ToolDefinition<ArticleQueryInput> = {
  name: 'articles_query',
  version: '1',
  description: '查询公司公开文章清单。publishedFrom/publishedTo按北京时间筛选当前published_at（不是首次发布），locale默认all，q只匹配slug。summary为整个筛选范围的文章篇数和语言URL数，articles为分页明细；limit默认20最多50。翻页传sourceRevision与nextOffset作为offset，refresh可显式更新5分钟缓存。语言仅按上游声明，非正文完整性或收录证明。没有标题、正文和可靠的运营归属。搜索表现另用gsc_query，收录另用gsc_inspect；使用返回URL且核对Google所选站点覆盖这些URL。',
  input: { schema: articleQuerySchema, parse: parseArticleQuery },
  timeoutMs: 30_000,
  maxObservationChars: 24_000,
}
@Injectable()
export class ArticlesQueryTool implements ToolExecutor<ArticleQueryInput> {
  constructor(@Inject(ArticleService) private readonly articles: ArticleService) {}
  async execute({ input }: ValidatedToolInvocation<ArticleQueryInput>, context: ToolExecutionContext) {
    context.signal.throwIfAborted()
    try {
      return { ok: true as const, modelContent: articleObservation(await this.articles.query(input, context.signal)) }
    }
    catch (error) {
      context.signal.throwIfAborted()
      return { ok: false as const, code: 'execution_failed' as const, modelContent: error instanceof Error ? error.message : '文章查询失败，未取得数据' }
    }
  }
}
