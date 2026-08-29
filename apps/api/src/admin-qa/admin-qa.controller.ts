import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common'

import { AdminQaService } from './admin-qa.service.js'
// DTO classes are required at runtime for Nest decorator metadata.
// eslint-disable-next-line ts/consistent-type-imports
import {
  ListQaArticlesQueryDto,
  ListQaGlossaryTermsQueryDto,
  QaArticleIdParamDto,
  QaDiagnoseBodyDto,
  QaGlossaryIdParamDto,
  QaReviewBodyDto,
  QaTranslateBodyDto,
  QaTranslationParamDto,
} from './dto/admin-qa.dto.js'

@Controller('admin/qa')
export class AdminQaController {
  constructor(
    @Inject(AdminQaService)
    private readonly adminQaService: AdminQaService,
  ) {}

  @Get('articles')
  listArticles(@Query() query: ListQaArticlesQueryDto) {
    return this.adminQaService.listArticles(query)
  }

  @Get('articles/:articleId')
  getArticleDetail(@Param() params: QaArticleIdParamDto) {
    return this.adminQaService.getArticleDetail(params.articleId)
  }

  @Get('articles/:articleId/translations/:languageCode')
  getTranslationDetail(@Param() params: QaTranslationParamDto) {
    return this.adminQaService.getTranslationDetail(params.articleId, params.languageCode)
  }

  @Post('articles/:articleId/translations/:languageCode/score')
  scoreTranslation(@Param() params: QaTranslationParamDto) {
    return this.adminQaService.scoreTranslation(params.articleId, params.languageCode)
  }

  @Post('articles/:articleId/translations/:languageCode/review')
  reviewTranslation(
    @Param() params: QaTranslationParamDto,
    @Body() body: QaReviewBodyDto,
  ) {
    return this.adminQaService.reviewTranslation(params.articleId, params.languageCode, body)
  }

  @Post('articles/:articleId/translate')
  requestTranslation(
    @Param() params: QaArticleIdParamDto,
    @Body() body: QaTranslateBodyDto,
  ) {
    return this.adminQaService.requestTranslation(params.articleId, body.languageCode)
  }

  @Post('articles/:articleId/diagnose')
  diagnose(
    @Param() params: QaArticleIdParamDto,
    @Body() body: QaDiagnoseBodyDto,
  ) {
    return this.adminQaService.diagnose(params.articleId, body.question)
  }

  @Get('articles/:articleId/diagnose')
  listDiagnoseMessages(@Param() params: QaArticleIdParamDto) {
    return this.adminQaService.listDiagnoseMessages(params.articleId)
  }

  @Get('glossaries')
  listGlossaries() {
    return this.adminQaService.listGlossaries()
  }

  @Get('glossaries/:glossaryId/terms')
  listGlossaryTerms(
    @Param() params: QaGlossaryIdParamDto,
    @Query() query: ListQaGlossaryTermsQueryDto,
  ) {
    return this.adminQaService.listGlossaryTerms(params.glossaryId, query)
  }
}
