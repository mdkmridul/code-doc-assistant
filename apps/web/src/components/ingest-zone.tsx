"use client";

import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FolderGit2Icon,
  Loader2Icon,
  RotateCcwIcon,
  UploadIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RepoProgress } from "@/lib/api";

export type IngestState =
  | { kind: "empty" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | {
      kind: "tracking";
      label: string;
      progress: RepoProgress | null;
      commitSha: string | null;
      deduplicated: boolean;
    };

const STATUS_COPY = {
  queued: "Queued",
  running: "Indexing",
  ready: "Ready",
  failed: "Failed",
} as const;

/** The thin strip showing where an ingest stands. */
function ProgressStrip({ state }: { state: Extract<IngestState, { kind: "tracking" }> }) {
  const progress = state.progress;
  const status = progress?.status ?? "queued";
  const working = status === "queued" || status === "running";
  const counts = progress
    ? `${progress.fileCount.toLocaleString()} files · ${progress.chunkCount.toLocaleString()} chunks`
    : "Connecting…";

  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {working ? (
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-hidden />
        ) : status === "ready" ? (
          <CheckCircle2Icon className="size-4 text-emerald-600" aria-hidden />
        ) : (
          <AlertCircleIcon className="size-4 text-destructive" aria-hidden />
        )}
        <span className="min-w-0 truncate font-medium" title={state.label}>
          {state.label}
        </span>
        <Badge variant={status === "failed" ? "destructive" : status === "ready" ? "secondary" : "outline"}>
          {STATUS_COPY[status]}
        </Badge>
        <span className="text-xs text-muted-foreground tabular-nums">{counts}</span>
        {state.commitSha && (
          <span className="font-mono text-xs text-muted-foreground">@{state.commitSha.slice(0, 7)}</span>
        )}
        {state.deduplicated && status === "ready" && (
          <span className="text-xs text-muted-foreground">· already indexed</span>
        )}
      </div>
      {working && (
        // Indeterminate: the total number of files is not known until the end.
        <div
          role="progressbar"
          aria-label="Indexing progress"
          aria-valuetext={counts}
          className="relative h-1 overflow-hidden rounded-full bg-muted"
        >
          <div className="absolute inset-y-0 w-1/3 rounded-full bg-primary animate-indeterminate" />
        </div>
      )}
      {status === "failed" && progress?.error && (
        <p className="text-xs text-destructive">{progress.error}</p>
      )}
    </div>
  );
}

/** Ingest zone: a GitHub URL or a zip, then a progress strip until the repo is ready. */
export function IngestZone({
  state,
  onSubmitUrl,
  onSubmitZip,
  onReset,
}: {
  state: IngestState;
  onSubmitUrl: (url: string) => void;
  onSubmitZip: (file: File) => void;
  onReset: () => void;
}) {
  const [url, setUrl] = useState("");
  const [zip, setZip] = useState<File | null>(null);
  const busy = state.kind === "submitting";

  if (state.kind === "tracking") {
    const finished = state.progress?.status === "ready" || state.progress?.status === "failed";
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <ProgressStrip state={state} />
        </div>
        {finished && (
          <Button variant="outline" size="sm" onClick={onReset} className="self-start sm:self-auto">
            <RotateCcwIcon data-icon="inline-start" />
            Ingest another
          </Button>
        )}
      </div>
    );
  }

  function submitUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmitUrl(url.trim());
  }
  function submitZip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (zip) onSubmitZip(zip);
  }

  return (
    <div className="flex flex-col gap-3">
      <Tabs defaultValue="github" className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Index a repository to ask questions about its code.
          </p>
          <TabsList>
            <TabsTrigger value="github">
              <FolderGit2Icon /> GitHub URL
            </TabsTrigger>
            <TabsTrigger value="zip">
              <UploadIcon /> Upload zip
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="github">
          <form onSubmit={submitUrl} className="flex gap-2">
            <label htmlFor="repo-url" className="sr-only">
              Public GitHub URL
            </label>
            <Input
              id="repo-url"
              type="url"
              required
              placeholder="https://github.com/owner/repo"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
              className="font-mono text-sm"
            />
            <Button type="submit" disabled={busy || url.trim() === ""}>
              {busy && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
              Ingest
            </Button>
          </form>
        </TabsContent>
        <TabsContent value="zip">
          <form onSubmit={submitZip} className="flex gap-2">
            <label htmlFor="repo-zip" className="sr-only">
              Zip of local files (max 50 MB)
            </label>
            <Input
              id="repo-zip"
              type="file"
              accept=".zip,application/zip"
              required
              onChange={(e) => setZip(e.target.files?.[0] ?? null)}
              disabled={busy}
            />
            <Button type="submit" disabled={busy || !zip}>
              {busy && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
              Upload
            </Button>
          </form>
        </TabsContent>
      </Tabs>

      {state.kind === "error" && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Couldn&apos;t start ingesting</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
          <AlertAction>
            <Button variant="outline" size="sm" onClick={onReset}>
              Dismiss
            </Button>
          </AlertAction>
        </Alert>
      )}
    </div>
  );
}
