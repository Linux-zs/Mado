import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';

import './style.css';

type OpenedDocument = {
  fileName: string;
  filePath: string;
  directoryPath: string;
  content: string;
};

type InlineNode =
  | {
      kind: 'text';
      text: string;
    }
  | {
      kind: 'strong';
      children: InlineNode[];
    }
  | {
      kind: 'emphasis';
      children: InlineNode[];
    }
  | {
      kind: 'inlineCode';
      text: string;
    };

type TableAlignment = 'left' | 'center' | 'right' | 'none';
type CodeBlockStyle = 'fenced' | 'indented';

type RenderBlock =
  | {
      id: string;
      kind: 'heading';
      source: string;
      level: 1 | 2 | 3 | 4 | 5 | 6;
      text: string;
      inlineNodes: InlineNode[];
      outlineId: string;
      outlineText: string;
    }
  | {
      id: string;
      kind: 'paragraph';
      source: string;
      inlineNodes: InlineNode[];
    }
  | {
      id: string;
      kind: 'raw';
      source: string;
      text: string;
    }
  | {
      id: string;
      kind: 'table';
      source: string;
      headerSource: string[];
      header: InlineNode[][];
      alignments: TableAlignment[];
      rowsSource: string[][];
      rows: InlineNode[][][];
    }
  | {
      id: string;
      kind: 'codeBlock';
      source: string;
      language: string;
      code: string;
      style: CodeBlockStyle;
    };

type DocumentState = {
  id: string;
  fileName: string;
  filePath: string | null;
  directoryPath: string | null;
  content: string;
  parsedBlocks: RenderBlock[];
  outline: OutlineItem[];
  savedContent: string;
  isDirty: boolean;
  isUntitled: boolean;
  lastViewedAt: number;
  listOrder: number;
};

type RecentFileEntry = {
  filePath: string;
  fileName: string;
  directoryName: string;
  lastOpenedAt: number;
  preview: string;
};

type FileListItem = {
  key: string;
  source: 'document' | 'recent';
  documentId: string | null;
  filePath: string | null;
  fileName: string;
  directoryName: string;
  timeLabel: string;
  preview: string;
  isActive: boolean;
  isDirty: boolean;
  lastViewedAt: number;
};

type OutlineItem = {
  id: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
};

type ParsedDocument = {
  blocks: RenderBlock[];
  outline: OutlineItem[];
};

type RenameDialogOptions = {
  title: string;
  description: string;
  defaultValue: string;
  confirmText: string;
};

type CommitBlockSourceOptions = {
  editGeneratedCodeBlock?: boolean;
  caretOffset?: number;
  generatedCodeSource?: string;
};

type ActivateBlockEditorOptions = {
  caretOffset?: number;
};

type BlockViewportSnapshot = {
  blockId: string;
  scrollTop: number;
  topOffset: number;
};

type CaretDocument = Document & {
  caretPositionFromPoint?: (
    x: number,
    y: number
  ) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

type OpeningFenceConversion = {
  nextSource: string;
  codeSource: string;
  caretOffset: number;
};

const OPEN_FILE_EVENT = 'request-open-markdown-file';
const NEW_FILE_EVENT = 'request-new-markdown-file';
const SAVE_FILE_EVENT = 'request-save-markdown-file';
const SAVE_AS_FILE_EVENT = 'request-save-as-markdown-file';
const RENAME_FILE_EVENT = 'request-rename-markdown-file';
const HEADING_PATTERN = /^(#{1,6})(?:[ \t]+)?(.+)$/;
const MARKDOWN_FILTERS = [
  {
    name: 'Markdown',
    extensions: ['md', 'markdown']
  }
];
const RECENT_FILES_STORAGE_KEY = 'tias.recent-files.v1';
const UNTITLED_FILE_NAME = '\u672a\u547d\u540d.md';
const FILES_MODE = 'files';
const OUTLINE_MODE = 'outline';
const NEW_BLOCK_EDITOR_ID = '__new-block__';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app root');
}

let documents: DocumentState[] = [];
let activeDocumentId: string | null = null;
let documentSequence = 0;
let documentListOrderSeed = 0;
let recentFiles = loadRecentFiles();
let sidebarMode: 'files' | 'outline' = FILES_MODE;
let headerNotice: { text: string; isError: boolean } | null = null;
let headerNoticeTimer: number | null = null;
let renameDialogResolver: ((value: string | null) => void) | null = null;
let activeEditingBlockId: string | null = null;
let activeBlockCommit: (() => void) | null = null;
let activeBlockCancel: (() => void) | null = null;
let pendingEditorSelection: { blockId: string; offset: number } | null = null;

const shell = document.createElement('main');
shell.className = 'shell';

const frame = document.createElement('section');
frame.className = 'workspace';
frame.setAttribute('aria-label', 'Markdown workspace');

const sidebar = document.createElement('aside');
sidebar.className = 'sidebar';
sidebar.setAttribute('aria-label', 'Document sidebar');

const sidebarTabs = document.createElement('header');
sidebarTabs.className = 'sidebar-tabs';

const filesTab = document.createElement('button');
filesTab.type = 'button';
filesTab.className = 'sidebar-tab';
filesTab.textContent = '\u6587\u4ef6';
filesTab.addEventListener('click', () => {
  sidebarMode = FILES_MODE;
  renderSidebar();
});

const outlineTab = document.createElement('button');
outlineTab.type = 'button';
outlineTab.className = 'sidebar-tab';
outlineTab.textContent = '\u5927\u7eb2';
outlineTab.addEventListener('click', () => {
  sidebarMode = OUTLINE_MODE;
  renderSidebar();
});

sidebarTabs.append(filesTab, outlineTab);

const sidebarBody = document.createElement('section');
sidebarBody.className = 'sidebar-body';

sidebar.append(sidebarTabs, sidebarBody);

const editorPanel = document.createElement('section');
editorPanel.className = 'editor-panel';

const header = document.createElement('header');
header.className = 'viewer-header';

const fileName = document.createElement('strong');
fileName.className = 'viewer-file-name';
fileName.textContent = '\u672a\u6253\u5f00\u6587\u4ef6';

const fileHint = document.createElement('span');
fileHint.className = 'viewer-hint';
fileHint.textContent =
  '\u4ece "\u6587\u4ef6 -> \u6253\u5f00" \u9009\u62e9\u4e00\u4e2a Markdown \u6587\u4ef6\u3002';

const content = document.createElement('div');
content.className = 'viewer-content viewer-content-empty';
content.tabIndex = 0;
content.spellcheck = false;

const renameOverlay = document.createElement('div');
renameOverlay.className = 'modal-overlay is-hidden';

const renameDialog = document.createElement('section');
renameDialog.className = 'modal-card';
renameDialog.setAttribute('role', 'dialog');
renameDialog.setAttribute('aria-modal', 'true');

const renameDialogTitle = document.createElement('h2');
renameDialogTitle.className = 'modal-title';

const renameDialogDescription = document.createElement('p');
renameDialogDescription.className = 'modal-description';

const renameDialogInput = document.createElement('input');
renameDialogInput.className = 'modal-input';
renameDialogInput.type = 'text';
renameDialogInput.spellcheck = false;

const renameDialogError = document.createElement('p');
renameDialogError.className = 'modal-error';

const renameDialogActions = document.createElement('div');
renameDialogActions.className = 'modal-actions';

const renameDialogCancel = document.createElement('button');
renameDialogCancel.type = 'button';
renameDialogCancel.className = 'modal-button is-secondary';
renameDialogCancel.textContent = '\u53d6\u6d88';

const renameDialogConfirm = document.createElement('button');
renameDialogConfirm.type = 'button';
renameDialogConfirm.className = 'modal-button is-primary';

renameDialogActions.append(renameDialogCancel, renameDialogConfirm);
renameDialog.append(
  renameDialogTitle,
  renameDialogDescription,
  renameDialogInput,
  renameDialogError,
  renameDialogActions
);
renameOverlay.append(renameDialog);

header.append(fileName, fileHint);
editorPanel.append(header, content);
frame.append(sidebar, editorPanel);
shell.append(frame, renameOverlay);
app.replaceChildren(shell);

renameDialogCancel.addEventListener('click', () => {
  closeRenameDialog(null);
});

renameDialogConfirm.addEventListener('click', () => {
  const normalized = normalizeMarkdownFileName(renameDialogInput.value);

  if (!normalized.ok) {
    renameDialogError.textContent = normalized.error;
    renameDialogInput.focus();
    renameDialogInput.select();
    return;
  }

  closeRenameDialog(normalized.value);
});

renameOverlay.addEventListener('click', (event) => {
  if (event.target === renameOverlay) {
    closeRenameDialog(null);
  }
});

renameDialogInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    renameDialogConfirm.click();
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    closeRenameDialog(null);
  }
});

function nextDocumentId(): string {
  documentSequence += 1;
  return `doc-${documentSequence}`;
}

function nextListOrder(): number {
  documentListOrderSeed += 1;
  return documentListOrderSeed;
}

function getActiveDocument(): DocumentState | undefined {
  return documents.find((document) => document.id === activeDocumentId);
}

function isDocumentUnsaved(document: DocumentState): boolean {
  return document.isUntitled || document.isDirty;
}

function loadRecentFiles(): RecentFileEntry[] {
  try {
    const stored = window.localStorage.getItem(RECENT_FILES_STORAGE_KEY);

    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isRecentFileEntry);
  } catch {
    return [];
  }
}

