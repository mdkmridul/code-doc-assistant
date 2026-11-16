import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseFilters,
} from '@nestjs/common';
import {
  AnswerQuestion,
  GetSession,
  StartSession,
  type AnswerQuestionResult,
  type SessionTranscript,
} from '@cda/domain';
import type { Response } from 'express';
import { z } from 'zod';
import { openSse } from '../common/sse';
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
  private readonly logger = new Logger(SessionsController.name);

  constructor(
    private readonly startSession: StartSession,
    private readonly answerQuestion: AnswerQuestion,
    private readonly getSession: GetSession,
  ) {}

  /** The session, its repo label and every message so far. 404 unknown session. */
  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe()) sessionId: string,
  ): Promise<SessionTranscript> {
    return this.getSession.execute(sessionId);
  }

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

  /**
   * Same as POST /sessions/:id/messages, streamed as Server-Sent Events
   * (ChatStreamEvent from @cda/domain/events): token, tool_call, tool_result,
   * then done or error. Bad input and unknown sessions fail with a normal
   * 400/404 before the stream opens. If the client disconnects, the loop is
   * aborted and the session records the answer as cancelled.
   */
  @Post(':id/messages/stream')
  async askStream(
    @Param('id', new ParseUUIDPipe()) sessionId: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const { content } = parse(postMessageBody, body);
    await this.getSession.execute(sessionId); // 404 before streaming

    const sse = openSse(res);
    const disconnect = new AbortController();
    sse.onClose(() => disconnect.abort());
    try {
      await this.answerQuestion.execute(
        { sessionId, question: content },
        { onEvent: (event) => sse.send(event), signal: disconnect.signal },
      );
    } catch (error) {
      this.logger.error(
        `Streaming answer for ${sessionId} failed: ${String(error)}`,
      );
      sse.send({
        type: 'error',
        message: error instanceof Error ? error.message : 'The answer failed.',
      });
    } finally {
      sse.close();
    }
  }
}
