"use client";

import type { Citation } from "@cda/domain/events";
import { AlertCircleIcon, BookOpenIcon, FileCode2Icon, RouteIcon, SearchIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { overlaps, type Source } from "@/lib/turns";
import { cn } from "@/lib/utils";

export type SourcesState =
  | { kind: "empty"; reason: "no-session" | "no-answer" | "no-sources" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; sources: Source[]; live: boolean };

const lineNumbers = (source: Source) =>
  source.startLine === source.endLine
    ? `line ${source.startLine}`
    : `lines ${source.startLine}–${source.endLine}`;

/** How each kind of excerpt reached the model. */
const SOURCE_KINDS = {
  read: { icon: FileCode2Icon, label: "Read with read_file" },
  search: { icon: SearchIcon, label: "Search hit (snippet)" },
  endpoint: { icon: RouteIcon, label: "Route declaration (list_endpoints)" },
} satisfies Record<Source["source"], { icon: typeof SearchIcon; label: string }>;

function SourceCard({ source, citation }: { source: Source; citation: Citation | null }) {
  const SourceIcon = SOURCE_KINDS[source.source].icon;
  const ref = useRef<HTMLLIElement>(null);
  const codeRef = useRef<HTMLPreElement>(null);
  const cited = citation !== null && overlaps(source, citation);

  // Bring the cited card into view, then scroll its code to the first cited line.
  useEffect(() => {
    if (!cited) return;
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const firstHit = codeRef.current?.querySelector<HTMLElement>("[data-hit]");
    if (codeRef.current && firstHit) {
      codeRef.current.scrollTop = Math.max(0, firstHit.offsetTop - codeRef.current.clientHeight / 4);
    }
  }, [cited, citation]);

  const lines = source.text.split("\n");
  return (
    <li
      ref={ref}
      data-cited={cited || undefined}
      className={cn(
        "overflow-hidden rounded-lg border bg-card transition-shadow",
        cited && "border-primary ring-2 ring-primary/20",
      )}
    >
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <SourceIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium" title={source.path}>
          {source.path}
        </span>
        <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
          {lineNumbers(source)}
        </Badge>
      </div>
      <pre ref={codeRef} className="relative max-h-56 overflow-auto py-2 text-[11px] leading-[1.15rem]">
        <code className="grid min-w-max">
          {lines.map((line, i) => {
            const n = source.startLine + i;
            const hit = cited && citation !== null && n >= citation.startLine && n <= citation.endLine;
            return (
              <span key={n} data-hit={hit || undefined} className={cn("flex px-3", hit && "bg-primary/10")}>
                <span className="w-10 shrink-0 select-none pr-3 text-right text-muted-foreground/70">
                  {n}
                </span>
                <span className={cn("whitespace-pre", hit && "font-medium")}>{line || " "}</span>
              </span>
            );
          })}
        </code>
      </pre>
      <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        {SOURCE_KINDS[source.source].label}
      </p>
    </li>
  );
}

const EMPTY_COPY = {
  "no-session": {
    title: "No sources yet",
    body: "Ingest a repository and ask a question. The code the assistant reads will show up here.",
  },
  "no-answer": {
    title: "Ask a question",
    body: "Every search hit and file the assistant reads while answering is listed here, so you can check its claims.",
  },
  "no-sources": {
    title: "No code was read",
    body: "This answer didn't use any tools, so there is nothing to show.",
  },
} as const;

/** The code an answer was based on, with citation highlighting. */
export function SourcesPanel({
  state,
  citation,
}: {
  state: SourcesState;
  citation: Citation | null;
}) {
  if (state.kind === "loading") {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading sources">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2 rounded-lg border p-3">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-4/6" />
          </div>
        ))}
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertTitle>Sources unavailable</AlertTitle>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }

  if (state.kind === "empty" || state.sources.length === 0) {
    const copy = EMPTY_COPY[state.kind === "empty" ? state.reason : "no-sources"];
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center">
        <BookOpenIcon className="size-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">{copy.title}</p>
        <p className="max-w-xs text-xs text-muted-foreground">{copy.body}</p>
      </div>
    );
  }

  return (
    <ol className="space-y-3" aria-label="Sources">
      {state.sources.map((source) => (
        <SourceCard key={source.key} source={source} citation={citation} />
      ))}
      {state.live && (
        <li className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Skeleton className="size-2 rounded-full" /> More sources may arrive while the answer is researched…
        </li>
      )}
    </ol>
  );
}
