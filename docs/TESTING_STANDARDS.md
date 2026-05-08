# Testing Standards — DeckCreate

Single reference for what to test, where to put it, and how to write it. Both human and agentic developers must follow this before writing a test or marking a refactor phase complete.

---

## Three test types, three rules

| Type | Purpose | Scope | Runner |
|------|---------|-------|--------|
| **Unit** | One function or module in isolation | No real I/O, no network | Jest (`node` or `react` project) |
| **Integration** | Multiple modules end-to-end | Real filesystem via temp dirs; mock external services | Jest (`node` project) |
| **E2E** | User flows in the browser | Live Next.js dev server; real DOM | Playwright |

**Rule 1:** If a function is pure (no I/O, no side effects), write a unit test. No exceptions.  
**Rule 2:** If a unit test would require mocking more than two dependencies, write an integration test instead.  
**Rule 3:** E2E tests cover user journeys (login → edit → save), not implementation details.

---

## File locations

```
scripts/
  someModule.test.ts          ← unit test for scripts/ TS modules (node project)
  __tests__/
    SomeClass.test.js         ← existing JS unit tests (node project)

tests/
  integration/
    pipeline-dag.test.ts      ← multi-stage pipeline integration tests
    merge-doc.test.ts         ← tests that read/write real temp files
  react/
    SomeHook.test.tsx         ← isolated hook tests outside app/ or remotion/
  setup.js                    ← Jest global setup: node project
  setup.react.ts              ← Jest global setup: react project
  __mocks__/
    styleMock.js              ← CSS module stub
    fileMock.js               ← static asset stub

app/
  components/
    MyComponent.test.tsx      ← component unit tests (react project)
  editor/
    Timeline.test.tsx

remotion/
  lib/
    hookTiming.test.ts        ← pure logic unit tests (node project)
    captions.test.ts

e2e/
  smoke.test.ts               ← routes respond, no server errors
  flows/
    editor-flow.test.ts       ← full user editing journey
    carousel-flow.test.ts
```

**Naming:** test file lives next to the file it tests, same name + `.test.{ts,tsx}`. Exception: integration tests always go in `tests/integration/`.

---

## Running tests

```bash
npm test                   # all Jest tests (node + react projects)
npm run test:unit          # alias for above
npm run test:react         # react project only (app/ + remotion/)
npm run test:integration   # integration tests only
npm run test:coverage      # all Jest tests + coverage report
npm run test:watch         # re-run on file change (dev loop)

npm run test:e2e           # Playwright (requires running dev server or auto-starts it)
npm run test:e2e:ui        # Playwright interactive UI
npm run test:e2e:debug     # Playwright step-through debugger

npm run test:all           # Jest + Playwright (CI equivalent)
```

**First-time Playwright setup** (browsers not bundled, run once per machine):
```bash
npx playwright install chromium
```

---

## Unit tests — scripts and pipeline logic

Target: `scripts/**/*.{js,ts}`, `remotion/lib/**/*.ts`

### Pattern: dependency injection

Scripts receive `fs`, `spawn`, etc. as constructor arguments so tests can inject fakes.

```typescript
// scripts/pipeline/nodes/transcribe.ts
export class Transcriber {
  constructor(
    private readonly fs: typeof import('fs-extra') = fse,
    private readonly spawn: typeof import('child_process').spawn = cp.spawn,
  ) {}

  async run(inputPath: string): Promise<TranscriptRaw> { ... }
}
```

```typescript
// scripts/pipeline/nodes/transcribe.test.ts
import { Transcriber } from './transcribe';
import { createFakeFs } from '../../tests/helpers/fakeFs';

describe('Transcriber', () => {
  it('writes transcript.raw.json to the artifact store', async () => {
    const fakeFs = createFakeFs({ '/input/audio.wav': Buffer.from('') });
    const t = new Transcriber(fakeFs, jest.fn());
    const result = await t.run('/input/audio.wav');
    expect(fakeFs.written['.ragtech/artifacts/']).toBeDefined();
    expect(result.segments).toBeInstanceOf(Array);
  });
});
```

### Pattern: pure function tests

```typescript
// remotion/lib/hookTiming.test.ts
import { hookClipEnd, buildHookSections } from './hookTiming';

describe('hookClipEnd', () => {
  it('returns hookTo when bounded', () => {
    expect(hookClipEnd({ hookFrom: 10, hookTo: 20 }, 60)).toBe(20);
  });

  it('pads by HOOK_TAIL_PAD_UNBOUNDED_SECONDS when hookTo is absent', () => {
    const end = hookClipEnd({ hookFrom: 10 }, 60);
    expect(end).toBeCloseTo(10 + 0.16, 5);
  });
});
```

### Coverage thresholds (per refactor phase)

| Phase | Target files | Minimum coverage |
|-------|-------------|-----------------|
| Phase 4 | `scripts/**/*.ts` | 60% |
| Phase 5 | `remotion/lib/**/*.ts` | 60% |
| Phase 7 | `app/api/**/*.ts` | 70% |
| Phase 8 | `app/components/**/*.tsx` | 50% |

Run `npm run test:coverage` and check the text summary. The `coverage/lcov-report/index.html` gives per-file line-by-line detail.

---

## Unit tests — React components

Target: `app/**/*.tsx`, and any React components in `remotion/` that have extractable logic.

### Pattern: render and assert

```tsx
// app/components/EpisodePill.test.tsx
import { render, screen } from '@testing-library/react';
import { EpisodePill } from './EpisodePill';

describe('EpisodePill', () => {
  it('displays the episode number', () => {
    render(<EpisodePill episode={42} />);
    expect(screen.getByText('EP 42')).toBeInTheDocument();
  });
});
```

