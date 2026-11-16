import { toOrTsQuery } from './fts-query';

describe('toOrTsQuery', () => {
  it('keeps identifiers whole and lower-cased, dropping question words', () => {
    expect(
      toOrTsQuery('How does retryOnTimeout work with afterStatusCodes?'),
    ).toBe('retryontimeout | afterstatuscodes');
  });

  it('splits on punctuation like the Postgres parser and deduplicates', () => {
    expect(
      toOrTsQuery('What is ky.extend() vs ky.create(), and retry_delay?'),
    ).toBe('extend | create | retry | delay');
  });

  it('cannot inject tsquery operators', () => {
    expect(toOrTsQuery("hooks & !(timeout | 'x':*) <-> prefixUrl")).toBe(
      'hooks | timeout | prefixurl',
    );
  });

  it('returns null when only stop words or short words remain', () => {
    expect(toOrTsQuery('How does it work?')).toBeNull();
    expect(toOrTsQuery('a b c')).toBeNull();
    expect(toOrTsQuery('')).toBeNull();
  });

  it('caps the number of terms', () => {
    const many = Array.from({ length: 30 }, (_, i) => `term${String(i)}`).join(
      ' ',
    );
    expect(toOrTsQuery(many)?.split(' | ')).toHaveLength(12);
  });
});
