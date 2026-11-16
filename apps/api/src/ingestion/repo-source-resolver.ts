import { BadRequestException, Injectable } from '@nestjs/common';
import type { RepoSource } from '@cda/domain';
import { z } from 'zod';
import { stageUpload } from '../infrastructure/workspace/archive';
import { resolveRemoteHead } from '../infrastructure/workspace/git';
import { normalizeGitHubUrl } from '../infrastructure/workspace/github-url';

const gitRequest = z.object({ url: z.string().min(1) });

export interface UploadedArchive {
  buffer: Buffer;
  originalname: string;
}

/** Turns a POST /repos request into a source pinned to a commit or content hash. */
@Injectable()
export class RepoSourceResolver {
  async resolve(
    body: unknown,
    upload: UploadedArchive | undefined,
  ): Promise<RepoSource> {
    const hasUrl = typeof body === 'object' && body !== null && 'url' in body;
    if (upload && hasUrl) {
      throw new BadRequestException(
        'Send either a GitHub url or a zip file, not both',
      );
    }
    if (upload) return stageUpload(upload.buffer, upload.originalname);

    const parsed = gitRequest.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        'Send JSON {"url": "https://github.com/<owner>/<repo>"} or a multipart "file" field with a .zip',
      );
    }
    const url = normalizeGitHubUrl(parsed.data.url);
    const commitSha = await resolveRemoteHead(url);
    return { type: 'git', url, commitSha };
  }
}
