# 0014 — One-page UI on shadcn/ui and Tailwind, with persisted source excerpts

The web app is one page with three zones: ingest with a live progress strip, chat with each answer's tool steps shown inline above it, and a sources panel listing the code the selected answer actually read. It is built with Tailwind CSS 4 (through `@tailwindcss/postcss`, as the bundled Next.js docs describe) and shadcn/ui (Radix base, Nova preset), with Tailwind Typography for rendered answers. This replaces the earlier default-styled, two-page app.

**shadcn/ui over a component library dependency.** shadcn copies component source into `src/components/ui`, so we own and can change every component. It still gives accessible Radix primitives for the parts that are hard to get right: tabs, collapsible, sheet and tooltip. A packaged library such as MUI or Chakra would bring its own styling system next to Tailwind and be harder to restyle.

**Excerpts travel with the answer.** Sources must show the chunks the model actually read, not chunks found again later. So every tool now reports `excerpts` (path, line range, text, and whether it was a search hit or a `read_file`). They stream in `tool_result` events and are stored in the answer's existing `messages.tool_calls` JSON. A reloaded session shows the same tool steps and sources it showed live, with no new table and no extra request. We cap `read_file` excerpts at 8,000 characters to keep stored messages small. Answers stored before this change have no excerpts, and the UI shows them without sources.

**Docked panel on laptops, sheet below `lg`.** At 1024 px and above, the sources panel sits beside the chat. Below that it is a slide-over sheet, opened from the chat header or by clicking a citation, so chat keeps the full width on tablets. Clicking a citation selects its answer, scrolls the panel to the card with overlapping lines, and shades the cited lines.

**State lives in the URL.** `?repo=<id>` while indexing and `?session=<id>` afterwards, so a reload restores the same view. Both are read with `useSearchParams` behind `<Suspense>`, which keeps `/` a static shell under Cache Components.
