import { Injectable } from '@nestjs/common';
import type {
  ChatSession,
  ChatStore,
  Citation,
  StoredMessage,
  ToolCallTrace,
} from '@cda/domain';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

/** Prisma's Json input type; our traces and citations are plain JSON data. */
const asJson = (value: unknown) => value as Prisma.InputJsonValue;

@Injectable()
export class PrismaChatStore implements ChatStore {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(repoId: string): Promise<{ id: string }> {
    return this.prisma.chatSession.create({
      data: { repoId },
      select: { id: true },
    });
  }

  async findSession(id: string): Promise<ChatSession | null> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id },
      include: { repo: { select: { url: true, localPath: true } } },
    });
    if (!session) return null;
    return {
      id: session.id,
      repoId: session.repoId,
      repoLabel: session.repo.url ?? session.repo.localPath ?? session.repoId,
    };
  }

  async listMessages(sessionId: string): Promise<StoredMessage[]> {
    const rows = await this.prisma.message.findMany({
      where: { sessionId, role: { in: ['user', 'assistant'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row): StoredMessage =>
      row.role === 'user'
        ? {
            id: row.id,
            role: 'user',
            content: row.content,
            createdAt: row.createdAt,
          }
        : {
            id: row.id,
            role: 'assistant',
            content: row.content,
            toolCalls: (row.toolCalls ?? []) as unknown as ToolCallTrace[],
            citations: (row.citations ?? []) as unknown as Citation[],
            createdAt: row.createdAt,
          },
    );
  }

  addUserMessage(sessionId: string, content: string): Promise<{ id: string }> {
    return this.prisma.message.create({
      data: { sessionId, role: 'user', content },
      select: { id: true },
    });
  }

  addAssistantMessage(
    sessionId: string,
    message: {
      content: string;
      toolCalls: ToolCallTrace[];
      citations: Citation[];
    },
  ): Promise<{ id: string }> {
    return this.prisma.message.create({
      data: {
        sessionId,
        role: 'assistant',
        content: message.content,
        toolCalls: asJson(message.toolCalls),
        citations: asJson(message.citations),
      },
      select: { id: true },
    });
  }
}
