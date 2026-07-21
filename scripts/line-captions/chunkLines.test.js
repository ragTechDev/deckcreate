import { chunkIntoLines } from './chunkLines.js';

function tok(text, t_dtw, t_end, cut = false) {
  return { text, t_dtw, t_end, cut };
}

function seg(overrides) {
  return { id: 1, start: 0, end: 1, speaker: 'A', cut: false, tokens: [], ...overrides };
}

describe('chunkIntoLines', () => {
  test('chunks an exact multiple of 3 words into one line per 3 words', () => {
    const segment = seg({
      end: 1,
      tokens: [
        tok(' One', 0.0, 0.2),
        tok(' two', 0.2, 0.4),
        tok(' three', 0.4, 0.6),
        tok(' four', 0.6, 0.8),
        tok(' five', 0.8, 1.0),
        tok(' six', 1.0, 1.2),
      ],
    });

    const lines = chunkIntoLines([segment]);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ id: 1, speaker: 'A', text: 'One two three', startMs: 0, endMs: 600 });
    expect(lines[1]).toMatchObject({ id: 2, speaker: 'A', text: 'four five six', startMs: 600 });
  });

  test('a non-multiple of 3 leaves a trailing partial line', () => {
    const segment = seg({
      end: 1,
      tokens: [
        tok(' One', 0.0, 0.2),
        tok(' two', 0.2, 0.4),
        tok(' three', 0.4, 0.6),
        tok(' four', 0.6, 0.8),
      ],
    });

    const lines = chunkIntoLines([segment]);

    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('One two three');
    expect(lines[1].text).toBe('four');
    expect(lines[1].endMs).toBe(0.8 * 1000);
  });

  test('reconstructs a word split across two BPE tokens as a single word', () => {
    const segment = seg({
      end: 1,
      tokens: [
        tok(' This', 0.0, 0.2),
        tok(' is', 0.2, 0.4),
        tok(' j', 0.4, 0.5),
        tok('inx', 0.5, 0.6),
      ],
    });

    const lines = chunkIntoLines([segment]);

    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('This is jinx');
  });

  test('attaches punctuation-only tokens to the preceding word instead of starting a new group', () => {
    const segment = seg({
      end: 1,
      tokens: [
        tok(' Hello', 0.0, 0.2),
        tok('.', 0.2, 0.2),
        tok(' World', 0.3, 0.5),
      ],
    });

    const lines = chunkIntoLines([segment]);

    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('Hello. World');
  });

  test('never lets a line span two speakers', () => {
    const segmentA = seg({
      id: 1,
      speaker: 'Natasha',
      end: 0.5,
      tokens: [tok(' Hey', 0.0, 0.2), tok(' there', 0.2, 0.5)],
    });
    const segmentB = seg({
      id: 2,
      speaker: 'Saloni',
      start: 0.5,
      end: 1.0,
      tokens: [tok(' Hi', 0.5, 0.7), tok(' back', 0.7, 1.0)],
    });

    const lines = chunkIntoLines([segmentA, segmentB]);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ speaker: 'Natasha', text: 'Hey there' });
    expect(lines[1]).toMatchObject({ speaker: 'Saloni', text: 'Hi back' });
  });

  test('excludes cut tokens and cut segments entirely', () => {
    const segmentA = seg({
      id: 1,
      end: 0.6,
      tokens: [
        tok(' kept', 0.0, 0.2),
        tok(' cut-word', 0.2, 0.4, true),
        tok(' also-kept', 0.4, 0.6),
      ],
    });
    const segmentB = seg({ id: 2, cut: true, start: 0.6, end: 1.0, tokens: [tok(' ignored', 0.6, 1.0)] });

    const lines = chunkIntoLines([segmentA, segmentB]);

    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('kept also-kept');
  });

  test('falls back to segment.end when the last token has no t_end', () => {
    const segment = seg({
      end: 0.9,
      tokens: [tok(' One', 0.0, undefined), tok(' two', 0.3, undefined)],
    });

    const lines = chunkIntoLines([segment]);

    expect(lines).toHaveLength(1);
    expect(lines[0].endMs).toBe(0.9 * 1000);
  });
});
