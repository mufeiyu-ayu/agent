# 公司文章清单

`articles_query` 通过 `ArticleService` 读取 `ARTICLE_SITE_URL` 下固定的 `/api/user/slugs` 和 `/api/user/languages`，不请求详情正文、不增加网站浏览量。Google 私人数据仍由已有个人连接查询；文章清单本身是公开数据。

`article-query.ts` 同时维护工具 Schema、输入校验、清单规范化、筛选计数及完整 JSON 输出。按北京时间筛选当前 published_at；重新发布会改变该字段，不提供首次发布、翻译上线或运营个人绩效推断。以 slug 去重；文章篇数与语言 URL 数分开，零语言文章仍保留。默认英文无前缀，其他启用语言用 /{locale}/blogs/detail/{slug}。

语言为公开 API 声明的 indexable_locales 与启用语言交集，不独立验证标题/正文。接口缺字段不回退全语言；非博客排除项由部署者按公司前端 sitemap 配置 `ARTICLE_EXCLUDED_SLUGS`。没有标题时直接显示 slug。

清单缓存5分钟，返回 fetchedAt 和 sourceRevision；分页应带 sourceRevision，变版明确失败。单次最多50篇，模型输出按完整文章裁剪并推进 nextOffset，summary 始终是整个筛选范围计数。

测试：`article-query.test.ts` 覆盖日期/多语言/去重/来源版本/输出边界；`article.service.test.ts` 覆盖固定请求、缓存、取消与上游失败。真实公开数据验证单独显式运行，不在普通单测中联网。
