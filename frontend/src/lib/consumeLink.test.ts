import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildConsumeLink,
  parseConsumeHash,
  stashPendingConsume,
  restorePendingConsume,
  clearPendingConsume,
} from './consumeLink';

describe('consumeLink', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('build → parse round-trips g and t', () => {
    const link = buildConsumeLink('https://app.test', '0xgrant', 'tok_abc');
    expect(link).toBe('https://app.test/doctor#g=0xgrant&t=tok_abc');
    const url = new URL(link);
    expect(parseConsumeHash(url.hash)).toEqual({ g: '0xgrant', t: 'tok_abc' });
  });

  it('parseConsumeHash tolerates leading # and no #', () => {
    expect(parseConsumeHash('#g=0x1&t=aa')).toEqual({ g: '0x1', t: 'aa' });
    expect(parseConsumeHash('g=0x1&t=aa')).toEqual({ g: '0x1', t: 'aa' });
  });

  it('parseConsumeHash returns null when g or t missing or empty', () => {
    expect(parseConsumeHash('#g=0x1')).toBeNull();
    expect(parseConsumeHash('#t=aa')).toBeNull();
    expect(parseConsumeHash('')).toBeNull();
    expect(parseConsumeHash('#g=&t=aa')).toBeNull();
    expect(parseConsumeHash('#id_token=xyz')).toBeNull();
  });

  it('parseConsumeHash url-decodes values', () => {
    expect(parseConsumeHash('#g=0x1&t=a%2Bb')).toEqual({ g: '0x1', t: 'a+b' });
  });

  it('stash → restore → clear lifecycle', () => {
    expect(restorePendingConsume()).toBeNull();
    stashPendingConsume({ g: '0xg', t: 'tt' });
    expect(restorePendingConsume()).toEqual({ g: '0xg', t: 'tt' });
    clearPendingConsume();
    expect(restorePendingConsume()).toBeNull();
  });

  it('restorePendingConsume returns null on corrupt json', () => {
    sessionStorage.setItem('anampouch_pending_consume', '{not json');
    expect(restorePendingConsume()).toBeNull();
  });
});