function persistRecentFiles(): void {
  try {
    window.localStorage.setItem(RECENT_FILES_STORAGE_KEY, JSON.stringify(recentFiles));
  } catch {
    // Keep the in-memory list even if persistence fails.
  }
}

function isRecentFileEntry(value: unknown): value is RecentFileEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const entry = value as Record<string, unknown>;

  return (
    typeof entry.filePath === 'string' &&
    typeof entry.fileName === 'string' &&
    typeof entry.directoryName === 'string' &&
    typeof entry.lastOpenedAt === 'number' &&
    typeof entry.preview === 'string'
  );
}

function getDirectoryLabel(directoryPath: string | null): string {
  if (!directoryPath) {
    return '\u672a\u4fdd\u5b58';
  }

  const normalizedPath = directoryPath.replace(/[\\/]+$/, '');
  const separatorIndex = Math.max(normalizedPath.lastIndexOf('\\'), normalizedPath.lastIndexOf('/'));

  if (separatorIndex >= 0) {
    const label = normalizedPath.slice(separatorIndex + 1);
    return label || normalizedPath;
  }

  return normalizedPath;
}

function getFileNameFromPath(filePath: string): string {
  const separatorIndex = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
  return separatorIndex >= 0 ? filePath.slice(separatorIndex + 1) : filePath;
}

function buildPreview(source: string): string {
  const previewLines = source
    .split(/\r?\n/)
    .map((line) => {
      const heading = parseHeadingLine(line);
      return (heading?.text ?? line).trim();
    })
    .filter((line) => line.length > 0);

  if (previewLines.length === 0) {
    return '\u7a7a\u767d Markdown \u6587\u6863';
  }

  return previewLines.slice(0, 2).join(' ');
}

function formatListDate(timestamp: number): string {
  const now = new Date();
  const target = new Date(timestamp);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTargetDay = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate()
  ).getTime();
  const dayDifference = Math.round((startOfToday - startOfTargetDay) / 86_400_000);

  if (dayDifference === 0) {
    return 'Today';
  }

  if (dayDifference === 1) {
    return 'Yesterday';
  }

  if (now.getFullYear() === target.getFullYear()) {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric'
    }).format(target);
  }

  return target.toISOString().slice(0, 10);
}

function upsertRecentEntry(entry: RecentFileEntry): void {
  recentFiles = [entry, ...recentFiles.filter((item) => item.filePath !== entry.filePath)].sort(
    (left, right) => right.lastOpenedAt - left.lastOpenedAt
  );
  persistRecentFiles();
}

function upsertRecentFile(document: DocumentState): void {
  if (!document.filePath) {
    return;
  }

  upsertRecentEntry({
    filePath: document.filePath,
    fileName: document.fileName,
    directoryName: getDirectoryLabel(document.directoryPath),
    lastOpenedAt: document.lastViewedAt,
    preview: buildPreview(document.savedContent)
  });
}

function upsertRecentFromDocumentPayload(
  payload: OpenedDocument,
  previewContent: string,
  timestamp: number
): void {
  upsertRecentEntry({
    filePath: payload.filePath,
    fileName: payload.fileName,
    directoryName: getDirectoryLabel(payload.directoryPath),
    lastOpenedAt: timestamp,
    preview: buildPreview(previewContent)
  });
}

function removeRecentFile(filePath: string): void {
  recentFiles = recentFiles.filter((entry) => entry.filePath !== filePath);
  persistRecentFiles();
}

function touchDocument(document: DocumentState): void {
  document.lastViewedAt = Date.now();
  upsertRecentFile(document);
}

function parseInlineNodes(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let remaining = source;

  while (remaining.length > 0) {
    const candidates = [
      findInlineCandidate(remaining, 'inlineCode', /`([^`\n]+)`/),
      findInlineCandidate(remaining, 'strong', /(\*\*|__)(.+?)\1/),
      findInlineCandidate(remaining, 'emphasis', /(\*|_)(.+?)\1/)
    ].filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

    if (candidates.length === 0) {
      appendTextNode(nodes, remaining);
      break;
    }

    candidates.sort((left, right) => {
      if (left.index === right.index) {
        return right.fullMatch.length - left.fullMatch.length;
      }

      return left.index - right.index;
    });

    const nextMatch = candidates[0];

    if (nextMatch.index > 0) {
      appendTextNode(nodes, remaining.slice(0, nextMatch.index));
    }

    if (nextMatch.kind === 'inlineCode') {
      nodes.push({
        kind: 'inlineCode',
        text: nextMatch.innerText
      });
    } else {
      nodes.push({
        kind: nextMatch.kind,
        children: parseInlineNodes(nextMatch.innerText)
      });
    }

    remaining = remaining.slice(nextMatch.index + nextMatch.fullMatch.length);
  }

  return nodes;
}

function findInlineCandidate(
  source: string,
  kind: 'strong' | 'emphasis' | 'inlineCode',
  pattern: RegExp
):
  | {
      kind: 'strong' | 'emphasis' | 'inlineCode';
      index: number;
      fullMatch: string;
      innerText: string;
    }
  | null {
  const match = source.match(pattern);

  if (!match || match.index === undefined) {
    return null;
  }

  return {
    kind,
    index: match.index,
    fullMatch: match[0],
    innerText: match[2] ?? match[1] ?? ''
  };
}

function appendTextNode(nodes: InlineNode[], text: string): void {
  if (text.length === 0) {
    return;
  }

  const previous = nodes.at(-1);

  if (previous?.kind === 'text') {
    previous.text += text;
    return;
  }

  nodes.push({
    kind: 'text',
    text
  });
}

function hasUnescapedTablePipe(line: string): boolean {
  let escaped = false;

  for (const character of line) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }

    if (character === '|') {
      return true;
    }
  }

  return false;
}

function isTableSeparatorLine(line: string): boolean {
  const cells = splitTableCells(line);

  if (cells.length < 1) {
    return false;
  }

  if (!hasUnescapedTablePipe(line) && cells.length === 1) {
    return false;
  }

  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseTableAlignments(line: string): TableAlignment[] | null {
  const cells = splitTableCells(line);

  if (cells.length < 1 || !cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))) {
    return null;
  }

  if (!hasUnescapedTablePipe(line) && cells.length === 1) {
    return null;
  }

  return cells.map((cell) => {
    const trimmed = cell.trim();
    const startsWithColon = trimmed.startsWith(':');
    const endsWithColon = trimmed.endsWith(':');

    if (startsWithColon && endsWithColon) {
      return 'center';
    }

    if (startsWithColon) {
      return 'left';
    }

    if (endsWithColon) {
      return 'right';
    }

    return 'none';
  });
}

function splitTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  let escaped = false;

  for (const character of trimmed) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }

    if (character === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeTableRow(cells: string[], columnCount: number): string[] {
  if (cells.length === columnCount) {
    return cells;
  }

  if (cells.length < columnCount) {
    return [...cells, ...Array.from({ length: columnCount - cells.length }, () => '')];
  }

  return cells.slice(0, columnCount);
}

function isPotentialTableStart(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) {
    return false;
  }

  const headerCells = splitTableCells(lines[index]);
  const alignments = parseTableAlignments(lines[index + 1]);
  const hasPipeContext =
    hasUnescapedTablePipe(lines[index]) || hasUnescapedTablePipe(lines[index + 1]);

  return (
    hasPipeContext &&
    headerCells.length >= 1 &&
    alignments !== null &&
    alignments.length === headerCells.length
  );
}

function isMalformedTableStart(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length || isPotentialTableStart(lines, index)) {
    return false;
  }

  const currentLine = lines[index];
  const separatorLine = lines[index + 1];

  if (!isTableSeparatorLine(separatorLine)) {
    return false;
  }

  return hasUnescapedTablePipe(currentLine) || hasUnescapedTablePipe(separatorLine);
}

function isIndentedCodeLine(line: string): boolean {
  return /^(?: {4}|\t)/.test(line);
}

function stripIndent(line: string): string {
  if (line.startsWith('\t')) {
    return line.slice(1);
  }

  if (line.startsWith('    ')) {
    return line.slice(4);
  }

  return line;
}

function parseHeadingLine(line: string): { level: 1 | 2 | 3 | 4 | 5 | 6; text: string } | null {
  const match = line.match(HEADING_PATTERN);

  if (!match) {
    return null;
  }

  return {
    level: match[1].length as 1 | 2 | 3 | 4 | 5 | 6,
    text: match[2]
  };
}

function parseMarkdownDocument(source: string): ParsedDocument {
  const lines = source.replace(/\r/g, '').split('\n');
  const blocks: RenderBlock[] = [];
  const outline: OutlineItem[] = [];
  let index = 0;
  let headingSequence = 0;
  let blockSequence = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const heading = parseHeadingLine(line);

    if (heading) {
      const outlineId = `heading-${headingSequence}`;
      const inlineNodes = parseInlineNodes(heading.text);
      const outlineText = extractPlainTextFromInlineNodes(inlineNodes) || '\u65e0\u6807\u9898';

      blocks.push({
        id: `block-${blockSequence}`,
        kind: 'heading',
        source: line,
        level: heading.level,
        text: heading.text,
        inlineNodes,
        outlineId,
        outlineText
      });
      outline.push({
        id: outlineId,
        level: heading.level,
        text: outlineText
      });
      headingSequence += 1;
      blockSequence += 1;
      index += 1;
      continue;
    }

    const fencedCodeMatch = line.match(/^```(.*)$/);

    if (fencedCodeMatch) {
      const language = fencedCodeMatch[1].trim();
      const codeLines: string[] = [];
      const sourceLines = [line];
      index += 1;

      while (index < lines.length && !lines[index].startsWith('```')) {
        codeLines.push(lines[index]);
        sourceLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length && lines[index].startsWith('```')) {
        sourceLines.push(lines[index]);
        index += 1;
      }

      blocks.push({
        id: `block-${blockSequence}`,
        kind: 'codeBlock',
        source: sourceLines.join('\n'),
        language,
        code: codeLines.join('\n'),
        style: 'fenced'
      });
      blockSequence += 1;
      continue;
    }

    if (isPotentialTableStart(lines, index)) {
      const headerSource = splitTableCells(lines[index]);
      const alignments = parseTableAlignments(lines[index + 1]) ?? [];
      const rowsSource: string[][] = [];
      const sourceLines = [lines[index], lines[index + 1]];
      index += 2;

      while (index < lines.length) {
        const rowLine = lines[index];

        if (rowLine.trim().length === 0) {
          break;
        }

        if (
          parseHeadingLine(rowLine) ||
          rowLine.startsWith('```') ||
          isIndentedCodeLine(rowLine)
        ) {
          break;
        }

        const rowCells = splitTableCells(rowLine);

        if (headerSource.length > 1 && (!hasUnescapedTablePipe(rowLine) || rowCells.length < 2)) {
          break;
        }

        rowsSource.push(normalizeTableRow(rowCells, headerSource.length));
        sourceLines.push(rowLine);
        index += 1;
      }

      const normalizedHeader = normalizeTableRow(headerSource, alignments.length);

      blocks.push({
        id: `block-${blockSequence}`,
        kind: 'table',
        source: sourceLines.join('\n'),
        headerSource: normalizedHeader,
        header: normalizedHeader.map((cell) => parseInlineNodes(cell)),
        alignments,
        rowsSource,
        rows: rowsSource.map((row) => row.map((cell) => parseInlineNodes(cell)))
      });
      blockSequence += 1;
      continue;
    }

    if (isMalformedTableStart(lines, index)) {
      const rawLines: string[] = [];

      while (index < lines.length) {
        const currentLine = lines[index];

        if (currentLine.trim().length === 0) {
          break;
        }

        if (
          rawLines.length > 0 &&
          (parseHeadingLine(currentLine) ||
            currentLine.startsWith('```') ||
            isPotentialTableStart(lines, index) ||
            isIndentedCodeLine(currentLine))
        ) {
          break;
        }

        rawLines.push(currentLine);
        index += 1;
      }

      const rawSource = rawLines.join('\n');

      blocks.push({
        id: `block-${blockSequence}`,
        kind: 'raw',
        source: rawSource,
        text: rawSource
      });
      blockSequence += 1;
      continue;
    }

    if (isIndentedCodeLine(line)) {
      const codeLines: string[] = [];
      const sourceLines: string[] = [];

      while (index < lines.length) {
        const currentLine = lines[index];

        if (currentLine.length === 0) {
          codeLines.push('');
          sourceLines.push('');
          index += 1;
          continue;
        }

        if (!isIndentedCodeLine(currentLine)) {
          break;
        }

        codeLines.push(stripIndent(currentLine));
        sourceLines.push(currentLine);
        index += 1;
      }

      blocks.push({
        id: `block-${blockSequence}`,
        kind: 'codeBlock',
        source: sourceLines.join('\n'),
        language: '',
        code: codeLines.join('\n'),
        style: 'indented'
      });
      blockSequence += 1;
      continue;
    }

    const paragraphLines: string[] = [];

    while (index < lines.length) {
      const currentLine = lines[index];

      if (currentLine.trim().length === 0) {
        break;
      }

      if (
        parseHeadingLine(currentLine) ||
        currentLine.startsWith('```') ||
        isPotentialTableStart(lines, index) ||
        isIndentedCodeLine(currentLine)
      ) {
        break;
      }

      paragraphLines.push(currentLine);
      index += 1;
    }

    const sourceText = paragraphLines.join('\n');

    blocks.push({
      id: `block-${blockSequence}`,
      kind: 'paragraph',
      source: sourceText,
      inlineNodes: parseInlineNodes(sourceText)
    });
    blockSequence += 1;
  }

  return {
    blocks,
    outline
  };
}

