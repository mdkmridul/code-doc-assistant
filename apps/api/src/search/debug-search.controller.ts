import {
  BadRequestException,
  Controller,
  Get,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  invokeTool,
  SearchCodeTool,
  ToolInputError,
  type SearchCodeOutput,
} from '@cda/domain';

/**
 * TEMPORARY: lets a developer try `search_code` over HTTP before the chat
 * endpoint exists. Remove it once the assistant calls the tool. Never
 * registered in production (see SearchModule.forRoot).
 *
 * GET /debug/search?repoId=<uuid>&q=<question>[&topK=8][&path=src/][&language=typescript]
 */
@Controller('debug')
export class DebugSearchController {
  constructor(private readonly searchCode: SearchCodeTool) {}

  @Get('search')
  async search(
    @Query('repoId', new ParseUUIDPipe()) repoId: string,
    @Query('q') q?: string,
    @Query('topK') topK?: string,
    @Query('path') path?: string,
    @Query('language') language?: string,
  ): Promise<SearchCodeOutput> {
    try {
      // Same validation path the model's tool calls will take.
      return await invokeTool(
        this.searchCode,
        {
          query: q,
          topK: topK === undefined ? undefined : Number(topK),
          pathPrefix: path,
          language,
        },
        { repoId },
      );
    } catch (error) {
      if (error instanceof ToolInputError) {
        throw new BadRequestException(error.issues);
      }
      throw error;
    }
  }
}
