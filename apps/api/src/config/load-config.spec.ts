import { ConfigValidationError, parseConfig } from './load-config';

const validEnv = {
  NODE_ENV: 'development',
  API_PORT: '3001',
  DATABASE_URL: 'postgresql://cda:cda@localhost:5432/cda',
  REDIS_URL: 'redis://localhost:6379',
  OLLAMA_URL: 'http://localhost:11434',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  WEB_ORIGIN: 'http://localhost:3000',
  ANTHROPIC_MODEL: 'claude-opus-5-5',
  CHAT_MAX_ITERATIONS: '6',
  CHAT_TOKEN_BUDGET: '200000',
};

describe('parseConfig', () => {
  it('returns a typed config for a valid environment', () => {
    expect(parseConfig(validEnv)).toEqual({
      ...validEnv,
      API_PORT: 3001,
      CHAT_MAX_ITERATIONS: 6,
      CHAT_TOKEN_BUDGET: 200000,
    });
  });

  it('names every missing variable', () => {
    const rest = { ...validEnv, DATABASE_URL: undefined, REDIS_URL: '' };

    expect(() => parseConfig(rest)).toThrow(ConfigValidationError);
    try {
      parseConfig(rest);
    } catch (error) {
      expect((error as ConfigValidationError).problems).toEqual([
        'DATABASE_URL is missing',
        'REDIS_URL is missing',
      ]);
    }
  });

  it('rejects a URL with the wrong protocol', () => {
    expect(() =>
      parseConfig({ ...validEnv, DATABASE_URL: 'mysql://localhost/cda' }),
    ).toThrow(/DATABASE_URL is invalid/);
  });
});