function applyParsedDocument(document: DocumentState, parsed: ParsedDocument): void {
  document.parsedBlocks = parsed.blocks;
  document.outline = parsed.outline;
}

function refreshDocumentStructure(document: DocumentState): void {
  applyParsedDocument(document, parseMarkdownDocument(document.content));
}

function extractPlainTextFromInlineNodes(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.kind === 'text' || node.kind === 'inlineCode') {
        return node.text;
      }

      return extractPlainTextFromInlineNodes(node.children);
    })
    .join('');
}

function hasMeaningfulMarkdown(source: string): boolean {
  return source.replace(/\r/g, '').trim().length > 0;
}

function normalizeBlockSource(source: string): string {
  return source.replace(/\r/g, '').replace(/^\n+|\n+$/g, '');
}

function escapeTableCellText(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function alignmentToMarkdown(align: TableAlignment): string {
  switch (align) {
    case 'left':
      return ':---';
    case 'center':
      return ':---:';
    case 'right':
      return '---:';
    default:
      return '---';
  }
}

function serializeTableSource(
  headerSource: string[],
  alignments: TableAlignment[],
  rowsSource: string[][]
): string {
  const headerLine = `| ${headerSource.map((cell) => escapeTableCellText(cell)).join(' | ')} |`;
  const separatorLine = `| ${alignments.map((align) => alignmentToMarkdown(align)).join(' | ')} |`;
  const bodyLines = rowsSource.map((row) => {
    const normalizedRow = normalizeTableRow(row, headerSource.length);
    return `| ${normalizedRow.map((cell) => escapeTableCellText(cell)).join(' | ')} |`;
  });

  return [headerLine, separatorLine, ...bodyLines].join('\n');
}

function serializeCodeBlockSource(style: CodeBlockStyle, language: string, code: string): string {
  const normalizedCode = code.replace(/\r/g, '');

  if (style === 'indented') {
    return normalizedCode
      .split('\n')
      .map((line) => (line.length > 0 ? `    ${line}` : ''))
      .join('\n');
  }

  return `\`\`\`${language}\n${normalizedCode}\n\`\`\``;
}

function serializeDocumentSources(sources: string[]): string {
  return sources
    .map((source) => normalizeBlockSource(source))
    .filter((source) => hasMeaningfulMarkdown(source))
    .join('\n\n');
}

function updateDocumentContent(document: DocumentState, nextContent: string): void {
  document.content = nextContent;
  document.isDirty = document.isUntitled || nextContent !== document.savedContent;
  refreshDocumentStructure(document);
}

function replaceBlockSource(document: DocumentState, blockId: string, nextSource: string): void {
  const normalizedSource = normalizeBlockSource(nextSource);
  const sources = document.parsedBlocks.map((block) => block.source);

  if (blockId === NEW_BLOCK_EDITOR_ID) {
    if (!hasMeaningfulMarkdown(normalizedSource)) {
      return;
    }

    updateDocumentContent(document, serializeDocumentSources([...sources, normalizedSource]));
    return;
  }

  const blockIndex = document.parsedBlocks.findIndex((block) => block.id === blockId);

  if (blockIndex < 0) {
    return;
  }

  const nextSources = [...sources];

  if (hasMeaningfulMarkdown(normalizedSource)) {
    nextSources[blockIndex] = normalizedSource;
  } else {
    nextSources.splice(blockIndex, 1);
  }

  updateDocumentContent(document, serializeDocumentSources(nextSources));
}

function findGeneratedCodeBlock(
  document: DocumentState,
  source: string
): Extract<RenderBlock, { kind: 'codeBlock' }> | null {
  const normalizedSource = normalizeBlockSource(source);

  for (let index = document.parsedBlocks.length - 1; index >= 0; index -= 1) {
    const block = document.parsedBlocks[index];

    if (block.kind === 'codeBlock' && normalizeBlockSource(block.source) === normalizedSource) {
      return block;
    }
  }

  return null;
}

function commitBlockSource(
  blockId: string,
  nextSource: string,
  options: CommitBlockSourceOptions = {}
): void {
  const activeDocument = getActiveDocument();

  activeEditingBlockId = null;
  pendingEditorSelection = null;

  if (!activeDocument) {
    renderActiveDocument();
    renderSidebar();
    return;
  }

  replaceBlockSource(activeDocument, blockId, nextSource);

  if (options.editGeneratedCodeBlock) {
    const generatedBlock = findGeneratedCodeBlock(
      activeDocument,
      options.generatedCodeSource ?? nextSource
    );

    if (generatedBlock) {
      activeEditingBlockId = generatedBlock.id;
      pendingEditorSelection = {
        blockId: generatedBlock.id,
        offset: options.caretOffset ?? generatedBlock.code.length
      };
    }
  }

  renderActiveDocument();
  renderSidebar();
}

function autoResizeTextarea(textarea: HTMLTextAreaElement, minHeight = 32): void {
  textarea.style.height = '0px';
  textarea.style.height = `${Math.max(textarea.scrollHeight, minHeight)}px`;
}

function getTextareaLineHeight(textarea: HTMLTextAreaElement): number {
  const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight);

  return Number.isFinite(lineHeight) ? lineHeight : 22;
}

function autoResizeCodeTextarea(textarea: HTMLTextAreaElement): void {
  autoResizeTextarea(textarea, getTextareaLineHeight(textarea));
}

function focusWithoutScrolling(element: HTMLElement): void {
  try {
    element.focus({
      preventScroll: true
    });
  } catch {
    element.focus();
  }
}

