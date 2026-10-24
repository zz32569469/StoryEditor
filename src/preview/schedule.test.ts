import { describe, expect, it } from 'vitest';

import { DEFAULT_TAG_REGISTRY } from '../schema/tags';
import { parseText } from '../tags/parse';
import { buildSchedule } from './schedule';

const UI25 = { charsPerSecond: 1 / 0.035, sentencePause: 0.15 };
const times = (input: string, options = UI25) =>
  buildSchedule(parseText(input, DEFAULT_TAG_REGISTRY).chars, options).times;

describe('句末停頓', () => {
  it('句末標點之後那一格停 150ms，取代一般的 35ms', () => {
    const t = times('你好。今');
    expect(t[0]).toBeCloseTo(0.035);
    expect(t[1]).toBeCloseTo(0.07);
    expect(t[2]).toBeCloseTo(0.105);
    expect(t[3]).toBeCloseTo(0.255);
  });

  it('句子最後一個字是句號時不會多等', () => {
    const t = times('好。');
    expect(t).toHaveLength(2);
    expect(t[1]).toBeCloseTo(0.07);
  });

  it('連續的刪節號每個之後都停', () => {
    const t = times('……嗯');
    expect(t[1]! - t[0]!).toBeCloseTo(0.15);
    expect(t[2]! - t[1]!).toBeCloseTo(0.15);
  });

  it('不給選項時維持原本的節奏', () => {
    const plain = buildSchedule(parseText('你好。今', DEFAULT_TAG_REGISTRY).chars).times;
    expect(plain[3]! - plain[2]!).toBeCloseTo(1 / 28);
  });
});
