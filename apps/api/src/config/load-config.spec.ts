import { ConfigValidationError, parseConfig } from './load-config';

const validEnv = {
  NODE_ENV: 'development',
  API_PORT: '3001',
  DATABASE_URL: 'postgresql://cda:cda@localhost:5432/cda',
  REDIS_URL: 'redis://localhost:6379',
  OLLAMA_URL: 'http://localhost:11434',
};

describe('parseConfig', () => {
  it('returns a typed config for a valid environment', () => {
    expect(parseConfig(validEnv)).toEqual({ ...validEnv, API_PORT: 3001 });
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