function focusTextEditor(
  textarea: HTMLTextAreaElement,
  selectionIndex = textarea.value.length,
  resize = autoResizeTextarea
): void {
  window.setTimeout(() => {
    focusWithoutScrolling(textarea);
    const safeSelectionIndex = Math.max(0, Math.min(selectionIndex, textarea.value.length));
    textarea.setSelectionRange(safeSelectionIndex, safeSelectionIndex);
    resize(textarea);
  }, 0);
}

function clearActiveBlockHandlers(): void {
  activeBlockCommit = null;
  activeBlockCancel = null;
}

function commitActiveBlock(): void {
  const commit = activeBlockCommit;

  if (!commit) {
    return;
  }

  clearActiveBlockHandlers();
  commit();
}

function cancelActiveBlockEdit(): void {
  const cancel = activeBlockCancel;

  if (!cancel) {
    return;
  }

  clearActiveBlockHandlers();
  pendingEditorSelection = null;
  cancel();
}

function syncActiveDocumentFromEditor(): void {
  commitActiveBlock();
}

function isSubmitShortcut(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && (event.ctrlKey || event.metaKey);
}

function insertTextAtSelection(textarea: HTMLTextAreaElement, insertedText: string): void {
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? start;
  const value = textarea.value;
  textarea.value = `${value.slice(0, start)}${insertedText}${value.slice(end)}`;
  const nextOffset = start + insertedText.length;
  textarea.setSelectionRange(nextOffset, nextOffset);
  autoResizeTextarea(textarea);
}

function parseOpeningCodeFence(source: string): string | null {
  const normalizedSource = source.replace(/\r/g, '').trim();
  const match = normalizedSource.match(/^```([^\s`]*)$/);

  return match ? match[1] : null;
}

function createEmptyFencedCodeSource(language: string): string {
  return `\`\`\`${language}\n\n\`\`\``;
}

function createOpeningFenceConversion(
  source: string,
  lineStart: number,
  lineEnd: number
): OpeningFenceConversion | null {
  const line = source.slice(lineStart, lineEnd);
  const language = parseOpeningCodeFence(line);

  if (language === null) {
    return null;
  }

  const codeSource = createEmptyFencedCodeSource(language);
  const prefix = source.slice(0, lineStart);
  const suffix = source.slice(lineEnd);

  return {
    nextSource: serializeDocumentSources([prefix, codeSource, suffix]),
    codeSource,
    caretOffset: 0
  };
}

function getOpeningFenceConversionBeforeLineBreak(
  source: string,
  selectionStart: number,
  selectionEnd: number
): OpeningFenceConversion | null {
  if (selectionStart !== selectionEnd) {
    return null;
  }

  const normalizedSource = source.replace(/\r/g, '');
  const lineStart = normalizedSource.lastIndexOf('\n', Math.max(selectionStart - 1, 0)) + 1;
  const nextLineBreak = normalizedSource.indexOf('\n', selectionStart);
  const lineEnd = nextLineBreak >= 0 ? nextLineBreak : normalizedSource.length;
  const trailingText = normalizedSource.slice(selectionStart, lineEnd);

  if (trailingText.trim().length > 0) {
    return null;
  }

  return createOpeningFenceConversion(normalizedSource, lineStart, lineEnd);
}

function getOpeningFenceConversionAfterLineBreak(
  source: string,
  selectionStart: number
): OpeningFenceConversion | null {
  const normalizedSource = source.replace(/\r/g, '');

  if (selectionStart <= 0 || normalizedSource[selectionStart - 1] !== '\n') {
    return null;
  }

  const lineEnd = selectionStart - 1;
  const lineStart = normalizedSource.lastIndexOf('\n', Math.max(lineEnd - 1, 0)) + 1;

  return createOpeningFenceConversion(normalizedSource, lineStart, selectionStart);
}

function getTextOffset(container: HTMLElement, node: Node, offset: number): number | null {
  if (!container.contains(node)) {
    return null;
  }

  try {
    const range = document.createRange();
    range.setStart(container, 0);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return null;
  }
}

function getTextOffsetFromPoint(container: HTMLElement, event: PointerEvent): number {
  const caretDocument = document as CaretDocument;
  const fallbackOffset = container.textContent?.length ?? 0;
  const position = caretDocument.caretPositionFromPoint?.(event.clientX, event.clientY);

  if (position) {
    return getTextOffset(container, position.offsetNode, position.offset) ?? fallbackOffset;
  }

  const range = caretDocument.caretRangeFromPoint?.(event.clientX, event.clientY);

  if (range) {
    return getTextOffset(container, range.startContainer, range.startOffset) ?? fallbackOffset;
  }

  return fallbackOffset;
}

function clearHeaderNotice(): void {
  if (headerNoticeTimer !== null) {
    window.clearTimeout(headerNoticeTimer);
    headerNoticeTimer = null;
  }

  headerNotice = null;
}

function showHeaderNotice(text: string, isError = false): void {
  headerNotice = { text, isError };

  if (headerNoticeTimer !== null) {
    window.clearTimeout(headerNoticeTimer);
  }

  headerNoticeTimer = window.setTimeout(() => {
    headerNotice = null;
    headerNoticeTimer = null;
    renderDocumentHeader();
  }, 4000);

  renderDocumentHeader();
}

function getDefaultHint(document: DocumentState | undefined): string {
  if (!document) {
    return '\u4ece "\u6587\u4ef6 -> \u6253\u5f00" \u9009\u62e9\u4e00\u4e2a Markdown \u6587\u4ef6\u3002';
  }

  if (document.isUntitled) {
    return '\u8fd9\u662f\u4e00\u4e2a\u672a\u4fdd\u5b58\u7684 Markdown \u65b0\u6587\u6863\uff0c\u76ee\u524d\u53ea\u4fdd\u5b58\u5728\u5f53\u524d\u4f1a\u8bdd\u91cc\u3002';
  }

  return '\u5de6\u4fa7\u6587\u4ef6\u5217\u8868\u4f1a\u8bb0\u5f55\u5f53\u524d\u4f1a\u8bdd\u4e0e\u5386\u53f2\u4e2d\u7684 Markdown \u6587\u6863\u3002';
}

function renderDocumentHeader(): void {
  const activeDocument = getActiveDocument();

  fileName.textContent = activeDocument?.fileName ?? '\u672a\u6253\u5f00\u6587\u4ef6';

  if (headerNotice) {
    fileHint.textContent = headerNotice.text;
    fileHint.classList.toggle('is-error', headerNotice.isError);
    return;
  }

  fileHint.textContent = getDefaultHint(activeDocument);
  fileHint.classList.remove('is-error');
}

function splitFileNameLabel(name: string): { baseName: string; extension: string } {
  const dotIndex = name.lastIndexOf('.');

  if (dotIndex <= 0 || dotIndex === name.length - 1) {
    return {
      baseName: name,
      extension: ''
    };
  }

  return {
    baseName: name.slice(0, dotIndex),
    extension: name.slice(dotIndex)
  };
}

function createSidebarEmpty(text: string): HTMLElement {
  const empty = document.createElement('p');
  empty.className = 'sidebar-empty';
  empty.textContent = text;
  return empty;
}

function getOrderedSessionDocuments(): DocumentState[] {
  return [...documents].sort((left, right) => right.listOrder - left.listOrder);
}

function getReplacementDocumentId(closingDocumentId: string): string | null {
  const orderedDocuments = getOrderedSessionDocuments();
  const closingIndex = orderedDocuments.findIndex((document) => document.id === closingDocumentId);

  if (closingIndex < 0) {
    return orderedDocuments[0]?.id ?? null;
  }

  return orderedDocuments[closingIndex + 1]?.id ?? orderedDocuments[closingIndex - 1]?.id ?? null;
}

function closeRecentFileEntry(filePath: string): void {
  removeRecentFile(filePath);
  renderSidebar();
}

async function closeDocument(documentId: string): Promise<void> {
  syncActiveDocumentFromEditor();

  const document = documents.find((entry) => entry.id === documentId);

  if (!document) {
    return;
  }

  if (document.isDirty) {
    const shouldDiscard = window.confirm(
      '\u5f53\u524d\u6587\u4ef6\u6709\u672a\u4fdd\u5b58\u7684\u4fee\u6539\uff0c\u786e\u5b9a\u5173\u95ed\u5e76\u4e22\u5f03\u8fd9\u4e9b\u5185\u5bb9\u5417\uff1f'
    );

    if (!shouldDiscard) {
      return;
    }
  }

  const replacementDocumentId =
    activeDocumentId === documentId ? getReplacementDocumentId(documentId) : activeDocumentId;

  if (document.filePath) {
    removeRecentFile(document.filePath);
  }

  documents = documents.filter((entry) => entry.id !== documentId);

  if (replacementDocumentId && documents.some((entry) => entry.id === replacementDocumentId)) {
    activeDocumentId = replacementDocumentId;
  } else {
    activeDocumentId = null;
  }

  activeEditingBlockId = null;
  clearActiveBlockHandlers();
  renderActiveDocument();
  renderSidebar();
}

