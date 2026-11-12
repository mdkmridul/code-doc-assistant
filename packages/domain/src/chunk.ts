export interface Chunk {
  id: string;
  repoId: string;
  path: string;
  language: string;
  symbol: string | null;
  kind: "function" | "class" | "method" | "block";
  startLine: number;
  endLine: number;
  content: string;
  contentHash: string;
}