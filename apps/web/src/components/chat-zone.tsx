"use client";

import type { Citation } from "@cda/domain/events";
import {
  AlertCircleIcon,
  ArrowUpIcon,
  FolderGit2Icon,
  MessageSquareIcon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Answer, CitationChip, sameCitation } from "@/components/answer";
import { ToolSteps } from "@/components/tool-steps";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { sourcesOf, visibleAnswer, type Turn } from "@/lib/turns";
import { cn } from "@/lib/utils";

export type ChatState =
  | { kind: "no-repo" }
  | { kind: "waiting-for-repo" }
  | { kind: "loading" }
  | { kind: "error"; message: string; onRetry: () => void }
  | { kind: "ready"; repoLabel: string };

const OUTCOME_NOTES: Partial<Record<NonNullable<Turn["outcome"]>, string>> = {
  iteration_cap: "Stopped at the research limit — the answer may be incomplete.",
  token_budget: "Stopped at the token budget — the answer may be incomplete.",
  context_budget: "Research stopped at the context budget — the answer is based on what was read so far.",
  truncated: "The answer was cut off at the output limit.",
  refused: "The model declined to answer.",
  cancelled: "Cancelled before it finished.",
};

const EXAMPLES = [
  "Where is the main entry point, and what does it export?",
  "How is configuration loaded and which options are supported?",
  "How are errors handled and reported?",
];