function createFileListItems(): FileListItem[] {
  const items: FileListItem[] = [];
  const sessionPaths = new Set(
    documents
      .map((document) => document.filePath)
      .filter((path): path is string => typeof path === 'string')
  );

  for (const document of documents) {
    items.push({
      key: document.id,
      source: 'document',
      documentId: document.id,
      filePath: document.filePath,
      fileName: document.fileName,
      directoryName: document.isUntitled
        ? '\u672a\u4fdd\u5b58'
        : getDirectoryLabel(document.directoryPath),
      timeLabel: document.isUntitled ? '\u672a\u4fdd\u5b58' : formatListDate(document.lastViewedAt),
      preview: buildPreview(document.content),
      isActive: document.id === activeDocumentId,
      isDirty: isDocumentUnsaved(document),
      lastViewedAt: document.listOrder
    });
  }

  for (const entry of recentFiles) {
    if (sessionPaths.has(entry.filePath)) {
      continue;
    }

    items.push({
      key: entry.filePath,
      source: 'recent',
      documentId: null,
      filePath: entry.filePath,
      fileName: entry.fileName,
      directoryName: entry.directoryName,
      timeLabel: formatListDate(entry.lastOpenedAt),
      preview: entry.preview,
      isActive: false,
      isDirty: false,
      lastViewedAt: entry.lastOpenedAt
    });
  }

  return items.sort((left, right) => right.lastViewedAt - left.lastViewedAt);
}

function createFileCard(item: FileListItem): HTMLElement {
  const card = document.createElement('article');
  card.className = 'file-card';
  card.classList.toggle('is-active', item.isActive);
  card.classList.toggle('is-dirty', item.isDirty);

  const mainButton = document.createElement('button');
  mainButton.type = 'button';
  mainButton.className = 'file-card-main';

  const activateItem = () => {
    if (item.source === 'document' && item.documentId) {
      void activateDocument(item.documentId);
      return;
    }

    if (item.filePath) {
      void openDocumentFromPath(item.filePath);
    }
  };

  const closeItem = () => {
    if (item.source === 'document' && item.documentId) {
      void closeDocument(item.documentId);
      return;
    }

    if (item.filePath) {
      closeRecentFileEntry(item.filePath);
    }
  };

  mainButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    activateItem();
  });

  mainButton.addEventListener('click', (event) => {
    if (event.detail === 0) {
      activateItem();
    }
  });

  const meta = document.createElement('div');
  meta.className = 'file-card-meta';

  const directory = document.createElement('span');
  directory.className = 'file-card-directory';
  directory.textContent = item.directoryName;

  const time = document.createElement('span');
  time.className = 'file-card-time';
  time.textContent = item.timeLabel;

  meta.append(directory, time);

  const nameRow = document.createElement('div');
  nameRow.className = 'file-card-name-row';

  const nameLabel = document.createElement('span');
  nameLabel.className = 'file-card-name';

  const { baseName, extension } = splitFileNameLabel(item.fileName);

  const baseNameNode = document.createElement('strong');
  baseNameNode.className = 'file-card-name-base';
  baseNameNode.textContent = baseName;
  nameLabel.append(baseNameNode);

  if (extension) {
    const extensionNode = document.createElement('span');
    extensionNode.className = 'file-card-name-ext';
    extensionNode.textContent = extension;
    nameLabel.append(extensionNode);
  }

  nameRow.append(nameLabel);

  if (item.isDirty) {
    const dirtyDot = document.createElement('span');
    dirtyDot.className = 'file-card-dot';
    dirtyDot.textContent = '\u25CF';
    nameRow.append(dirtyDot);
  }

  const preview = document.createElement('p');
  preview.className = 'file-card-preview';
  preview.textContent = item.preview;

  mainButton.append(meta, nameRow, preview);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'file-card-close';
  closeButton.textContent = '\u00d7';
  closeButton.setAttribute(
    'aria-label',
    item.source === 'document'
      ? '\u5173\u95ed\u5f53\u524d\u4f1a\u8bdd\u6587\u4ef6'
      : '\u4ece\u6700\u8fd1\u6587\u4ef6\u5217\u8868\u79fb\u9664'
  );
  closeButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeItem();
  });
  closeButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.detail === 0) {
      closeItem();
    }
  });

  card.append(mainButton, closeButton);
  return card;
}

function appendInlineNodes(parent: HTMLElement, nodes: InlineNode[]): void {
  for (const node of nodes) {
    if (node.kind === 'text') {
      parent.append(document.createTextNode(node.text));
      continue;
    }

    if (node.kind === 'inlineCode') {
      const code = document.createElement('code');
      code.className = 'viewer-inline-code';
      code.textContent = node.text;
      parent.append(code);
      continue;
    }

    if (node.kind === 'strong') {
      const strong = document.createElement('strong');
      strong.className = 'viewer-strong';
      appendInlineNodes(strong, node.children);
      parent.append(strong);
      continue;
    }

    const emphasis = document.createElement('em');
    emphasis.className = 'viewer-emphasis';
    appendInlineNodes(emphasis, node.children);
    parent.append(emphasis);
  }
}

function renderFilesSidebar(): void {
  sidebarBody.replaceChildren();

  const items = createFileListItems();

  if (items.length === 0) {
    sidebarBody.append(
      createSidebarEmpty(
        '\u8fd9\u91cc\u4f1a\u663e\u793a\u6253\u5f00\u8fc7\u3001\u65b0\u5efa\u8fc7\u7684 Markdown \u6587\u6863\u3002'
      )
    );
    return;
  }

  const list = document.createElement('div');
  list.className = 'file-list';

  for (const item of items) {
    list.append(createFileCard(item));
  }

  sidebarBody.append(list);
}

function renderOutlineSidebar(): void {
  sidebarBody.replaceChildren();

  const activeDocument = getActiveDocument();

  if (!activeDocument) {
    sidebarBody.append(
      createSidebarEmpty('\u5148\u6fc0\u6d3b\u4e00\u4e2a Markdown \u6587\u6863\uff0c\u518d\u67e5\u770b\u5927\u7eb2\u3002')
    );
    return;
  }

  const outline = activeDocument.outline;

  if (outline.length === 0) {
    sidebarBody.append(
      createSidebarEmpty('\u5f53\u524d\u6587\u6863\u8fd8\u6ca1\u6709\u53ef\u7528\u4e8e\u5927\u7eb2\u7684\u6807\u9898\u3002')
    );
    return;
  }

  const list = document.createElement('div');
  list.className = 'outline-list';

  for (const item of outline) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'outline-item';
    button.style.paddingLeft = `${14 + (item.level - 1) * 14}px`;
    button.textContent = item.text;
    const scrollToHeading = () => {
      const target = content.querySelector<HTMLElement>(`[data-outline-id="${item.id}"]`);

      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    };

    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      scrollToHeading();
    });

    button.addEventListener('click', (event) => {
      if (event.detail === 0) {
        scrollToHeading();
      }
    });
    list.append(button);
  }

  sidebarBody.append(list);
}

function renderSidebar(): void {
  filesTab.classList.toggle('is-active', sidebarMode === FILES_MODE);
  outlineTab.classList.toggle('is-active', sidebarMode === OUTLINE_MODE);

  if (sidebarMode === FILES_MODE) {
    renderFilesSidebar();
    return;
  }

  renderOutlineSidebar();
}

function renderEditorEmptyState(): void {
  content.className = 'viewer-content viewer-content-empty';
  content.replaceChildren();
  activeEditingBlockId = null;
  clearActiveBlockHandlers();

  const emptyText = document.createElement('p');
  emptyText.className = 'viewer-line viewer-empty-text';
  emptyText.textContent =
    '\u5f53\u524d\u6ca1\u6709\u6fc0\u6d3b\u7684 Markdown \u6587\u6863\u3002';

  const emptyHint = document.createElement('p');
  emptyHint.className = 'viewer-line viewer-empty-text';
  emptyHint.textContent =
    '\u53ef\u4ee5\u901a\u8fc7\u201c\u6587\u4ef6 -> \u65b0\u5efa\u201d\u6216\u201c\u6587\u4ef6 -> \u6253\u5f00\u201d\u5f00\u59cb\u3002';

  content.append(emptyText, emptyHint);
}

function getBlockViewportSnapshot(blockId: string): BlockViewportSnapshot | null {
  const block = content.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);

  if (!block) {
    return null;
  }

  const contentBounds = content.getBoundingClientRect();
  const blockBounds = block.getBoundingClientRect();

  return {
    blockId,
    scrollTop: content.scrollTop,
    topOffset: blockBounds.top - contentBounds.top
  };
}

function restoreBlockViewport(snapshot: BlockViewportSnapshot | null): void {
  if (!snapshot) {
    return;
  }

  const block = content.querySelector<HTMLElement>(`[data-block-id="${snapshot.blockId}"]`);

  if (!block) {
    content.scrollTop = snapshot.scrollTop;
    return;
  }

  const contentBounds = content.getBoundingClientRect();
  const blockBounds = block.getBoundingClientRect();
  const nextTopOffset = blockBounds.top - contentBounds.top;
  content.scrollTop += nextTopOffset - snapshot.topOffset;
}

function activateBlockEditor(blockId: string, options: ActivateBlockEditorOptions = {}): void {
  const activeDocument = getActiveDocument();

  if (!activeDocument) {
    return;
  }

  if (activeEditingBlockId === blockId) {
    return;
  }

  const viewportSnapshot = getBlockViewportSnapshot(blockId);
  syncActiveDocumentFromEditor();
  activeEditingBlockId = blockId;

  if (typeof options.caretOffset === 'number') {
    pendingEditorSelection = {
      blockId,
      offset: options.caretOffset
    };
  } else {
    pendingEditorSelection = null;
  }

  renderActiveDocument();
  restoreBlockViewport(viewportSnapshot);
  window.requestAnimationFrame(() => {
    restoreBlockViewport(viewportSnapshot);
  });
}

