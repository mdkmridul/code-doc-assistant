import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
} from '@nestjs/common';
import {
  RETRIEVAL_MODES,
  SearchRepository,
  type SearchCodeOutput,
} from '@cda/domain';
import { z } from 'zod';
import { ChatErrorFilter } from '../chat/chat-error.filter';

/** search_code's own arguments are validated by the tool; only `mode` is ours. */
const searchBody = z.looseObject({
  mode: z.enum(RETRIEVAL_MODES).optional(),
});

@Controller('repos')
@UseFilters(ChatErrorFilter)
export class SearchController {
  constructor(private readonly searchRepository: SearchRepository) {}

  /**
   * `{"query", "topK"?, "pathPrefix"?, "language"?, "mode"?: "vector" | "hybrid"}`
   * → 200 with exactly what search_code returns to the assistant. For
   * measuring retrieval (evals) without a model call. 404 unknown repo, 409
   * not ready, 400 invalid input.
   */
  @Post(':id/search')
  @HttpCode(HttpStatus.OK)
  search(
    @Param('id', new ParseUUIDPipe()) repoId: string,
    @Body() body: unknown,
  ): Promise<SearchCodeOutput> {
    const parsed = searchBody.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map(
          (i) => `${i.path.join('.') || 'body'}: ${i.message}`,
        ),
      );
    }
    const { mode, ...search } = parsed.data;
    return this.searchRepository.execute({
      repoId,
      search,
      ...(mode !== undefined && { retrievalMode: mode }),
    });
  }
}
