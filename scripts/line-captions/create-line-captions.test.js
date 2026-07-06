import { buildLineDoc } from './create-line-captions.js';

describe('buildLineDoc', () => {
  test('groups consecutive lines under a speaker header', () => {
    const doc = buildLineDoc({
      meta: { title: 't', duration: 1, fps: 60 },
      lines: [
        { id: 1, speaker: 'Natasha', text: 'this is the', startMs: 0, endMs: 600 },
        { id: 2, speaker: 'Natasha', text: 'first line here', startMs: 600, endMs: 1200 },
      ],
    });

    expect(doc).toBe(
      '=== Natasha ===\n\n[1]  this is the\n[2]  first line here\n',
    );
  });

  test('starts a new speaker block on a speaker change', () => {
    const doc = buildLineDoc({
      meta: { title: 't', duration: 1, fps: 60 },
      lines: [
        { id: 1, speaker: 'Natasha', text: 'hey there', startMs: 0, endMs: 500 },
        { id: 2, speaker: 'Saloni', text: 'hi back', startMs: 500, endMs: 1000 },
      ],
    });

    expect(doc).toBe(
      '=== Natasha ===\n\n[1]  hey there\n\n=== Saloni ===\n\n[2]  hi back\n',
    );
  });
});