function createBlockShell(blockId: string, className: string): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = className;
  wrapper.dataset.blockId = blockId;
  return wrapper;
}

function createBlockEditor(
  blockId: string,
  initialValue: string,
  placeholder: string
): { wrapper: HTMLDivElement; textarea: HTMLTextAreaElement } {
  const wrapper = createBlockShell(blockId, 'viewer-block viewer-block-editor');
  const textarea = document.createElement('textarea');
  textarea.className = 'viewer-markdown-editor';
  textarea.value = initialValue;
  textarea.placeholder = placeholder;
  textarea.rows = Math.max(initialValue.split('\n').length, 1);
  textarea.spellcheck = false;
  textarea.addEventListener('input', () => {
    autoResizeTextarea(textarea);
  });
  wrapper.append(textarea);
  return { wrapper, textarea };
}

function createMarkdownEditorBlock(blockId: string, initialValue: string, placeholder: string): HTMLElement {
  const { wrapper, textarea } = createBlockEditor(blockId, initialValue, placeholder);
  let isEditorClosed = false;

  const convertOpeningFenceToCodeBlock = (conversion: OpeningFenceConversion) => {
    isEditorClosed = true;
    clearActiveBlockHandlers();
    commitBlockSource(blockId, conversion.nextSource, {
      editGeneratedCodeBlock: true,
      caretOffset: conversion.caretOffset,
      generatedCodeSource: conversion.codeSource
    });
  };

  activeBlockCommit = () => {
    isEditorClosed = true;
    commitBlockSource(blockId, textarea.value);
  };
  activeBlockCancel = () => {
    isEditorClosed = true;
    activeEditingBlockId = null;
    renderActiveDocument();
    renderSidebar();
  };

  textarea.addEventListener('beforeinput', (event) => {
    if (isEditorClosed) {
      return;
    }

    if (event.inputType !== 'insertLineBreak' && event.inputType !== 'insertParagraph') {
      return;
    }

    const conversion = getOpeningFenceConversionBeforeLineBreak(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd
    );

    if (conversion) {
      event.preventDefault();
      convertOpeningFenceToCodeBlock(conversion);
    }
  });

  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelActiveBlockEdit();
      return;
    }

    if (
      event.key === 'Enter' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      const conversion = getOpeningFenceConversionBeforeLineBreak(
        textarea.value,
        textarea.selectionStart,
        textarea.selectionEnd
      );

      if (conversion) {
        event.preventDefault();
        convertOpeningFenceToCodeBlock(conversion);
        return;
      }
    }

    if (isSubmitShortcut(event)) {
      event.preventDefault();
      commitActiveBlock();
    }
  });

  textarea.addEventListener('input', () => {
    if (isEditorClosed) {
      return;
    }

    const conversion = getOpeningFenceConversionAfterLineBreak(
      textarea.value,
      textarea.selectionStart
    );

    if (conversion) {
      convertOpeningFenceToCodeBlock(conversion);
    }
  });

  textarea.addEventListener('blur', () => {
    if (isEditorClosed) {
      return;
    }

    syncActiveDocumentFromEditor();
  });

  focusTextEditor(textarea);
  return wrapper;
}

function createRenderedTextBlock(
  block: Extract<RenderBlock, { kind: 'heading' | 'paragraph' }>
): HTMLElement {
  const wrapper = createBlockShell(block.id, `viewer-block viewer-block-${block.kind}`);

  if (block.kind === 'heading') {
    wrapper.dataset.outlineId = block.outlineId;
  }

  const activate = () => {
    activateBlockEditor(block.id);
  };

  wrapper.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    activate();
  });

  wrapper.addEventListener('click', (event) => {
    if (event.detail === 0) {
      activate();
    }
  });

  if (block.kind === 'heading') {
    const heading = document.createElement(`h${block.level}` as keyof HTMLElementTagNameMap);
    heading.className = `viewer-heading viewer-heading-${block.level}`;
    appendInlineNodes(heading, block.inlineNodes);
    wrapper.append(heading);
    return wrapper;
  }

  const paragraph = document.createElement('p');
  paragraph.className = 'viewer-paragraph';
  appendInlineNodes(paragraph, block.inlineNodes);
  wrapper.append(paragraph);
  return wrapper;
}

function createRenderedRawBlock(block: Extract<RenderBlock, { kind: 'raw' }>): HTMLElement {
  const wrapper = createBlockShell(block.id, 'viewer-block viewer-block-raw');

  const activate = () => {
    activateBlockEditor(block.id);
  };

  wrapper.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    activate();
  });

  wrapper.addEventListener('click', (event) => {
    if (event.detail === 0) {
      activate();
    }
  });

  const raw = document.createElement('pre');
  raw.className = 'viewer-raw-block';
  raw.textContent = block.text;
  wrapper.append(raw);
  return wrapper;
}

function createRenderedTableBlock(block: Extract<RenderBlock, { kind: 'table' }>): HTMLElement {
  const wrapper = createBlockShell(block.id, 'viewer-block viewer-block-table');
  const surface = document.createElement('div');
  surface.className = 'viewer-table-wrap';
  const table = document.createElement('table');
  table.className = 'viewer-table';

  const activate = () => {
    activateBlockEditor(block.id);
  };

  wrapper.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    activate();
  });

  wrapper.addEventListener('click', (event) => {
    if (event.detail === 0) {
      activate();
    }
  });

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  block.header.forEach((cellNodes, index) => {
    const cell = document.createElement('th');
    const align = block.alignments[index] ?? 'none';
    cell.dataset.align = align;

    if (align !== 'none') {
      cell.style.textAlign = align;
    }

    appendInlineNodes(cell, cellNodes);
    headerRow.append(cell);
  });

  thead.append(headerRow);
  table.append(thead);

  if (block.rows.length > 0) {
    const tbody = document.createElement('tbody');

    block.rows.forEach((rowCells) => {
      const row = document.createElement('tr');

      rowCells.forEach((cellNodes, index) => {
        const cell = document.createElement('td');
        const align = block.alignments[index] ?? 'none';
        cell.dataset.align = align;

        if (align !== 'none') {
          cell.style.textAlign = align;
        }

        appendInlineNodes(cell, cellNodes);
        row.append(cell);
      });

      tbody.append(row);
    });

    table.append(tbody);
  }

  surface.append(table);
  wrapper.append(surface);
  return wrapper;
}

function appendCodeLines(container: HTMLElement, codeText: string): void {
  const lines = codeText.length === 0 ? [''] : codeText.split('\n');

  lines.forEach((line) => {
    const codeLine = document.createElement('span');
    codeLine.className = 'viewer-code-line';

    if (line.length === 0) {
      codeLine.classList.add('is-empty');
    } else {
      codeLine.textContent = line;
    }

    container.append(codeLine);
  });
}

function createTableEditorBlock(block: Extract<RenderBlock, { kind: 'table' }>): HTMLElement {
  const wrapper = createBlockShell(block.id, 'viewer-block viewer-block-table');
  const surface = document.createElement('div');
  surface.className = 'viewer-table-wrap is-editing';
  const table = document.createElement('table');
  table.className = 'viewer-table viewer-table-editor';
  const inputRefs: HTMLInputElement[] = [];

  const collectValues = (): { headerSource: string[]; rowsSource: string[][] } => {
    const headerSource = Array.from(
      surface.querySelectorAll<HTMLInputElement>('thead .viewer-table-input')
    ).map((input) => input.value);
    const rowsSource = Array.from(surface.querySelectorAll<HTMLTableRowElement>('tbody tr')).map((row) =>
      Array.from(row.querySelectorAll<HTMLInputElement>('.viewer-table-input')).map((input) => input.value)
    );

    return {
      headerSource,
      rowsSource
    };
  };

  const commit = () => {
    const { headerSource, rowsSource } = collectValues();

    commitBlockSource(
      block.id,
      serializeTableSource(headerSource, block.alignments, rowsSource)
    );
  };

  activeBlockCommit = commit;
  activeBlockCancel = () => {
    activeEditingBlockId = null;
    renderActiveDocument();
    renderSidebar();
  };

  const handleTableInputKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelActiveBlockEdit();
      return;
    }

    if (isSubmitShortcut(event)) {
      event.preventDefault();
      commitActiveBlock();
    }
  };

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  block.headerSource.forEach((cellText, index) => {
    const cell = document.createElement('th');
    const input = document.createElement('input');
    const align = block.alignments[index] ?? 'none';
    input.className = 'viewer-table-input';
    input.value = cellText;
    input.spellcheck = false;

    if (align !== 'none') {
      input.style.textAlign = align;
    }

    input.addEventListener('keydown', handleTableInputKeydown);
    inputRefs.push(input);
    cell.append(input);
    headerRow.append(cell);
  });

  thead.append(headerRow);
  table.append(thead);

  if (block.rowsSource.length > 0) {
    const tbody = document.createElement('tbody');

    block.rowsSource.forEach((rowSource) => {
      const row = document.createElement('tr');

      normalizeTableRow(rowSource, block.headerSource.length).forEach((cellText, index) => {
        const cell = document.createElement('td');
        const input = document.createElement('input');
        const align = block.alignments[index] ?? 'none';
        input.className = 'viewer-table-input';
        input.value = cellText;
        input.spellcheck = false;

        if (align !== 'none') {
          input.style.textAlign = align;
        }

        input.addEventListener('keydown', handleTableInputKeydown);
        inputRefs.push(input);
        cell.append(input);
        row.append(cell);
      });

      tbody.append(row);
    });

    table.append(tbody);
  }

  surface.append(table);
  wrapper.append(surface);
  wrapper.addEventListener('focusout', (event) => {
    const nextTarget = event.relatedTarget;

    if (nextTarget instanceof Node && wrapper.contains(nextTarget)) {
      return;
    }

    syncActiveDocumentFromEditor();
  });

  window.setTimeout(() => {
    inputRefs[0]?.focus();
    inputRefs[0]?.setSelectionRange(inputRefs[0].value.length, inputRefs[0].value.length);
  }, 0);

  return wrapper;
}

