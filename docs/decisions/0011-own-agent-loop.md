# 0011 — Our own agent loop over LangGraph or an agent SDK

`AnswerQuestion` (packages/domain) runs the tool-use loop itself: build messages, call the `LanguageModel` port, run the requested tools through `ToolRegistry`, append the results, and repeat until the model answers or `LoopPolicy` stops it. `AnthropicLanguageModel` is a thin Messages API adapter.

We chose this over LangGraph or LangChain agents, over the Anthropic SDK's Tool Runner, and over the Claude Agent SDK. The loop is about forty lines, and every rule we care about is ours to test with a scripted fake model and no network:
- a hard cap on model calls, where the last call is made with `tool_choice: "none"` so a capped question still gets an answer;
- a token budget per question;
- tool errors returned to the model instead of thrown;
- one `llm_calls` row per call, failed calls included;
- the conversation persisted as question, answer, tool trace and citations.

A framework would put graph state, callbacks and its own message types between those rules and the domain, and would pull an SDK into code that must stay infrastructure-free.

The Tool Runner is a good loop, but it is a beta helper bound to Anthropic types, so the loop would move into infrastructure and the domain could no longer state its rules. The Claude Agent SDK is Claude Code as a library, with built-in file, shell and web tools we neither need nor want exposed to repository questions.

The price of owning the loop is owning its provider details, and we have handled each:
- Claude Opus 5.5 binds thinking blocks to the conversation, so assistant turns inside a loop are replayed verbatim (`providerContent`). Prior questions are replayed as plain question and answer text with no thinking, which the API allows.
- The system prompt and tools stay fixed for the whole loop, which also keeps the prompt cache warm.
- Refusals use server-side fallbacks (`fallbacks: "default"`), priced per model from `usage.iterations`.

Supporting another provider means writing another `LanguageModel` adapter, not changing the loop. We would reconsider if we needed long-running branching workflows with resumable state.
