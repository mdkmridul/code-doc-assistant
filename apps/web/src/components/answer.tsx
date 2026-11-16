"use client";

import type { Citation } from "@cda/domain/events";
import { createContext, useContext, useMemo, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseReference, resolvePath } from "@/lib/turns";
import { cn } from "@/lib/utils";

export const citationLabel = (c: Citation) =>
  `${c.path}:${c.startLine}${c.endLine !== c.startLine ? `-${c.endLine}` : ""}`;

const sameCitation = (a: Citation | null, b: Citation) =>
  a !== null && a.path === b.path && a.startLine === b.startLine && a.endLine === b.endLine;

/** A clickable citation chip: highlights the cited lines in the sources panel. */
export function CitationChip({
  citation,
  text,
  active,
  onCite,
}: {
  citation: Citation;
  text?: string;
  active: boolean;
  onCite: (citation: Citation) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        // The answer container selects its turn on click (and clears the citation).
        event.stopPropagation();
        onCite(citation);
      }}
      aria-pressed={active}
      title={`Show ${citationLabel(citation)} in sources`}
      className={cn(
        "rounded-md border px-1.5 py-0.5 font-mono text-[0.8em] transition-colors",
        "border-primary/20 bg-primary/5 text-primary hover:bg-primary/10",
        active && "border-primary bg-primary text-primary-foreground hover:bg-primary",
      )}
    >
      {text ?? citationLabel(citation)}
    </button>
  );
}

interface CitationContextValue {
  sourcePaths: string[];
  activeCitation: Citation | null;
  onCite: (citation: Citation) => void;
}

const CitationContext = createContext<CitationContextValue | null>(null);

/** Inline code; a chip when it reads like a citation of a file among the sources. */
function InlineCode({ className, children, ...rest }: ComponentProps<"code">) {
  const context = useContext(CitationContext);
  const raw = typeof children === "string" ? children : null;
  const reference = raw && !className && !raw.includes("\n") ? parseReference(raw) : null;
  const path = context && reference ? resolvePath(reference.path, context.sourcePaths) : null;
  if (context && reference && path) {
    const citation = { ...reference, path };
    return (
      <CitationChip
        citation={citation}
        text={raw ?? undefined}
        active={sameCitation(context.activeCitation, citation)}
        onCite={context.onCite}
      />
    );
  }
  return (
    <code className={className} {...rest}>
      {children}
    </code>
  );
}

const MARKDOWN_COMPONENTS = { code: InlineCode };
const REMARK_PLUGINS = [remarkGfm];

/** An answer rendered as markdown. Raw HTML is never rendered (react-markdown's default). */
export function Answer({
  text,
  sourcePaths,
  activeCitation,
  onCite,
  streaming = false,
}: {
  text: string;
  sourcePaths: string[];
  activeCitation: Citation | null;
  onCite: (citation: Citation) => void;
  streaming?: boolean;
}) {
  const context = useMemo(
    () => ({ sourcePaths, activeCitation, onCite }),
    [sourcePaths, activeCitation, onCite],
  );
  return (
    <CitationContext.Provider value={context}>
      <div
        className={cn(
          "prose prose-sm prose-neutral max-w-none dark:prose-invert",
          "prose-pre:border prose-pre:bg-muted prose-pre:text-foreground",
          "prose-code:before:content-none prose-code:after:content-none",
          "prose-headings:font-semibold prose-headings:tracking-tight",
          streaming && "streaming-caret",
        )}
      >
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
          {text}
        </ReactMarkdown>
      </div>
    </CitationContext.Provider>
  );
}

export { sameCitation };