### Pattern: user interaction

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FillerWordPanel } from './FillerWordPanel';

describe('FillerWordPanel', () => {
  it('calls onRestore when restore button is clicked', async () => {
    const onRestore = jest.fn();
    render(<FillerWordPanel words={[{ id: '1', text: 'um' }]} onRestore={onRestore} />);
    await userEvent.click(screen.getByRole('button', { name: /restore/i }));
    expect(onRestore).toHaveBeenCalledWith('1');
  });
});
```

### What NOT to test in React unit tests

- Remotion composition output (too complex; requires full Remotion runtime)
- CSS pixel values (test behaviour, not style)
- Implementation details (internal state, private methods)

### Mocking Remotion hooks

When a component uses `useCurrentFrame` or `useVideoConfig`, mock the module:

```tsx
jest.mock('remotion', () => ({
  useCurrentFrame: () => 0,
  useVideoConfig: () => ({ fps: 60, durationInFrames: 3600, width: 1920, height: 1080 }),
  Sequence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
```

---

## Integration tests

Target: `tests/integration/**/*.test.{js,ts}`

Integration tests are allowed to:
- Read and write real files in `os.tmpdir()` temp directories
- Spawn real child processes if the binary is available (FFmpeg, Python)
- Test multiple modules interacting

Integration tests must NOT:
- Hit the internet
- Depend on `public/` content that may not be present in CI
- Leave files behind (always clean up in `afterAll`)

### Pattern: temp directory + real pipeline stage

```typescript
// tests/integration/merge-doc.test.ts
import os from 'os';
import path from 'path';
import fse from 'fs-extra';
import { mergeDoc } from '../../scripts/edit-transcript';

describe('mergeDoc (integration)', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'deckcreate-test-'));
  });

  afterAll(async () => {
    await fse.remove(tmpDir);
  });

  it('applies cut markers from doc to transcript', async () => {
    const transcriptPath = path.join(tmpDir, 'transcript.json');
    await fse.writeJson(transcriptPath, sampleTranscript);
    const result = await mergeDoc(transcriptPath, sampleDoc);
    expect(result.segments.filter((s) => s.cut)).toHaveLength(2);
  });
});
```

---

## E2E tests

Target: `e2e/**/*.test.ts`

### Structure

```
e2e/
  smoke.test.ts          ← route availability (< 10 s total)
  flows/
    auth-flow.test.ts    ← login / logout
    editor-flow.test.ts  ← open editor, make a cut, save
    carousel-flow.test.ts
```

### Pattern: page object model

For flows with more than 5 interactions, extract a page object:

```typescript
// e2e/pages/EditorPage.ts
import { Page } from '@playwright/test';

export class EditorPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/editor');
  }

  async markCut(wordText: string) {
    await this.page.getByText(wordText).click({ button: 'right' });
    await this.page.getByRole('menuitem', { name: 'Cut word' }).click();
  }

  async save() {
    await this.page.getByRole('button', { name: 'Save' }).click();
    await this.page.waitForResponse('/api/transcript');
  }
}
```

```typescript
// e2e/flows/editor-flow.test.ts
import { test, expect } from '@playwright/test';
import { EditorPage } from '../pages/EditorPage';

test('user can mark a word as cut', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.markCut('um');
  await editor.save();
  await expect(page.getByText('Saved')).toBeVisible();
});
```

### E2E conventions

- Each test is independent — no shared state between tests
- Use `page.goto()` at the start of every test (not `beforeEach`)
- Prefer role-based locators (`getByRole`, `getByLabel`) over CSS selectors
- Assert on visible user-facing text, not internal DOM structure
- Keep smoke tests under 10 seconds total; flow tests under 60 seconds each

---

## Mocking philosophy

| What | How |
|------|-----|
| File system (unit) | Inject fake `fs` via constructor |
| File system (integration) | Real `os.tmpdir()` + cleanup |
| External HTTP (YouTube, Claude API) | `jest.fn()` on fetch or module mock |
| FFmpeg / Python processes | `jest.fn()` on `spawn` (unit); real binary (integration, skip if missing) |
| Sharp, Puppeteer | Global mock in `tests/setup.js` |
| Next.js router / image | Global mock in `tests/setup.react.ts` |
| Remotion hooks | Per-test `jest.mock('remotion', ...)` |
| Browser / DOM | jsdom via `react` Jest project; Playwright for real browser |

**Never** mock the module being tested. Only mock its dependencies.

---

## Pre-commit behaviour

The pre-commit hook runs `jest --findRelatedTests` on staged `.js/.ts/.tsx` files. This means:

- Editing `scripts/edit-transcript.ts` → automatically runs `edit-transcript.test.ts`
- Editing `app/components/Timeline.tsx` → automatically runs `Timeline.test.tsx` (once it exists)
- Tests for unstaged files are NOT run (use `npm test` for full suite)

The hook uses `--passWithNoTests` — committing a file with no test does not fail. This is intentional: test coverage gaps are caught by the coverage threshold in CI, not the commit hook.

---

## Agent implementation checklist

When implementing a refactor phase step that involves new logic:

1. Write the test file **before** or **alongside** the implementation (not after)
2. Test file location follows the conventions above
3. Every new pure function gets at least one happy-path and one edge-case test
4. Every new React component gets a smoke render test (`render(...)` does not throw)
5. Run `npm test` before committing — all projects must pass
6. Check coverage with `npm run test:coverage` if the phase has a coverage target
7. E2E tests are only required for Phase 8 user-facing features

When in doubt: a failing test is better than no test.
