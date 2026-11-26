import { describe, expect, it } from 'vitest';
import { band, gaps, QUESTIONS, resultText, score, type Answer } from './selfCheckData';

/** First `yes` questions answered Yes, the rest alternating No / Not sure. */
function answersWith(yes: number): Record<number, Answer> {
  return Object.fromEntries(
    QUESTIONS.map((q, i) => [q.n, i < yes ? 'yes' : i % 2 ? 'unsure' : 'no']),
  );
}

describe('self-check scoring', () => {
  it('has ten questions numbered 1 to 10', () => {
    expect(QUESTIONS.map((q) => q.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it.each([
    [0, 'low'],
    [4, 'low'],
    [5, 'mid'],
    [7, 'mid'],
    [8, 'high'],
    [10, 'high'],
  ] as const)('%i points is the %s band', (points, expected) => {
    const answers = answersWith(points);
    expect(score(answers)).toBe(points);
    expect(band(score(answers))).toBe(expected);
    expect(gaps(answers)).toHaveLength(10 - points);
  });

  it('counts only Yes as a point', () => {
    expect(score({ 1: 'no', 2: 'unsure', 3: 'yes' })).toBe(1);
  });

  it('lists gaps in question order with the answer that caused them', () => {
    const g = gaps({ 9: 'unsure', 4: 'no', 1: 'yes' });
    expect(g.map(({ question, answer }) => [question.n, answer])).toEqual([
      [4, 'no'],
      [9, 'unsure'],
    ]);
  });

  it('points multi-question gaps at the first checklist question', () => {
    const q4 = QUESTIONS.find((q) => q.n === 4)!;
    const q6 = QUESTIONS.find((q) => q.n === 6)!;
    expect(q4.checklistQ).toBe(5);
    expect(q6.checklistQ).toBe(9);
  });

  it('copies score, headline and gap lines as plain text', () => {
    const text = resultText({ ...answersWith(10), 3: 'unsure', 6: 'no' }, 'https://example.com/x/');
    expect(text).toContain('8 of 10 under our control');
    expect(text).toContain('You know where your login data goes');
    expect(text).toContain('- Find out: Whether the region is fixed');
    expect(text).toContain('- Gap: Which company you depend on');
    expect(text).toContain('https://example.com/x/');
  });

  it('copies the no-gaps line when everything is Yes', () => {
    expect(resultText(answersWith(10), '/')).toContain('No gaps on these ten.');
  });
});