function createRenderedCodeBlock(block: Extract<RenderBlock, { kind: 'codeBlock' }>): HTMLElement {
  const wrapper = createBlockShell(block.id, 'viewer-block viewer-block-code');
  const pre = document.createElement('pre');
  pre.className = 'viewer-code-block';
  pre.dataset.language = block.language;
  const code = document.createElement('code');
  code.className = 'viewer-code-content';
  appendCodeLines(code, block.code);

  const activate = (caretOffset?: number) => {
    activateBlockEditor(block.id, { caretOffset });
  };

  wrapper.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    activate(getTextOffsetFromPoint(code, event));
  });

  wrapper.addEventListener('click', (event) => {
    if (event.detail === 0) {
      activate();
    }
  });

  if (block.language) {
    const languageBadge = document.createElement('span');
    languageBadge.className = 'viewer-code-language';
    languageBadge.textContent = block.language;
    pre.append(languageBadge);
  }

  pre.append(code);
  wrapper.append(pre);
  return wrapper;
}

function createCodeEditorBlock(block: Extract<RenderBlock, { kind: 'codeBlock' }>): HTMLElement {
  const wrapper = createBlockShell(block.id, 'viewer-block viewer-block-code');
  const surface = document.createElement('div');
  surface.className = 'viewer-code-block is-editing';

  if (block.language) {
    const languageBadge = document.createElement('span');
    languageBadge.className = 'viewer-code-language';
    languageBadge.textContent = block.language;
    surface.append(languageBadge);
  }

  const textarea = document.createElement('textarea');
  textarea.className = 'viewer-code-editor';
  textarea.value = block.code;
  textarea.rows = Math.max(block.code.split('\n').length, 1);
  textarea.spellcheck = false;
  textarea.addEventListener('input', () => {
    autoResizeCodeTextarea(textarea);
  });

  activeBlockCommit = () => {
    commitBlockSource(
      block.id,
      serializeCodeBlockSource(block.style, block.language, textarea.value)
    );
  };
  activeBlockCancel = () => {
    activeEditingBlockId = null;
    renderActiveDocument();
    renderSidebar();
  };

  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelActiveBlockEdit();
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      insertTextAtSelection(textarea, '  ');
      return;
    }

    if (isSubmitShortcut(event)) {
      event.preventDefault();
      commitActiveBlock();
    }
  });

  textarea.addEventListener('blur', () => {
    syncActiveDocumentFromEditor();
  });

  surface.append(textarea);
  wrapper.append(surface);
  const selectionOffset =
    pendingEditorSelection?.blockId === block.id ? pendingEditorSelection.offset : textarea.value.length;
  pendingEditorSelection = null;
  focusTextEditor(textarea, selectionOffset, autoResizeCodeTextarea);
  return wrapper;
}

function createNewBlockPlaceholder(): HTMLElement {
  if (activeEditingBlockId === NEW_BLOCK_EDITOR_ID) {
    return createMarkdownEditorBlock(
      NEW_BLOCK_EDITOR_ID,
      '',
      '\u5728\u8fd9\u91cc\u8f93\u5165 Markdown\uff0c\u79bb\u5f00\u540e\u4f1a\u6309\u5757\u6e32\u67d3\u3002'
    );
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'viewer-new-block';
  button.textContent = '\u5728\u8fd9\u91cc\u7ee7\u7eed\u8f93\u5165';

  const activate = () => {
    activateBlockEditor(NEW_BLOCK_EDITOR_ID);
  };

  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    activate();
  });

  button.addEventListener('click', (event) => {
    if (event.detail === 0) {
      activate();
    }
  });

  return button;
}

function renderBlocks(blocks: RenderBlock[]): void {
  content.className = 'viewer-content viewer-content-blocks';
  content.replaceChildren();
  clearActiveBlockHandlers();

  for (const block of blocks) {
    if (activeEditingBlockId === block.id) {
      if (block.kind === 'heading' || block.kind === 'paragraph' || block.kind === 'raw') {
        content.append(
          createMarkdownEditorBlock(
            block.id,
            block.source,
            '\u5728\u8fd9\u91cc\u8f93\u5165 Markdown \u5757'
          )
        );
        continue;
      }

      if (block.kind === 'table') {
        content.append(createTableEditorBlock(block));
        continue;
      }

      content.append(createCodeEditorBlock(block));
      continue;
    }

    if (block.kind === 'heading' || block.kind === 'paragraph') {
      content.append(createRenderedTextBlock(block));
      continue;
    }

    if (block.kind === 'raw') {
      content.append(createRenderedRawBlock(block));
      continue;
    }

    if (block.kind === 'table') {
      content.append(createRenderedTableBlock(block));
      continue;
    }

    content.append(createRenderedCodeBlock(block));
  }

  content.append(createNewBlockPlaceholder());
}

function renderActiveDocument(): void {
  renderDocumentHeader();

  const activeDocument = getActiveDocument();

  if (!activeDocument) {
    renderEditorEmptyState();
    return;
  }

  renderBlocks(activeDocument.parsedBlocks);
}

function upsertDocument(document: DocumentState): void {
  const index = documents.findIndex((item) => item.id === document.id);

  if (index >= 0) {
    documents[index] = document;
    return;
  }

  documents = [...documents, document];
}

function applyOpenedDocumentState(document: DocumentState, opened: OpenedDocument): void {
  document.fileName = opened.fileName;
  document.filePath = opened.filePath;
  document.directoryPath = opened.directoryPath;
  document.content = opened.content;
  document.savedContent = opened.content;
  document.isDirty = false;
  document.isUntitled = false;
  refreshDocumentStructure(document);
}

function createDocumentState(document: OpenedDocument): DocumentState {
  const now = Date.now();

  const state: DocumentState = {
    id: nextDocumentId(),
    fileName: document.fileName,
    filePath: document.filePath,
    directoryPath: document.directoryPath,
    content: document.content,
    parsedBlocks: [],
    outline: [],
    savedContent: document.content,
    isDirty: false,
    isUntitled: false,
    lastViewedAt: now,
    listOrder: nextListOrder()
  };

  refreshDocumentStructure(state);
  return state;
}

function handleOpenDocumentFailure(filePath: string): void {
  removeRecentFile(filePath);
  showHeaderNotice(
    '\u65e0\u6cd5\u6253\u5f00\u8be5\u6587\u4ef6\uff0c\u5b83\u5df2\u4ece\u5386\u53f2\u5217\u8868\u4e2d\u79fb\u9664\u3002',
    true
  );
  renderSidebar();
}

async function activateDocument(documentId: string): Promise<void> {
  syncActiveDocumentFromEditor();

  const activeDocument = documents.find((document) => document.id === documentId);

  if (!activeDocument) {
    return;
  }

  activeDocumentId = documentId;
  activeEditingBlockId = null;
  touchDocument(activeDocument);
  renderActiveDocument();
  renderSidebar();
}

async function openDocumentFromPath(filePath: string, reloadExisting = true): Promise<void> {
  syncActiveDocumentFromEditor();

  const existingDocument = documents.find((document) => document.filePath === filePath);

  if (existingDocument) {
    if (reloadExisting && !existingDocument.isDirty) {
      try {
        const opened = await invoke<OpenedDocument>('open_markdown_file', { path: filePath });
        applyOpenedDocumentState(existingDocument, opened);
      } catch {
        handleOpenDocumentFailure(filePath);
        return;
      }
    } else if (reloadExisting && existingDocument.isDirty) {
      showHeaderNotice(
        '\u8be5\u6587\u4ef6\u5728\u5f53\u524d\u4f1a\u8bdd\u4e2d\u6709\u672a\u4fdd\u5b58\u4fee\u6539\uff0c\u5df2\u4fdd\u7559\u4f1a\u8bdd\u7248\u672c\u3002',
        true
      );
    }

    await activateDocument(existingDocument.id);
    return;
  }

  try {
    const document = await invoke<OpenedDocument>('open_markdown_file', { path: filePath });
    const documentState = createDocumentState(document);
    upsertDocument(documentState);
    await activateDocument(documentState.id);
  } catch {
    handleOpenDocumentFailure(filePath);
  }
}

function createUntitledDocument(): void {
  syncActiveDocumentFromEditor();

  const now = Date.now();
  const documentState: DocumentState = {
    id: nextDocumentId(),
    fileName: UNTITLED_FILE_NAME,
    filePath: null,
    directoryPath: null,
    content: '',
    parsedBlocks: [],
    outline: [],
    savedContent: '',
    isDirty: true,
    isUntitled: true,
    lastViewedAt: now,
    listOrder: nextListOrder()
  };

  refreshDocumentStructure(documentState);
  upsertDocument(documentState);
  activeDocumentId = documentState.id;
  activeEditingBlockId = NEW_BLOCK_EDITOR_ID;
  renderActiveDocument();
  renderSidebar();
}

function isPathOpenByOtherDocument(filePath: string, currentDocumentId: string | null): boolean {
  return documents.some(
    (document) => document.filePath === filePath && document.id !== currentDocumentId
  );
}

