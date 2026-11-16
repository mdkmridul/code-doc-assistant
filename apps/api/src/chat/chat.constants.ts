/**
 * The system prompt version in use. Bumping it means adding
 * `prompts/answer-question/<version>.md`; old versions stay so `llm_calls`
 * rows remain traceable to the exact text that produced them.
 */
export const ANSWER_QUESTION_PROMPT = {
  name: 'answer-question',
  version: 'v3',
};

/** Upper bound on a question's length (characters). */
export const MAX_QUESTION_CHARS = 4_000;
