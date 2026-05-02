'use strict';

const vscode = require('vscode');

const DIRECTIVES = new Set([
  'HOOK', 'CAM', 'SPEAKER', 'START', 'END',
  'LowerThird', 'NameTitle', 'Callout',
  'ChapterMarker', 'ChapterMarkerEnd',
  'ConceptExplainer', 'ImageWindow', 'GifWindow',
  'AIOverlay', 'CodingOverlay', 'EngineeringOverlay',
  'LanguageOverlay', 'FrameworkOverlay', 'InfrastructureOverlay',
  'PracticeOverlay', 'RoleOverlay', 'EducationOverlay',
  'AwardsOverlay', 'RagtechOverlay',
]);

const REQUIRES_SRC = new Set(['ImageWindow', 'GifWindow']);

const ATTRS = [
  'at', 'duration', 'name', 'title', 'text', 'chapterTitle',
  'src', 'caption', 'width', 'gifHeight', 'playbackRate',
  'loopBehavior', 'char', 'keyPhrase', 'description', 'side',
  'concept', 'hookFrom', 'hookTo',
];

function parseSpeakers(text) {
  const speakers = new Set();
  const m = text.match(/^# SPEAKERS\n([\s\S]*?)(?=^---|^#|\n===)/m);
  if (m) {
    for (const line of m[1].split('\n')) {
      const lm = line.match(/^(\w[\w\s]*?)\s*:/);
      if (lm) speakers.add(lm[1].trim());
    }
  }
  return speakers;
}

function lint(document) {
  const diagnostics = [];
  const text = document.getText();
  const speakers = parseSpeakers(text);
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check annotation lines
    const annotMatch = line.match(/^(\s*)>\s*(\w+)/);
    if (!annotMatch) continue;

    const directive = annotMatch[2];
    const directiveCol = line.indexOf(directive, annotMatch[1].length + 1);
    const directiveRange = new vscode.Range(i, directiveCol, i, directiveCol + directive.length);

    // Unknown directive
    if (!DIRECTIVES.has(directive)) {
      diagnostics.push(new vscode.Diagnostic(
        directiveRange,
        `Unknown directive "${directive}". Did you mean one of: ${[...DIRECTIVES].join(', ')}?`,
        vscode.DiagnosticSeverity.Warning
      ));
      continue;
    }

    // Missing required src= attribute
    if (REQUIRES_SRC.has(directive) && !/\bsrc\s*=/.test(line)) {
      diagnostics.push(new vscode.Diagnostic(
        new vscode.Range(i, 0, i, line.length),
        `${directive} requires a src= attribute`,
        vscode.DiagnosticSeverity.Error
      ));
    }

    // Validate speaker name after > CAM and > SPEAKER
    if ((directive === 'CAM' || directive === 'SPEAKER') && speakers.size > 0) {
      const afterDirective = line.slice(directiveCol + directive.length).trimStart();
      // grab the word(s) before any attribute
      const speakerMatch = afterDirective.match(/^([\w][\w\s]*?)(?:\s+at=|\s*$)/);
      if (speakerMatch) {
        const speakerName = speakerMatch[1].trim();
        if (speakerName && speakerName !== 'wide' && !speakers.has(speakerName)) {
          const speakerCol = line.indexOf(speakerName, directiveCol + directive.length);
          if (speakerCol !== -1) {
            diagnostics.push(new vscode.Diagnostic(
              new vscode.Range(i, speakerCol, i, speakerCol + speakerName.length),
              `Speaker "${speakerName}" is not in the SPEAKERS section`,
              vscode.DiagnosticSeverity.Warning
            ));
          }
        }
      }
    }
  }

  return diagnostics;
}

function activate(context) {
  const collection = vscode.languages.createDiagnosticCollection('transcript-doc');
  context.subscriptions.push(collection);

  function update(document) {
    if (document.languageId !== 'transcript-doc') return;
    collection.set(document.uri, lint(document));
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(update),
    vscode.workspace.onDidChangeTextDocument(e => update(e.document)),
    vscode.workspace.onDidCloseTextDocument(doc => collection.delete(doc.uri))
  );

  vscode.workspace.textDocuments.forEach(update);

  // Completions: directive names and speaker names
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'transcript-doc' },
      {
        provideCompletionItems(document, position) {
          const linePrefix = document.lineAt(position).text.slice(0, position.character);
          const items = [];

          // After ">  " suggest directive names
          if (/^\s*>\s*\w*$/.test(linePrefix)) {
            for (const d of DIRECTIVES) {
              const item = new vscode.CompletionItem(d, vscode.CompletionItemKind.Keyword);
              item.sortText = `0_${d}`;
              items.push(item);
            }
            return items;
          }

          // After "> CAM " or "> SPEAKER " suggest speaker names
          if (/^\s*>\s*(CAM|SPEAKER)\s+\w*$/.test(linePrefix)) {
            const speakers = parseSpeakers(document.getText());
            for (const s of speakers) {
              items.push(new vscode.CompletionItem(s, vscode.CompletionItemKind.Value));
            }
            if (/CAM/.test(linePrefix)) {
              items.push(new vscode.CompletionItem('wide', vscode.CompletionItemKind.Value));
            }
            return items;
          }

          // Suggest attribute names after a directive
          if (/^\s*>\s*\w+\s+/.test(linePrefix) && !/=/.test(linePrefix.split(/\s+/).pop())) {
            for (const attr of ATTRS) {
              const item = new vscode.CompletionItem(`${attr}=`, vscode.CompletionItemKind.Property);
              item.insertText = new vscode.SnippetString(`${attr}="$1"`);
              items.push(item);
            }
            return items;
          }

          return [];
        }
      },
      ' ', '"'
    )
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