function ensureMarkdownPath(filePath: string): string {
  const trimmed = filePath.trim();
  const separatorIndex = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  const filePart = trimmed.slice(separatorIndex + 1);
  const dotIndex = filePart.lastIndexOf('.');

  if (dotIndex <= 0 || dotIndex === filePart.length - 1) {
    return `${trimmed}.md`;
  }

  return trimmed;
}

function normalizeMarkdownFileName(rawValue: string): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    return {
      ok: false,
      error: '\u6587\u4ef6\u540d\u4e0d\u80fd\u4e3a\u7a7a\u3002'
    };
  }

  if (/[\\/]/.test(trimmed)) {
    return {
      ok: false,
      error: '\u6587\u4ef6\u540d\u4e0d\u80fd\u5305\u542b\u8def\u5f84\u5206\u9694\u7b26\u3002'
    };
  }

  if (/[<>:"|?*]/.test(trimmed)) {
    return {
      ok: false,
      error: '\u6587\u4ef6\u540d\u5305\u542b Windows \u4e0d\u5141\u8bb8\u7684\u5b57\u7b26\u3002'
    };
  }

  const fileName = (() => {
    const dotIndex = trimmed.lastIndexOf('.');

    if (dotIndex <= 0 || dotIndex === trimmed.length - 1) {
      return `${trimmed}.md`;
    }

    const extension = trimmed.slice(dotIndex + 1).toLowerCase();

    if (extension === 'md' || extension === 'markdown') {
      return trimmed;
    }

    return trimmed;
  })();

  return {
    ok: true,
    value: fileName
  };
}

function closeRenameDialog(result: string | null): void {
  renameOverlay.classList.add('is-hidden');
  const resolver = renameDialogResolver;
  renameDialogResolver = null;
  renameDialogError.textContent = '';

  if (resolver) {
    resolver(result);
  }
}

function showRenameDialog(options: RenameDialogOptions): Promise<string | null> {
  if (renameDialogResolver) {
    closeRenameDialog(null);
  }

  renameDialogTitle.textContent = options.title;
  renameDialogDescription.textContent = options.description;
  renameDialogInput.value = options.defaultValue;
  renameDialogConfirm.textContent = options.confirmText;
  renameDialogError.textContent = '';
  renameOverlay.classList.remove('is-hidden');

  return new Promise((resolve) => {
    renameDialogResolver = resolve;

    window.setTimeout(() => {
      renameDialogInput.focus();
      renameDialogInput.select();
    }, 0);
  });
}

async function saveDocumentToPath(document: DocumentState, filePath: string): Promise<OpenedDocument> {
  return invoke<OpenedDocument>('save_markdown_file', {
    path: filePath,
    content: document.content
  });
}

function applySavedDocumentState(document: DocumentState, saved: OpenedDocument): void {
  const now = Date.now();

  document.fileName = saved.fileName;
  document.filePath = saved.filePath;
  document.directoryPath = saved.directoryPath;
  document.savedContent = document.content;
  document.isDirty = false;
  document.isUntitled = false;
  document.lastViewedAt = now;
  refreshDocumentStructure(document);
  upsertRecentFile(document);
}

function applyRenamedDocumentState(document: DocumentState, renamed: OpenedDocument): void {
  const wasDirty = document.isDirty;
  const previousPath = document.filePath;

  if (previousPath) {
    removeRecentFile(previousPath);
  }

  document.fileName = renamed.fileName;
  document.filePath = renamed.filePath;
  document.directoryPath = renamed.directoryPath;
  document.lastViewedAt = Date.now();

  if (!wasDirty) {
    document.content = renamed.content;
    document.savedContent = renamed.content;
    refreshDocumentStructure(document);
  }

  upsertRecentFile(document);
}

async function pickSavePath(defaultPath: string): Promise<string | null> {
  const selected = await save({
    filters: MARKDOWN_FILTERS,
    defaultPath
  });

  if (!selected) {
    return null;
  }

  return ensureMarkdownPath(selected);
}

async function handleOpenFileRequest(): Promise<void> {
  const selected = await open({
    directory: false,
    multiple: false,
    filters: MARKDOWN_FILTERS
  });

  if (!selected || Array.isArray(selected)) {
    return;
  }

  await openDocumentFromPath(selected);
}

function handleNewFileRequest(): void {
  createUntitledDocument();
}

async function handleSaveRequest(): Promise<void> {
  const activeDocument = getActiveDocument();

  if (!activeDocument) {
    return;
  }

  syncActiveDocumentFromEditor();

  if (!activeDocument.isUntitled && !activeDocument.isDirty) {
    return;
  }

  try {
    if (!activeDocument.filePath) {
      const savePath = await pickSavePath(activeDocument.fileName);

      if (!savePath) {
        return;
      }

      if (isPathOpenByOtherDocument(savePath, activeDocument.id)) {
        showHeaderNotice(
          '\u8be5\u4fdd\u5b58\u8def\u5f84\u5df2\u88ab\u5176\u4ed6\u5df2\u6253\u5f00\u6587\u6863\u4f7f\u7528\u3002',
          true
        );
        return;
      }

      const saved = await saveDocumentToPath(activeDocument, savePath);
      applySavedDocumentState(activeDocument, saved);
      renderActiveDocument();
      renderSidebar();
      return;
    }

    const saved = await saveDocumentToPath(activeDocument, activeDocument.filePath);
    applySavedDocumentState(activeDocument, saved);
    renderDocumentHeader();
    renderSidebar();
  } catch {
    showHeaderNotice('\u4fdd\u5b58\u6587\u4ef6\u5931\u8d25\u3002', true);
  }
}

async function handleSaveAsRequest(): Promise<void> {
  const activeDocument = getActiveDocument();

  if (!activeDocument) {
    return;
  }

  syncActiveDocumentFromEditor();

  const defaultPath = activeDocument.filePath ?? activeDocument.fileName;
  const savePath = await pickSavePath(defaultPath);

  if (!savePath) {
    return;
  }

  if (activeDocument.filePath && savePath === activeDocument.filePath) {
    await handleSaveRequest();
    return;
  }

  if (isPathOpenByOtherDocument(savePath, activeDocument.id)) {
    showHeaderNotice('\u8be5\u6587\u4ef6\u5df2\u5728\u5f53\u524d\u4f1a\u8bdd\u4e2d\u6253\u5f00\u3002', true);
    return;
  }

  try {
    const saved = await saveDocumentToPath(activeDocument, savePath);
    upsertRecentFromDocumentPayload(saved, activeDocument.content, Date.now());
    renderSidebar();
    renderDocumentHeader();
  } catch {
    showHeaderNotice('\u53e6\u5b58\u4e3a\u5931\u8d25\u3002', true);
  }
}

async function handleRenameRequest(): Promise<void> {
  const activeDocument = getActiveDocument();

  if (!activeDocument) {
    return;
  }

  syncActiveDocumentFromEditor();

  const renameResult = await showRenameDialog({
    title: activeDocument.isUntitled
      ? '\u547d\u540d\u65b0\u6587\u6863'
      : '\u91cd\u547d\u540d\u6587\u4ef6',
    description: activeDocument.isUntitled
      ? '\u5148\u8f93\u5165\u6587\u4ef6\u540d\uff0c\u7136\u540e\u9009\u62e9\u4fdd\u5b58\u8def\u5f84\u3002'
      : '\u53ea\u4f1a\u4fee\u6539\u5f53\u524d\u76ee\u5f55\u4e0b\u7684\u6587\u4ef6\u540d\u3002',
    defaultValue: activeDocument.fileName,
    confirmText: activeDocument.isUntitled ? '\u547d\u540d\u5e76\u4fdd\u5b58' : '\u91cd\u547d\u540d'
  });

  if (!renameResult) {
    return;
  }

  if (activeDocument.isUntitled) {
    const savePath = await pickSavePath(renameResult);

    if (!savePath) {
      return;
    }

    if (isPathOpenByOtherDocument(savePath, activeDocument.id)) {
      showHeaderNotice('\u8be5\u6587\u4ef6\u5df2\u5728\u5f53\u524d\u4f1a\u8bdd\u4e2d\u6253\u5f00\u3002', true);
      return;
    }

    try {
      const saved = await saveDocumentToPath(activeDocument, savePath);
      applySavedDocumentState(activeDocument, saved);
      renderActiveDocument();
      renderSidebar();
    } catch {
      showHeaderNotice('\u547d\u540d\u5e76\u4fdd\u5b58\u5931\u8d25\u3002', true);
    }

    return;
  }

  if (!activeDocument.filePath) {
    return;
  }

  try {
    const renamed = await invoke<OpenedDocument>('rename_markdown_file', {
      path: activeDocument.filePath,
      newName: renameResult
    });
    applyRenamedDocumentState(activeDocument, renamed);
    renderDocumentHeader();
    renderSidebar();
  } catch {
    showHeaderNotice('\u91cd\u547d\u540d\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u6587\u4ef6\u540d\u662f\u5426\u5df2\u5b58\u5728\u3002', true);
  }
}

renderActiveDocument();
renderSidebar();

await listen(OPEN_FILE_EVENT, async () => {
  await handleOpenFileRequest();
});

await listen(NEW_FILE_EVENT, async () => {
  handleNewFileRequest();
});

await listen(SAVE_FILE_EVENT, async () => {
  await handleSaveRequest();
});

await listen(SAVE_AS_FILE_EVENT, async () => {
  await handleSaveAsRequest();
});

await listen(RENAME_FILE_EVENT, async () => {
  await handleRenameRequest();
});
