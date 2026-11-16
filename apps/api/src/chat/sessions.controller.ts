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
  AnswerQuestion,
  StartSession,
  type AnswerQuestionResult,
} from '@cda/domain';
import { z } from 'zod';
import { ChatErrorFilter } from './chat-error.filter';
import { MAX_QUESTION_CHARS } from './chat.constants';

const createSessionBody = z.object({ repoId: z.uuid() }).strict();
const postMessageBody = z
  .object({ content: z.string().trim().min(1).max(MAX_QUESTION_CHARS) })
  .strict();

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException(
      result.error.issues.map(
        (i) => `${i.path.join('.') || 'body'}: ${i.message}`,
      ),
    );
  }
  return result.data;
}

@Controller('sessions')
@UseFilters(ChatErrorFilter)
export class SessionsController {
  constructor(
    private readonly startSession: StartSession,
    private readonly answerQuestion: AnswerQuestion,
  ) {}

  /** `{"repoId": "<uuid>"}` → 201 `{ id, repoId }`. 404 unknown repo, 409 not ready yet. */
  @Post()
  create(@Body() body: unknown): Promise<{ id: string; repoId: string }> {
    const { repoId } = parse(createSessionBody, body);
    return this.startSession.execute(repoId);
  }

  /**
   * `{"content": "<question>"}` → 200 with the full answer once the agent loop
   * finishes (no streaming yet). 404 unknown session, 502 model failure.
   */
  @Post(':id/messages')
  @HttpCode(HttpStatus.OK)
  ask(
    @Param('id', new ParseUUIDPipe()) sessionId: string,
    @Body() body: unknown,
  ): Promise<AnswerQuestionResult> {
    const { content } = parse(postMessageBody, body);
    return this.answerQuestion.execute({ sessionId, question: content });
  }
}
