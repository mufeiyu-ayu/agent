import { Module } from '@nestjs/common'
import { ArticleService } from './article.service.js'

@Module({ providers: [ArticleService], exports: [ArticleService] })
export class ArticlesModule {}
