import { parseLineDoc, mergeLineText } from './merge-line-captions.js';

describe('parseLineDoc', () => {
  test('parses [id] text lines and tracks the current speaker header', () => {
    const doc = [
      '=== Natasha ===',
      '',
      '[1]  this is the',
      '[2]  first line here',
      '',
      '=== Saloni ===',
      '',
      '[3]  and this one',
      '',
    ].join('\n');

    expect(parseLineDoc(doc)).toEqual([
      { id: 1, speaker: 'Natasha', text: 'this is the' },
      { id: 2, speaker: 'Natasha', text: 'first line here' },
      { id: 3, speaker: 'Saloni', text: 'and this one' },
    ]);
  });

  test('captures reworded text verbatim', () => {
    const doc = '=== Natasha ===\n\n[1]  a totally different phrase\n';
    expect(parseLineDoc(doc)).toEqual([{ id: 1, speaker: 'Natasha', text: 'a totally different phrase' }]);
  });
});

describe('mergeLineText', () => {
  function linesDoc() {
    return {
      meta: { title: 't', duration: 1, fps: 60 },
      lines: [
        { id: 1, speaker: 'Natasha', text: 'original text', startMs: 0, endMs: 600 },
        { id: 2, speaker: 'Natasha', text: 'second line', startMs: 600, endMs: 1200 },
      ],
    };
  }

  test('overwrites text for matching ids and preserves timing', () => {
    const result = mergeLineText(linesDoc(), [
      { id: 1, speaker: 'Natasha', text: 'rewritten text' },
      { id: 2, speaker: 'Natasha', text: 'second line' },
    ]);

    expect(result.lines[0]).toMatchObject({ text: 'rewritten text', startMs: 0, endMs: 600 });
    expect(result.lines[1]).toMatchObject({ text: 'second line', startMs: 600, endMs: 1200 });
  });

  test('warns and skips a doc id with no matching lines.json entry', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = mergeLineText(linesDoc(), [{ id: 99, speaker: 'Natasha', text: 'ghost line' }]);

    expect(result.lines).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[99]'));
    warnSpy.mockRestore();
  });

  test('warns about a lines.json id missing from the doc', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mergeLineText(linesDoc(), [{ id: 1, speaker: 'Natasha', text: 'only this one edited' }]);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[2]'));
    warnSpy.mockRestore();
  });
});