function TurnView({
  turn,
  selected,
  onSelect,
  activeCitation,
  onCite,
}: {
  turn: Turn;
  selected: boolean;
  onSelect: () => void;
  activeCitation: Citation | null;
  onCite: (citation: Citation) => void;
}) {
  const streaming = turn.status === "streaming";
  const text = visibleAnswer(turn);
  const paths = sourcesOf(turn).map((s) => s.path);
  const note = turn.outcome ? OUTCOME_NOTES[turn.outcome] : undefined;

  return (
    <article className="flex flex-col gap-3" aria-label={streaming ? "Answer in progress" : "Question and answer"}>
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          {turn.question}
        </p>
      </div>

      {/* Clicking an answer shows its sources (mouse convenience; the Sources
          button below is the accessible control). The left rule marks the selection. */}
      <div
        onClick={onSelect}
        className={cn(
          "flex flex-col gap-3 border-l-2 border-transparent pl-4",
          selected && "border-primary/60",
        )}
      >
        <ToolSteps steps={turn.steps} active={streaming} />

        {streaming && !text && turn.steps.length === 0 && (
          <div className="space-y-2" aria-label="Thinking">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3.5 w-1/2" />
          </div>
        )}

        {note && <p className="text-xs italic text-muted-foreground">{note}</p>}

        {text && (
          <Answer
            text={text}
            sourcePaths={paths}
            activeCitation={activeCitation}
            onCite={onCite}
            streaming={streaming}
          />
        )}

        {turn.status === "error" && (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>The answer failed</AlertTitle>
            <AlertDescription>{turn.error ?? "Something went wrong."}</AlertDescription>
          </Alert>
        )}

        {(turn.citations.length > 0 || paths.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {turn.citations.length > 0 && <span className="text-xs text-muted-foreground">Cited:</span>}
            {turn.citations.map((citation) => (
              <CitationChip
                key={`${citation.path}:${citation.startLine}-${citation.endLine}`}
                citation={citation}
                active={sameCitation(activeCitation, citation)}
                onCite={onCite}
              />
            ))}
            {paths.length > 0 && (
              <Button
                variant="ghost"
                size="xs"
                className="ml-auto text-muted-foreground"
                aria-pressed={selected}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect();
                }}
              >
                Sources ({new Set(paths).size} files)
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function EmptyState({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="flex size-11 items-center justify-center rounded-full border bg-background text-muted-foreground">
        {icon}
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{body}</p>
      </div>
      {children}
    </div>
  );
}

/** Chat zone: the conversation, tool steps above each answer, and the composer. */
export function ChatZone({
  state,
  turns,
  selectedTurnId,
  onSelectTurn,
  activeCitation,
  onCite,
  onAsk,
  onStop,
  headerAction,
}: {
  state: ChatState;
  turns: Turn[];
  selectedTurnId: string | null;
  onSelectTurn: (id: string) => void;
  activeCitation: Citation | null;
  onCite: (turnId: string, citation: Citation) => void;
  onAsk: (question: string) => void;
  onStop: () => void;
  headerAction?: ReactNode;
}) {
  const [question, setQuestion] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const streaming = turns.some((t) => t.status === "streaming");
  const canAsk = state.kind === "ready" && !streaming;
  const lastTurn = turns.at(-1);
  const lastLength = lastTurn ? visibleAnswer(lastTurn).length + lastTurn.steps.length : 0;

  // Follow the conversation as it grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, lastLength]);

  function submit() {
    const text = question.trim();
    if (!text || !canAsk) return;
    onAsk(text);
    setQuestion("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  let body: ReactNode;
  if (state.kind === "no-repo") {
    body = (
      <EmptyState
        icon={<FolderGit2Icon className="size-5" />}
        title="No repository yet"
        body="Ingest a public GitHub repository or upload a zip above. When it's indexed, ask anything about how the code works."
      />
    );
  } else if (state.kind === "waiting-for-repo") {
    body = (
      <EmptyState
        icon={<FolderGit2Icon className="size-5" />}
        title="Indexing the repository"
        body="You can start asking as soon as indexing finishes. Progress is shown above."
      />
    );
  } else if (state.kind === "loading") {
    body = (
      <div className="space-y-6 p-1" aria-busy="true" aria-label="Loading conversation">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="ml-auto h-9 w-1/2 rounded-2xl" />
            <Skeleton className="h-8 w-full rounded-lg" />
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        ))}
      </div>
    );
  } else if (state.kind === "error") {
    body = (
      <div className="p-1">
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Couldn&apos;t load the conversation</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
          <AlertAction>
            <Button variant="outline" size="sm" onClick={state.onRetry}>
              Try again
            </Button>
          </AlertAction>
        </Alert>
      </div>
    );
  } else if (turns.length === 0) {
    body = (
      <EmptyState
        icon={<MessageSquareIcon className="size-5" />}
        title={`Ask about ${state.repoLabel.replace(/^https:\/\/github\.com\//, "")}`}
        body="Answers are grounded in the repository's code, with the steps taken and the sources read shown alongside."
      >
        <div className="flex max-w-md flex-col gap-2">
          {EXAMPLES.map((example) => (
            <Button
              key={example}
              variant="outline"
              size="sm"
              className="h-auto justify-start whitespace-normal py-2 text-left font-normal"
              onClick={() => onAsk(example)}
            >
              {example}
            </Button>
          ))}
        </div>
      </EmptyState>
    );
  } else {
    body = (
      <div className="flex flex-col gap-8">
        {turns.map((turn) => (
          <TurnView
            key={turn.id}
            turn={turn}
            selected={turn.id === selectedTurnId}
            onSelect={() => onSelectTurn(turn.id)}
            activeCitation={activeCitation}
            onCite={(citation) => onCite(turn.id, citation)}
          />
        ))}
      </div>
    );
  }

  return (
    <section aria-label="Chat" className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-background shadow-xs">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <MessageSquareIcon className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold">Chat</h2>
        {state.kind === "ready" && (
          <span className="min-w-0 truncate text-sm text-muted-foreground">· {state.repoLabel}</span>
        )}
        <div className="ml-auto">{headerAction}</div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6" aria-live="polite">
        {body}
        <div ref={endRef} />
      </div>

      <form
        className="shrink-0 border-t bg-muted/20 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2 rounded-xl border bg-background p-2 focus-within:ring-2 focus-within:ring-ring/30">
          <label htmlFor="question" className="sr-only">
            Your question
          </label>
          <Textarea
            id="question"
            rows={2}
            maxLength={4000}
            placeholder={
              state.kind === "ready"
                ? "Ask how something in this repository works…  (Ctrl/⌘ + Enter to send)"
                : "Ingest a repository to start asking"
            }
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={state.kind !== "ready"}
            className="max-h-40 min-h-10 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          {streaming ? (
            <Button type="button" variant="outline" size="icon" onClick={onStop} aria-label="Stop answering">
              <SquareIcon className="fill-current" />
            </Button>
          ) : (
            <Button type="submit" size="icon" disabled={!canAsk || question.trim() === ""} aria-label="Send question">
              <ArrowUpIcon />
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
