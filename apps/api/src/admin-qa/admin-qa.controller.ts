import { Controller, Get, Inject, Param, Query } from '@nestjs/common'

import { AdminQaService } from './admin-qa.service.js'
// DTO classes are required at runtime for Nest decorator metadata.
// eslint-disable-next-line ts/consistent-type-imports
import { ListQaArticlesQueryDto, ListQaGlossaryTermsQueryDto, QaGlossaryIdParamDto } from './dto/admin-qa.dto.js'

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
