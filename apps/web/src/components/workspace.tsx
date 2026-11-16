"use client";

import type { Citation, RepoProgressEvent } from "@cda/domain/events";
import { BookOpenIcon, CodeXmlIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatZone, type ChatState } from "@/components/chat-zone";
import { IngestZone, type IngestState } from "@/components/ingest-zone";
import { SourcesPanel, type SourcesState } from "@/components/sources-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { api, ApiError, isTerminal, type RepoProgress } from "@/lib/api";
import { applyEvent, newTurn, sourcesOf, turnsFromMessages, type Turn } from "@/lib/turns";

const messageOf = (error: unknown) =>
  error instanceof ApiError || error instanceof Error ? error.message : String(error);

/** The lg breakpoint, where the sources panel docks beside the chat. */
const DOCKED = "(min-width: 1024px)";

/**
 * One page, three zones: ingest (with a live progress strip), chat (tool steps
 * above each answer) and sources (the code the selected answer read). The
 * current repo/session live in the URL so a reload restores them.
 */
export function Workspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [ingest, setIngest] = useState<IngestState>({ kind: "empty" });
  const [repoId, setRepoId] = useState<string | null>(null);
  const [repoLabel, setRepoLabel] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<"none" | "loading" | "ready" | { error: string }>("none");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [citation, setCitation] = useState<Citation | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const stream = useRef<AbortController | null>(null);

  const setUrl = useCallback(
    (query: Record<string, string>) => {
      const search = new URLSearchParams(query).toString();
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const openSession = useCallback(
    async (id: string) => {
      setSessionId(id);
      setSession("loading");
      try {
        const transcript = await api.getSession(id);
        const restored = turnsFromMessages(transcript.messages);
        setRepoId(transcript.repoId);
        setRepoLabel(transcript.repoLabel);
        setTurns(restored);
        setSelectedTurnId(restored.at(-1)?.id ?? null);
        setSession("ready");
        // The ingest strip shows the repo this session is about.
        const repo = await api.getRepo(transcript.repoId).catch(() => null);
        setIngest({
          kind: "tracking",
          label: transcript.repoLabel,
          commitSha: repo?.commitSha ?? null,
          deduplicated: false,
          progress: repo && {
            repoId: repo.id,
            status: repo.status,
            fileCount: repo.fileCount,
            chunkCount: repo.chunkCount,
            error: repo.error,
          },
        });
      } catch (error) {
        setSession({ error: messageOf(error) });
      }
    },
    [],
  );

  // Restore from the URL once, on first load.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const sessionParam = params.get("session");
    const repoParam = params.get("repo");
    if (sessionParam) {
      void openSession(sessionParam);
    } else if (repoParam) {
      setRepoId(repoParam);
      api
        .getRepo(repoParam)
        .then((repo) => {
          const label = repo.source.type === "git" ? repo.source.url : repo.source.fileName;
          setRepoLabel(label);
          setIngest({ kind: "tracking", label, progress: null, commitSha: null, deduplicated: false });
        })
        .catch((error: unknown) => setIngest({ kind: "error", message: messageOf(error) }));
    }
  }, [params, openSession]);

  // Follow ingest progress over SSE while a repo is being indexed.
  const tracking = ingest.kind === "tracking" && !sessionId ? repoId : null;
  useEffect(() => {
    if (!tracking) return;
    const source = new EventSource(api.repoEventsUrl(tracking));
    source.addEventListener("progress", (message) => {
      const { progress } = JSON.parse((message as MessageEvent<string>).data) as RepoProgressEvent;
      setIngest((current) => (current.kind === "tracking" ? { ...current, progress } : current));
      if (isTerminal(progress.status)) source.close();
    });
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        setIngest({ kind: "error", message: "Lost the connection to the progress stream." });
      }
    };
    return () => source.close();
  }, [tracking]);

  // Once the repo is ready, open a session on it.
  const readyRepo =
    ingest.kind === "tracking" && ingest.progress?.status === "ready" && !sessionId ? repoId : null;
  useEffect(() => {
    if (!readyRepo) return;
    let cancelled = false;
    setSession("loading");
    void (async () => {
      try {
        const [created, repo] = await Promise.all([
          api.startSession(readyRepo),
          api.getRepo(readyRepo).catch(() => null),
        ]);
        if (cancelled) return;
        setSessionId(created.id);
        setSession("ready");
        setTurns([]);
        setIngest((current) =>
          current.kind === "tracking" ? { ...current, commitSha: repo?.commitSha ?? null } : current,
        );
        setUrl({ session: created.id });
      } catch (error) {
        if (!cancelled) setSession({ error: messageOf(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readyRepo, setUrl]);

  // Leaving the page closes any answer stream (the API cancels the answer).
  useEffect(() => () => stream.current?.abort(), []);

  async function register(label: string, start: () => ReturnType<typeof api.registerGitHubRepo>) {
    setIngest({ kind: "submitting" });
    try {
      const registered = await start();
      setRepoId(registered.id);
      setRepoLabel(label);
      setIngest({ kind: "tracking", label, progress: null, commitSha: null, deduplicated: registered.deduplicated });
      setUrl({ repo: registered.id });
    } catch (error) {
      setIngest({ kind: "error", message: messageOf(error) });
    }
  }

  function reset() {
    stream.current?.abort();
    setIngest({ kind: "empty" });
    setRepoId(null);
    setRepoLabel("");
    setSessionId(null);
    setSession("none");
    setTurns([]);
    setSelectedTurnId(null);
    setCitation(null);
    setUrl({});
  }

  async function ask(question: string) {
    if (!sessionId) return;
    const id = `turn-${Date.now()}`;
    const controller = new AbortController();
    stream.current = controller;
    setTurns((current) => [...current, newTurn(id, question)]);
    setSelectedTurnId(id);
    setCitation(null);

    const update = (change: (turn: Turn) => Turn) =>
      setTurns((current) => current.map((t) => (t.id === id ? change(t) : t)));

    try {
      await api.askStream(sessionId, question, (event) => update((t) => applyEvent(t, event)), controller.signal);
      // A stream that ends without done/error was cut off.
      update((t) => (t.status === "streaming" ? { ...t, status: "error", error: "The connection closed before the answer finished." } : t));
    } catch (error) {
      if (controller.signal.aborted) {
        update((t) => ({ ...t, status: "done", outcome: "cancelled", answer: t.answer ?? "" }));
      } else {
        update((t) => ({ ...t, status: "error", error: messageOf(error) }));
      }
    } finally {
      stream.current = null;
    }
  }

  function cite(turnId: string, next: Citation) {
    setSelectedTurnId(turnId);
    setCitation(next);
    if (!window.matchMedia(DOCKED).matches) setSheetOpen(true);
  }

  const chatState: ChatState =
    session === "loading"
      ? { kind: "loading" }
      : typeof session === "object"
        ? {
            kind: "error",
            message: session.error,
            onRetry: () => (sessionId ? void openSession(sessionId) : reset()),
          }
        : session === "ready"
          ? { kind: "ready", repoLabel }
          : ingest.kind === "tracking"
            ? { kind: "waiting-for-repo" }
            : { kind: "no-repo" };

  const selected = turns.find((t) => t.id === selectedTurnId) ?? null;
  const selectedSources = selected ? sourcesOf(selected) : [];
  const sourcesState: SourcesState =
    session === "loading"
      ? { kind: "loading" }
      : typeof session === "object"
        ? { kind: "error", message: "The conversation could not be loaded." }
        : session !== "ready"
          ? { kind: "empty", reason: "no-session" }
          : !selected
            ? { kind: "empty", reason: "no-answer" }
            : selected.status === "streaming" && selectedSources.length === 0
              ? { kind: "loading" }
              : selected.status === "error" && selectedSources.length === 0
                ? { kind: "error", message: selected.error ?? "The answer failed before reading any code." }
                : { kind: "ready", sources: selectedSources, live: selected.status === "streaming" };

  const sourcesTitle = (
    <span className="flex items-center gap-2">
      Sources
      {selectedSources.length > 0 && (
        <Badge variant="secondary" className="tabular-nums">
          {selectedSources.length}
        </Badge>
      )}
    </span>
  );

  return (
    <div className="flex h-dvh flex-col bg-muted/40">
      <header className="shrink-0 border-b bg-background">
        <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-3 px-4 lg:px-6">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <CodeXmlIcon className="size-4" aria-hidden />
          </div>
          <div className="leading-tight">
            <h1 className="text-sm font-semibold">Code Documentation Assistant</h1>
            <p className="text-xs text-muted-foreground">Answers grounded in your repository&apos;s code</p>
          </div>
        </div>
      </header>

      <section aria-label="Ingest" className="shrink-0 border-b bg-background">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-3 lg:px-6">
          <IngestZone
            state={ingest}
            onSubmitUrl={(url) => void register(url, () => api.registerGitHubRepo(url))}
            onSubmitZip={(file) => void register(file.name, () => api.registerZip(file))}
            onReset={reset}
          />
        </div>
      </section>

      <main className="mx-auto grid min-h-0 w-full max-w-[1600px] flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] lg:px-6">
        <ChatZone
          state={chatState}
          turns={turns}
          selectedTurnId={selectedTurnId}
          onSelectTurn={(id) => {
            setSelectedTurnId(id);
            setCitation(null);
          }}
          activeCitation={citation}
          onCite={cite}
          onAsk={(q) => void ask(q)}
          onStop={() => stream.current?.abort()}
          headerAction={
            <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setSheetOpen(true)}>
              <BookOpenIcon data-icon="inline-start" />
              Sources{selectedSources.length > 0 ? ` (${selectedSources.length})` : ""}
            </Button>
          }
        />

        <aside
          aria-label="Sources"
          className="hidden min-h-0 flex-col overflow-hidden rounded-xl border bg-background shadow-xs lg:flex"
        >
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
            <BookOpenIcon className="size-4 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-semibold">{sourcesTitle}</h2>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <SourcesPanel state={sourcesState} citation={citation} />
          </div>
        </aside>
      </main>

      {/* Below lg the sources panel is a slide-over, opened from the chat header or a citation. */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>{sourcesTitle}</SheetTitle>
            <SheetDescription>The code the selected answer read.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <SourcesPanel state={sourcesState} citation={citation} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export type { RepoProgress };
