/// <reference types="multer" />
import { rm } from 'node:fs/promises';
import {
  Body,
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { GetRepo, RegisterRepo, type RepoView } from '@cda/domain';
import type { Response } from 'express';
import { MAX_UPLOAD_BYTES } from '../infrastructure/workspace/archive';
import { RepoSourceResolver } from './repo-source-resolver';
import { SourceErrorFilter } from './source-error.filter';

export interface RegisterRepoResponse {
  id: string;
  status: string;
  /** True when this exact source version was already queued, running or ready. */
  deduplicated: boolean;
}

@Controller('repos')
@UseFilters(SourceErrorFilter)
export class ReposController {
  constructor(
    private readonly registerRepo: RegisterRepo,
    private readonly getRepo: GetRepo,
    private readonly sources: RepoSourceResolver,
  ) {}

  /**
   * Accepts `{"url": "https://github.com/<owner>/<repo>"}` (JSON) or a zip in
   * the multipart field `file`. 202 when a new ingest is queued, 200 when the
   * same source version already exists.
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  async create(
    @Body() body: unknown,
    @UploadedFile() upload: Express.Multer.File | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RegisterRepoResponse> {
    const source = await this.sources.resolve(body, upload);
    const discardStagedUpload = () =>
      source.type === 'local'
        ? rm(source.archivePath, { force: true })
        : Promise.resolve();

    let result: Awaited<ReturnType<RegisterRepo['execute']>>;
    try {
      result = await this.registerRepo.execute(source);
    } catch (error) {
      await discardStagedUpload();
      throw error;
    }
    // No job will consume this upload: the same content is already ingested or in flight.
    if (!result.enqueued) await discardStagedUpload();

    res.status(result.enqueued ? HttpStatus.ACCEPTED : HttpStatus.OK);
    return {
      id: result.repo.id,
      status: result.repo.status,
      deduplicated: !result.enqueued,
    };
  }

  @Get(':id')
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<RepoView> {
    const repo = await this.getRepo.execute(id);
    if (!repo) throw new NotFoundException(`Repo ${id} not found`);
    return repo;
  }
}
