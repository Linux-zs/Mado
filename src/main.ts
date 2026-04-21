import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  commandsCtx,
  defaultValueCtx,
  Editor,
  editorViewCtx,
  prosePluginsCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  serializerCtx
} from '@milkdown/core';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import {
  commonmark,
  createCodeBlockCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand
} from '@milkdown/preset-commonmark';
import {
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  gfm,
  insertTableCommand,
  toggleStrikethroughCommand
} from '@milkdown/preset-gfm';
import { Plugin, PluginKey, TextSelection } from '@milkdown/prose/state';
import {
  deleteColumn,
  deleteRow,
  deleteTable,
  isInTable,
  moveTableColumn,
  moveTableRow,
  selectedRect
} from '@milkdown/prose/tables';
import { history as proseHistory, redo, redoDepth, undo, undoDepth } from '@milkdown/prose/history';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import type { EditorView } from '@milkdown/prose/view';
import { nord } from '@milkdown/theme-nord';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { extendInlineHtmlRemarkHandlers, madoInlineHtmlSupport } from './milkdown-inline-html';
import './style.css';

type OpenedDocument = {
  fileName: string;
  filePath: string;
  directoryPath: string;
  content: string;
};

type DocumentState = {
  id: string;
  fileName: string;
  filePath: string | null;
  directoryPath: string | null;
  content: string;
  savedContent: string;
  sourceSnapshot: MarkdownSourceSnapshot;
  headingStyles: HeadingStyleState[];
  isDirty: boolean;
  isUntitled: boolean;
  lastViewedAt: number;
  listOrder: number;
  editorScrollTop: number;
  editorScrollLeft: number;
  editorSelectionFrom: number;
  editorSelectionTo: number;
  sourceSelectionStart: number;
  sourceSelectionEnd: number;
  sourceScrollTop: number;
};

type RecentFileEntry = {
  filePath: string;
  fileName: string;
  directoryName: string;
  lastOpenedAt: number;
  preview: string;
};

type DirectoryFileEntry = {
  fileName: string;
  filePath: string;
  directoryPath: string;
  relativeDirectory: string;
  modifiedAt: number;
  preview: string;
};

type DirectoryFolderEntry = {
  name: string;
  path: string;
  parentPath: string;
  relativePath: string;
};

type TextFileListResult = {
  files: DirectoryFileEntry[];
  directories: DirectoryFolderEntry[];
  isTruncated: boolean;
};

type RecentMenuEntry = {
  fileName: string;
  filePath: string;
};

type FileTreeNodeKind = 'root' | 'folder' | 'file';

type FileTreeNode = {
  key: string;
  kind: FileTreeNodeKind;
  name: string;
  relativePath: string;
  filePath: string | null;
  documentId: string | null;
  isActive: boolean;
  isDirty: boolean;
  isOpen: boolean;
  isExpanded: boolean;
  children: FileTreeNode[];
};

type FileTreeRow = {
  key: string;
  kind: FileTreeNodeKind;
  name: string;
  relativePath: string;
  filePath: string | null;
  documentId: string | null;
  isActive: boolean;
  isDirty: boolean;
  isOpen: boolean;
  isExpanded: boolean;
  hasChildren: boolean;
  depth: number;
};

type FileTreeRowParts = {
  mainButton: HTMLButtonElement;
  twisty: HTMLSpanElement;
  icon: HTMLSpanElement;
  label: HTMLSpanElement;
  dirtyDot: HTMLSpanElement;
};

type OutlineItem = {
  id: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  pos: number;
  text: string;
};

type TrailingCodeBlockInfo = {
  nodeSize: number;
  pos: number;
  contentSize: number;
};

type MilkdownSession = {
  documentId: string;
  editor: Editor;
  surface: HTMLDivElement;
  host: HTMLDivElement;
  markdownSnapshot: string;
  hasPendingChanges: boolean;
  scrollTop: number;
  scrollLeft: number;
  headingMarkerOverlay: HTMLDivElement | null;
  headingMarkerBadge: HTMLButtonElement | null;
  headingMarkerMenu: HTMLDivElement | null;
  headingMarkerMenuOpen: boolean;
  activeHeadingMarkerState: ActiveHeadingMarkerState | null;
  lastUsedAt: number;
};

type MilkdownSessionCreationResult =
  | {
      kind: 'ready';
      session: MilkdownSession;
    }
  | {
      kind: 'stale';
    }
  | {
      kind: 'failed';
    };

type MarkdownSourceBlock = {
  source: string;
  separator: string;
  semanticKey: string;
  kind: 'heading' | 'other';
  headingStyle: HeadingMarkdownStyle | null;
};

type MarkdownSourceSnapshot = {
  prefix: string;
  blocks: MarkdownSourceBlock[];
};

type HeadingMarkdownStyle = 'atx' | 'setext-h1' | 'setext-h2';

type HeadingStyleState = {
  id: string;
  style: HeadingMarkdownStyle;
};

type InlineFormatPreset =
  | 'plain'
  | 'strong'
  | 'emphasis'
  | 'strong-emphasis'
  | 'strike'
  | 'inline-code';

type ActiveHeadingMarkerState =
  | {
      documentId: string;
      kind: 'heading';
      headingId: string;
      pos: number;
      level: 1 | 2 | 3 | 4 | 5 | 6;
      style: HeadingMarkdownStyle;
      from: number;
      to: number;
      inlinePreset: InlineFormatPreset | null;
    }
  | {
      documentId: string;
      kind: 'inline';
      from: number;
      to: number;
      inlinePreset: InlineFormatPreset | null;
    };

type RenameDialogOptions = {
  title: string;
  description: string;
  defaultValue: string;
  confirmText: string;
  normalizeValue?: (value: string) => Promise<string>;
};
type DeleteConfirmDialogOptions = {
  title: string;
  description: string;
  confirmText: string;
};
type FilesSidebarViewMode = 'list' | 'tree';
type SidebarSearchState = {
  isVisible: boolean;
  query: string;
};
type ContextMenuItem =
  | {
      kind: 'separator';
    }
  | {
      kind: 'item';
      label: string;
      enabled?: boolean;
      checked?: boolean;
      danger?: boolean;
      action?: () => unknown | Promise<unknown>;
      submenu?: ContextMenuItem[];
    };
type SidebarContextTarget =
  | {
      kind: 'file';
      sidebarMode: SidebarMode;
      filePath: string;
      documentId: string | null;
      directoryPath: string;
      fileName: string;
    }
  | {
      kind: 'folder';
      sidebarMode: SidebarMode;
      path: string;
      name: string;
      isRoot: boolean;
    }
  | {
      kind: 'blank';
      directoryPath: string | null;
      sidebarMode: SidebarMode;
    };
type PathEntryPayload = {
  name: string;
  path: string;
  parentPath: string;
  isDirectory: boolean;
};
type RenamedDirectoryPayload = {
  oldPath: string;
  newPath: string;
  name: string;
  parentPath: string;
};
type PathPropertiesPayload = {
  name: string;
  path: string;
  parentPath: string;
  itemKind: string;
  sizeBytes: number | null;
  modifiedAt: number | null;
  extension: string | null;
  isDirectory: boolean;
};
type AppCommandSource = 'native-menu' | 'keyboard' | 'ui';
type EditCommandId = 'undo' | 'redo' | 'find' | 'replace';
type FindReplaceMode = 'find' | 'replace';
type RenderedTextSegment = {
  text: string;
  boundaries: number[];
};
type FindMatch =
  | {
      kind: 'rendered';
      from: number;
      to: number;
    }
  | {
      kind: 'source';
      start: number;
      end: number;
    };
type SourceHistoryState = {
  snapshot: string;
  undoStack: string[];
  redoStack: string[];
};
type HighlightJsLanguageDefinition = unknown;
type HighlightJsModule = {
  default: HighlightJsLanguageDefinition;
};
type HighlightJsApi = {
  getLanguage: (name: string) => unknown;
  registerLanguage: (name: string, language: HighlightJsLanguageDefinition) => void;
  highlight: (
    code: string,
    options: {
      language: string;
      ignoreIllegals: boolean;
    }
  ) => { value: string };
};
type HighlightLanguageLoader = () => Promise<HighlightJsModule>;
type MenuEnabledState = {
  id: string;
  enabled: boolean;
};
type EditorCommandContext = {
  activeDocument: DocumentState | null;
  isRenderedReady: boolean;
  hasSelection: boolean;
  isInHeading: boolean;
  isInTable: boolean;
  canUndo: boolean;
  canRedo: boolean;
};

const APP_COMMAND_EVENT = 'request-app-command';
const EDITOR_COMMAND_MENU_PREFIX = 'editor-command:';
const MENU_EDIT_UNDO_ID = 'edit-undo';
const MENU_EDIT_REDO_ID = 'edit-redo';
const MENU_EDIT_FIND_ID = 'edit-find';
const MENU_EDIT_REPLACE_ID = 'edit-replace';
const OPEN_MARKDOWN_FILTERS = [
  {
    name: 'Text',
    extensions: ['md', 'markdown', 'txt']
  }
];
const SAVE_MARKDOWN_FILTERS = [
  {
    name: 'Markdown / Text',
    extensions: ['md', 'markdown', 'txt']
  }
];
const RECENT_FILES_STORAGE_KEY = 'tias.recent-files.v1';
const CURRENT_DIRECTORY_STORAGE_KEY = 'tias.current-directory.v1';
const FILE_TREE_EXPANSION_STORAGE_KEY = 'tias.file-tree-expansion.v1';
const FILES_SIDEBAR_VIEW_MODE_STORAGE_KEY = 'tias.files-sidebar-view-mode.v1';
const FILES_SIDEBAR_SEARCH_VISIBLE_STORAGE_KEY = 'tias.files-sidebar-search-visible.v1';
const UNTITLED_FILE_NAME = '\u672a\u547d\u540d.md';
const FILES_MODE = 'files';
const OUTLINE_MODE = 'outline';
type SidebarMode = typeof FILES_MODE | typeof OUTLINE_MODE;
const WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY = 'tias.workspace-sidebar-width.v1';
const WORKSPACE_SIDEBAR_DEFAULT_WIDTH = 320;
const WORKSPACE_SIDEBAR_MIN_WIDTH = 220;
const WORKSPACE_SIDEBAR_MAX_WIDTH = 720;
const WORKSPACE_EDITOR_MIN_WIDTH = 420;
const WORKSPACE_RESIZE_HANDLE_WIDTH = 8;
const MILKDOWN_SESSION_CACHE_LIMIT = 3;
const TEXT_FILE_SCAN_DISPLAY_LIMIT = 2000;
const MARKDOWN_SYNC_FIDELITY_BLOCK_LIMIT = 160;
const MARKDOWN_SYNC_FIDELITY_LENGTH_LIMIT = 120_000;
const OUTLINE_SIDEBAR_REFRESH_DELAY_MS = 80;
const HEADING_LEVEL_LABELS = [
  '\u4e00\u7ea7\u6807\u9898',
  '\u4e8c\u7ea7\u6807\u9898',
  '\u4e09\u7ea7\u6807\u9898',
  '\u56db\u7ea7\u6807\u9898',
  '\u4e94\u7ea7\u6807\u9898',
  '\u516d\u7ea7\u6807\u9898'
] as const;
const BLOCK_FORMAT_LABEL = '\u6807\u9898';
const INLINE_FORMAT_LABEL = '\u7279\u6b8a\u6837\u5f0f';
const BODY_LABEL = '\u6b63\u6587';
const INLINE_FORMAT_LABELS: Record<InlineFormatPreset, string> = {
  plain: '\u6b63\u6587',
  strong: '\u7c97\u4f53',
  emphasis: '\u659c\u4f53',
  'strong-emphasis': '\u52a0\u7c97\u659c\u4f53',
  strike: '\u5220\u9664\u7ebf',
  'inline-code': '\u884c\u5185\u4ee3\u7801'
};

const EDITOR_COMMAND_IDS = {
  heading1: 'heading-1',
  heading2: 'heading-2',
  heading3: 'heading-3',
  heading4: 'heading-4',
  heading5: 'heading-5',
  heading6: 'heading-6',
  paragraph: 'paragraph',
  headingPromote: 'heading-promote',
  headingDemote: 'heading-demote',
  blockquote: 'blockquote',
  orderedList: 'ordered-list',
  bulletList: 'bullet-list',
  codeBlock: 'code-block',
  tableInsert: 'table-insert',
  tableRowAbove: 'table-row-above',
  tableRowBelow: 'table-row-below',
  tableColLeft: 'table-col-left',
  tableColRight: 'table-col-right',
  tableRowUp: 'table-row-up',
  tableRowDown: 'table-row-down',
  tableColMoveLeft: 'table-col-move-left',
  tableColMoveRight: 'table-col-move-right',
  tableDeleteRow: 'table-delete-row',
  tableDeleteCol: 'table-delete-col',
  tableDelete: 'table-delete',
  inlineStrong: 'inline-strong',
  inlineEmphasis: 'inline-emphasis',
  inlineStrike: 'inline-strike',
  inlineCode: 'inline-code',
  inlineHighlight: 'inline-highlight',
  inlineSuperscript: 'inline-superscript',
  inlineSubscript: 'inline-subscript',
  inlineKbd: 'inline-kbd'
} as const;

type EditorCommandId = (typeof EDITOR_COMMAND_IDS)[keyof typeof EDITOR_COMMAND_IDS];
type AppCommandPayload =
  | { type: 'newFile' }
  | { type: 'openFile' }
  | { type: 'openFolder' }
  | { type: 'saveFile' }
  | { type: 'saveAsFile' }
  | { type: 'renameFile' }
  | { type: 'closeFile' }
  | { type: 'clearRecentFiles' }
  | { type: 'openRecentFile'; path: string }
  | { type: 'editCommand'; commandId: EditCommandId }
  | { type: 'editorCommand'; commandId: string };
type MilkdownCtxAccessor = {
  get: <T>(slice: unknown) => T;
};
type ShortcutBinding = {
  key?: string;
  code?: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
};
type ShortcutDefinition = ShortcutBinding & {
  commandId: EditorCommandId;
};
type FileShortcutDefinition = ShortcutBinding & {
  command: Exclude<AppCommandPayload, { type: 'openRecentFile' }>;
};
type EditShortcutDefinition = ShortcutBinding & {
  commandId: EditCommandId;
};
type EditorViewMode = 'rendered' | 'source';

type RenderRequest = {
  editor?: boolean;
  sidebar?: boolean;
  filesSidebar?: boolean;
  outlineSidebar?: boolean;
  animateSidebar?: boolean;
  activationToken?: number;
};

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app root');
}

const markdownSemanticProcessor = unified().use(remarkParse).use(remarkGfm);

let documents: DocumentState[] = [];
let activeDocumentId: string | null = null;
let documentSequence = 0;
let documentListOrderSeed = 0;
let recentFiles = loadRecentFiles();
let currentDirectoryPath = loadCurrentDirectoryPath();
let directoryFiles: DirectoryFileEntry[] = [];
let directoryFolders: DirectoryFolderEntry[] = [];
let directoryFilesLoading = false;
let directoryFilesError: string | null = null;
let directoryFilesNotice: string | null = null;
let directoryFilesLoadToken = 0;
let sidebarMode: SidebarMode = FILES_MODE;
let sidebarVisibleMode: SidebarMode = FILES_MODE;
let filesSidebarViewMode = loadFilesSidebarViewMode();
let filesSidebarSearchState: SidebarSearchState = {
  isVisible: loadFilesSidebarSearchVisible(),
  query: ''
};
let isSidebarCollapsed = false;
let sidebarCollapsedBeforeSourceMode = false;
let sidebarScrollPositions = new Map<SidebarMode, { top: number; left: number }>();
let headerNotice: { text: string; isError: boolean } | null = null;
let headerNoticeTimer: number | null = null;
let renameDialogResolver: ((value: string | null) => void) | null = null;
let deleteConfirmResolver: ((value: boolean) => void) | null = null;
let editorViewMode: EditorViewMode = 'rendered';
let milkdownEditor: Editor | null = null;
let milkdownDocumentId: string | null = null;
let milkdownHost: HTMLDivElement | null = null;
let milkdownMarkdownSnapshot: string | null = null;
let milkdownPendingSyncDocumentId: string | null = null;
let milkdownHasPendingChanges = false;
let milkdownActivationToken = 0;
let milkdownSessionPrepareTokens = new Map<string, number>();
let milkdownSessions = new Map<string, MilkdownSession>();
let activeHeadingMarkerState: ActiveHeadingMarkerState | null = null;
let headingMarkerOverlay: HTMLDivElement | null = null;
let headingMarkerBadge: HTMLButtonElement | null = null;
let headingMarkerMenu: HTMLDivElement | null = null;
let headingMarkerMenuOpen = false;
let sidebarWidth = loadWorkspaceSidebarWidth();
let workspaceResizeActive = false;
let workspaceResizePointerId: number | null = null;
let workspaceResizeStartX = 0;
let workspaceResizeStartWidth = sidebarWidth;
let workspaceResizeDragLimits: { min: number; max: number } | null = null;
let workspaceResizePendingWidth: number | null = null;
let workspaceResizePendingFrame: number | null = null;
let recentFilesMenuSyncTimer: number | null = null;
let outlineSidebarRefreshTimer: number | null = null;
let outlineSidebarRefreshDocumentId: string | null = null;
let renderFrame: number | null = null;
let renderEditorPending = false;
let renderSidebarPending = false;
let renderFilesSidebarPending = false;
let renderOutlineSidebarPending = false;
let renderAnimateSidebarPending = false;
let renderActivationToken: number | null = null;
let lastKeyboardCommandInvocation: { key: string; timestamp: number } | null = null;
let findReplaceOpen = false;
let findReplaceMode: FindReplaceMode = 'find';
let findReplaceMatches: FindMatch[] = [];
let findReplaceActiveIndex = -1;
let menuStateSyncTimer: number | null = null;
let sidebarViewTransitionTimer: number | null = null;
let editorSurfaceTransitionTimer: number | null = null;
let editorSurfaceTransitionToken = 0;
let highlightedHeadingElement: HTMLElement | null = null;
let highlightedHeadingClearTimer: number | null = null;
let currentOutlineActivePos: number | null = null;
let sourceHistoryByDocument = new Map<string, SourceHistoryState>();
let renameDialogValidationPending = false;
let renameDialogValidationToken = 0;
let renameDialogNormalizeValue: ((value: string) => Promise<string>) | null = null;
let contextMenuEntries: ContextMenuItem[] = [];
let contextSubmenuEntries: ContextMenuItem[] = [];
let contextMenuAnchorPoint: { x: number; y: number } | null = null;
let contextSubmenuAnchorElement: HTMLElement | null = null;
let contextMenuOpen = false;
let propertiesDialogOpen = false;
let highlightJsApi: HighlightJsApi | null = null;
let highlightJsLoadPromise: Promise<HighlightJsApi> | null = null;
let codeBlockHighlightRefreshFrame: number | null = null;
const pendingHighlightLanguageLoads = new Map<string, Promise<boolean>>();
const registeredHighlightLanguages = new Set<string>();
const codeBlockHighlightViews = new Set<EditorView>();
const codeBlockHighlightMarkupCache = new Map<string, string>();
const fileTreeRowNodeCache = new Map<string, HTMLElement>();
const outlineItemNodeCache = new Map<string, HTMLButtonElement>();
const fileTreeRowParts = new WeakMap<HTMLElement, FileTreeRowParts>();
let fileTreeExpansionState = loadFileTreeExpansionState();

const EDITOR_COMMAND_DEDUP_WINDOW_MS = 60;
const SOURCE_HISTORY_LIMIT = 100;
const NATIVE_MENU_STATE_SYNC_DELAY_MS = 40;
const CODE_BLOCK_HIGHLIGHT_CACHE_LIMIT = 80;
const CODE_BLOCK_HIGHLIGHT_REFRESH_META = 'TIAS_CODE_BLOCK_HIGHLIGHT_REFRESH';
const SIDEBAR_VIEW_TRANSITION_MS = 170;
const EDITOR_SURFACE_TRANSITION_MS = 180;
const HEADING_TARGET_HIGHLIGHT_MS = 900;
const EDITOR_SCROLL_REVEAL_OFFSET = 28;
const reducedMotionMediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const codeBlockHighlightParser = new DOMParser();
const CODE_BLOCK_LANGUAGE_ALIASES: Record<string, string> = {
  shell: 'bash',
  sh: 'bash',
  zsh: 'bash',
  bash: 'bash',
  console: 'bash',
  shellsession: 'bash',
  powershell: 'powershell',
  ps1: 'powershell',
  python: 'python',
  py: 'python',
  sql: 'sql',
  javascript: 'javascript',
  js: 'javascript',
  jsx: 'javascript',
  typescript: 'typescript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  docker: 'dockerfile',
  dockerfile: 'dockerfile',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  markdown: 'markdown',
  md: 'markdown',
  rust: 'rust',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kotlin: 'kotlin',
  kt: 'kotlin',
  swift: 'swift',
  csharp: 'csharp',
  'c#': 'csharp',
  cpp: 'cpp',
  'c++': 'cpp',
  c: 'c',
  php: 'php',
  ruby: 'ruby',
  rb: 'ruby',
  perl: 'perl',
  lua: 'lua',
  nginx: 'nginx',
  diff: 'diff',
  plaintext: 'plaintext',
  text: 'plaintext',
  txt: 'plaintext'
};
const CODE_BLOCK_HIGHLIGHT_LANGUAGE_LOADERS: Record<string, HighlightLanguageLoader> = {
  bash: () => import('highlight.js/lib/languages/bash'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  python: () => import('highlight.js/lib/languages/python'),
  sql: () => import('highlight.js/lib/languages/sql'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  json: () => import('highlight.js/lib/languages/json'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  ini: () => import('highlight.js/lib/languages/ini'),
  xml: () => import('highlight.js/lib/languages/xml'),
  css: () => import('highlight.js/lib/languages/css'),
  scss: () => import('highlight.js/lib/languages/scss'),
  less: () => import('highlight.js/lib/languages/less'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  rust: () => import('highlight.js/lib/languages/rust'),
  go: () => import('highlight.js/lib/languages/go'),
  java: () => import('highlight.js/lib/languages/java'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  swift: () => import('highlight.js/lib/languages/swift'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  php: () => import('highlight.js/lib/languages/php'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  perl: () => import('highlight.js/lib/languages/perl'),
  lua: () => import('highlight.js/lib/languages/lua'),
  nginx: () => import('highlight.js/lib/languages/nginx'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  diff: () => import('highlight.js/lib/languages/diff'),
  plaintext: () => import('highlight.js/lib/languages/plaintext')
};
const INLINE_SELECTION_COMMAND_IDS = new Set<EditorCommandId>([
  EDITOR_COMMAND_IDS.inlineStrong,
  EDITOR_COMMAND_IDS.inlineEmphasis,
  EDITOR_COMMAND_IDS.inlineStrike,
  EDITOR_COMMAND_IDS.inlineCode,
  EDITOR_COMMAND_IDS.inlineHighlight,
  EDITOR_COMMAND_IDS.inlineSuperscript,
  EDITOR_COMMAND_IDS.inlineSubscript,
  EDITOR_COMMAND_IDS.inlineKbd
]);
const TABLE_CONTEXT_COMMAND_IDS = new Set<EditorCommandId>([
  EDITOR_COMMAND_IDS.tableRowAbove,
  EDITOR_COMMAND_IDS.tableRowBelow,
  EDITOR_COMMAND_IDS.tableColLeft,
  EDITOR_COMMAND_IDS.tableColRight,
  EDITOR_COMMAND_IDS.tableRowUp,
  EDITOR_COMMAND_IDS.tableRowDown,
  EDITOR_COMMAND_IDS.tableColMoveLeft,
  EDITOR_COMMAND_IDS.tableColMoveRight,
  EDITOR_COMMAND_IDS.tableDeleteRow,
  EDITOR_COMMAND_IDS.tableDeleteCol,
  EDITOR_COMMAND_IDS.tableDelete
]);

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
  setSidebarMode(FILES_MODE);
});

const outlineTab = document.createElement('button');
outlineTab.type = 'button';
outlineTab.className = 'sidebar-tab';
outlineTab.textContent = '\u5927\u7eb2';
outlineTab.addEventListener('click', () => {
  setSidebarMode(OUTLINE_MODE);
});

sidebarTabs.append(filesTab, outlineTab);

const sidebarBody = document.createElement('section');
sidebarBody.className = 'sidebar-body';

const filesSidebarView = document.createElement('div');
filesSidebarView.className = 'sidebar-view sidebar-view-files is-active';
filesSidebarView.dataset.mode = FILES_MODE;
const filesSidebarSearchBar = document.createElement('div');
filesSidebarSearchBar.className = 'sidebar-search';
const filesSidebarSearchInput = document.createElement('input');
filesSidebarSearchInput.className = 'sidebar-search-input';
filesSidebarSearchInput.type = 'text';
filesSidebarSearchInput.placeholder = '搜索文件';
filesSidebarSearchInput.spellcheck = false;
const filesSidebarSearchClose = document.createElement('button');
filesSidebarSearchClose.type = 'button';
filesSidebarSearchClose.className = 'sidebar-search-close';
filesSidebarSearchClose.textContent = '关闭';
filesSidebarSearchBar.append(filesSidebarSearchInput, filesSidebarSearchClose);
const filesSidebarNotice = document.createElement('p');
filesSidebarNotice.className = 'sidebar-empty';
filesSidebarNotice.hidden = true;
const filesSidebarEmpty = document.createElement('p');
filesSidebarEmpty.className = 'sidebar-empty';
filesSidebarEmpty.hidden = true;
const filesSidebarList = document.createElement('div');
filesSidebarList.className = 'file-list';
filesSidebarView.append(filesSidebarSearchBar, filesSidebarNotice, filesSidebarEmpty, filesSidebarList);

const outlineSidebarView = document.createElement('div');
outlineSidebarView.className = 'sidebar-view sidebar-view-outline is-inactive';
outlineSidebarView.dataset.mode = OUTLINE_MODE;
const outlineSidebarEmpty = document.createElement('p');
outlineSidebarEmpty.className = 'sidebar-empty';
outlineSidebarEmpty.hidden = true;
const outlineSidebarList = document.createElement('div');
outlineSidebarList.className = 'outline-list';
outlineSidebarView.append(outlineSidebarEmpty, outlineSidebarList);

sidebarBody.append(filesSidebarView, outlineSidebarView);
sidebar.append(sidebarTabs, sidebarBody);

const workspaceResizeHandle = document.createElement('div');
workspaceResizeHandle.className = 'workspace-resize-handle';
workspaceResizeHandle.setAttribute('role', 'separator');
workspaceResizeHandle.setAttribute('aria-orientation', 'vertical');
workspaceResizeHandle.setAttribute('aria-label', '\u8c03\u6574\u4fa7\u680f\u5bbd\u5ea6');

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

const editorSurfaceStack = document.createElement('div');
editorSurfaceStack.className = 'editor-surface-stack';

const sourceEditorShell = document.createElement('div');
sourceEditorShell.className = 'source-editor-shell';

const sourceTextarea = document.createElement('textarea');
sourceTextarea.className = 'source-editor';
sourceTextarea.spellcheck = false;
sourceTextarea.setAttribute('aria-label', 'Markdown source editor');
sourceEditorShell.append(sourceTextarea);

const findReplaceBar = document.createElement('section');
findReplaceBar.className = 'find-replace-bar is-hidden';
findReplaceBar.setAttribute('aria-label', 'Find and replace');

const findQueryInput = document.createElement('input');
findQueryInput.className = 'find-replace-input find-replace-query';
findQueryInput.type = 'text';
findQueryInput.spellcheck = false;
findQueryInput.placeholder = '\u67e5\u627e';

const findReplaceInput = document.createElement('input');
findReplaceInput.className = 'find-replace-input find-replace-replace';
findReplaceInput.type = 'text';
findReplaceInput.spellcheck = false;
findReplaceInput.placeholder = '\u66ff\u6362';

const findReplaceCount = document.createElement('span');
findReplaceCount.className = 'find-replace-count';

const findPrevButton = document.createElement('button');
findPrevButton.type = 'button';
findPrevButton.className = 'find-replace-button';
findPrevButton.textContent = '\u4e0a\u4e00\u4e2a';

const findNextButton = document.createElement('button');
findNextButton.type = 'button';
findNextButton.className = 'find-replace-button';
findNextButton.textContent = '\u4e0b\u4e00\u4e2a';

const replaceCurrentButton = document.createElement('button');
replaceCurrentButton.type = 'button';
replaceCurrentButton.className = 'find-replace-button';
replaceCurrentButton.textContent = '\u66ff\u6362';

const replaceAllButton = document.createElement('button');
replaceAllButton.type = 'button';
replaceAllButton.className = 'find-replace-button';
replaceAllButton.textContent = '\u5168\u90e8\u66ff\u6362';

const findCloseButton = document.createElement('button');
findCloseButton.type = 'button';
findCloseButton.className = 'find-replace-button find-replace-close';
findCloseButton.textContent = '\u5173\u95ed';

findReplaceBar.append(
  findQueryInput,
  findReplaceInput,
  findReplaceCount,
  findPrevButton,
  findNextButton,
  replaceCurrentButton,
  replaceAllButton,
  findCloseButton
);

const statusBar = document.createElement('footer');
statusBar.className = 'status-bar';
statusBar.setAttribute('aria-label', 'Status bar');

const statusBarLeft = document.createElement('div');
statusBarLeft.className = 'status-bar-section status-bar-section-left';

const sidebarToggleButton = document.createElement('button');
sidebarToggleButton.type = 'button';
sidebarToggleButton.className = 'status-bar-button';
sidebarToggleButton.setAttribute('aria-label', 'Toggle sidebar');

const sourceModeButton = document.createElement('button');
sourceModeButton.type = 'button';
sourceModeButton.className = 'status-bar-button status-bar-button-source';
sourceModeButton.setAttribute('aria-label', 'Toggle source mode');
sourceModeButton.textContent = '</>';

statusBarLeft.append(sidebarToggleButton, sourceModeButton);

const statusBarRight = document.createElement('div');
statusBarRight.className = 'status-bar-section status-bar-section-right';

const lineCountLabel = document.createElement('span');
lineCountLabel.className = 'status-bar-metric';

const charCountLabel = document.createElement('span');
charCountLabel.className = 'status-bar-metric';

statusBarRight.append(lineCountLabel, charCountLabel);
statusBar.append(statusBarLeft, statusBarRight);

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

const propertiesOverlay = document.createElement('div');
propertiesOverlay.className = 'modal-overlay is-hidden';

const propertiesDialog = document.createElement('section');
propertiesDialog.className = 'modal-card modal-card-properties';
propertiesDialog.setAttribute('role', 'dialog');
propertiesDialog.setAttribute('aria-modal', 'true');

const propertiesDialogTitle = document.createElement('h2');
propertiesDialogTitle.className = 'modal-title';
propertiesDialogTitle.textContent = '属性';

const propertiesDialogDescription = document.createElement('p');
propertiesDialogDescription.className = 'modal-description';

const propertiesDialogBody = document.createElement('dl');
propertiesDialogBody.className = 'properties-list';

const propertiesDialogActions = document.createElement('div');
propertiesDialogActions.className = 'modal-actions';

const propertiesDialogClose = document.createElement('button');
propertiesDialogClose.type = 'button';
propertiesDialogClose.className = 'modal-button is-primary';
propertiesDialogClose.textContent = '关闭';

propertiesDialogActions.append(propertiesDialogClose);
propertiesDialog.append(
  propertiesDialogTitle,
  propertiesDialogDescription,
  propertiesDialogBody,
  propertiesDialogActions
);
propertiesOverlay.append(propertiesDialog);

const deleteConfirmOverlay = document.createElement('div');
deleteConfirmOverlay.className = 'modal-overlay is-hidden';

const deleteConfirmDialog = document.createElement('section');
deleteConfirmDialog.className = 'modal-card';
deleteConfirmDialog.setAttribute('role', 'dialog');
deleteConfirmDialog.setAttribute('aria-modal', 'true');

const deleteConfirmTitle = document.createElement('h2');
deleteConfirmTitle.className = 'modal-title';

const deleteConfirmDescription = document.createElement('p');
deleteConfirmDescription.className = 'modal-description modal-description-pre-wrap';

const deleteConfirmActions = document.createElement('div');
deleteConfirmActions.className = 'modal-actions';

const deleteConfirmCancel = document.createElement('button');
deleteConfirmCancel.type = 'button';
deleteConfirmCancel.className = 'modal-button is-secondary';
deleteConfirmCancel.textContent = '取消';

const deleteConfirmSubmit = document.createElement('button');
deleteConfirmSubmit.type = 'button';
deleteConfirmSubmit.className = 'modal-button is-danger';

deleteConfirmActions.append(deleteConfirmCancel, deleteConfirmSubmit);
deleteConfirmDialog.append(deleteConfirmTitle, deleteConfirmDescription, deleteConfirmActions);
deleteConfirmOverlay.append(deleteConfirmDialog);

const contextMenuLayer = document.createElement('div');
contextMenuLayer.className = 'context-menu-layer is-hidden';

const contextMenuPanel = document.createElement('div');
contextMenuPanel.className = 'context-menu-panel';
contextMenuPanel.setAttribute('role', 'menu');

const contextSubmenuPanel = document.createElement('div');
contextSubmenuPanel.className = 'context-menu-panel context-menu-submenu is-hidden';
contextSubmenuPanel.setAttribute('role', 'menu');

contextMenuLayer.append(contextMenuPanel, contextSubmenuPanel);

header.append(fileName, fileHint);
editorPanel.append(header, findReplaceBar, content, statusBar);
frame.append(sidebar, workspaceResizeHandle, editorPanel);
shell.append(frame, contextMenuLayer, renameOverlay, propertiesOverlay, deleteConfirmOverlay);
app.replaceChildren(shell);

applySidebarWidth(sidebarWidth);
applySidebarCollapsedState();
renderFindReplaceBar();
renderStatusBar();
scheduleNativeMenuStateSync();
window.requestAnimationFrame(() => {
  clampSidebarWidthToWorkspace();
});

renameDialogCancel.addEventListener('click', () => {
  closeRenameDialog(null);
});

renameDialogConfirm.addEventListener('click', () => {
  void submitRenameDialog();
});

propertiesDialogClose.addEventListener('click', () => {
  closePropertiesDialog();
});

propertiesOverlay.addEventListener('click', (event) => {
  if (event.target === propertiesOverlay) {
    closePropertiesDialog();
  }
});

deleteConfirmCancel.addEventListener('click', () => {
  closeDeleteConfirmDialog(false);
});

deleteConfirmSubmit.addEventListener('click', () => {
  closeDeleteConfirmDialog(true);
});

deleteConfirmOverlay.addEventListener('click', (event) => {
  if (event.target === deleteConfirmOverlay) {
    closeDeleteConfirmDialog(false);
  }
});

deleteConfirmDialog.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    closeDeleteConfirmDialog(true);
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    closeDeleteConfirmDialog(false);
  }
});

renameOverlay.addEventListener('click', (event) => {
  if (event.target === renameOverlay) {
    closeRenameDialog(null);
  }
});

renameDialogInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void submitRenameDialog();
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    closeRenameDialog(null);
  }
});

sidebarToggleButton.addEventListener('click', () => {
  if (editorViewMode === 'source') {
    return;
  }

  setSidebarCollapsed(!isSidebarCollapsed);
});

sourceModeButton.addEventListener('click', () => {
  toggleSourceMode();
});

filesSidebarSearchInput.addEventListener('input', () => {
  filesSidebarSearchState.query = filesSidebarSearchInput.value;
  requestFilesSidebarRefresh();
});

filesSidebarSearchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    setFilesSidebarSearchVisible(false);
  }
});

filesSidebarSearchClose.addEventListener('click', () => {
  setFilesSidebarSearchVisible(false);
});

filesSidebarView.addEventListener('contextmenu', handleSidebarContextMenu);
outlineSidebarView.addEventListener('contextmenu', handleSidebarContextMenu);
content.addEventListener('contextmenu', handleEditorContextMenu);

sourceTextarea.addEventListener('input', () => {
  if (editorViewMode !== 'source') {
    return;
  }

  const activeDocument = getActiveDocument();

  if (!activeDocument) {
    renderStatusBar();
    return;
  }

  recordSourceInputHistory(activeDocument, sourceTextarea.value);
  updateDocumentContent(activeDocument, sourceTextarea.value);
  rememberSourceEditorContext(activeDocument);
});

sourceTextarea.addEventListener('select', () => {
  const activeDocument = getActiveDocument();

  if (activeDocument && editorViewMode === 'source') {
    rememberSourceEditorContext(activeDocument);
  }
});

sourceTextarea.addEventListener('scroll', () => {
  const activeDocument = getActiveDocument();

  if (activeDocument && editorViewMode === 'source') {
    rememberSourceEditorContext(activeDocument);
  }
});

findQueryInput.addEventListener('input', () => {
  recomputeFindReplaceMatches();
  renderFindReplaceBar();
});

findQueryInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (event.shiftKey) {
      navigateFindReplaceMatch(-1);
    } else {
      navigateFindReplaceMatch(1);
    }
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    closeFindReplaceBar();
  }
});

findReplaceInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void replaceCurrentFindMatch();
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    closeFindReplaceBar();
  }
});

findPrevButton.addEventListener('click', () => {
  navigateFindReplaceMatch(-1);
});

findNextButton.addEventListener('click', () => {
  navigateFindReplaceMatch(1);
});

replaceCurrentButton.addEventListener('click', () => {
  void replaceCurrentFindMatch();
});

replaceAllButton.addEventListener('click', () => {
  void replaceAllFindMatches();
});

findCloseButton.addEventListener('click', () => {
  closeFindReplaceBar();
});

window.addEventListener('keydown', handleGlobalFileShortcut, true);
window.addEventListener('keydown', handleGlobalEditShortcut, true);
window.addEventListener('keydown', handleGlobalEditorShortcut, true);

workspaceResizeHandle.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return;
  }

  event.preventDefault();
  workspaceResizeActive = true;
  workspaceResizePointerId = event.pointerId;
  workspaceResizeStartX = event.clientX;
  workspaceResizeStartWidth = sidebarWidth;
  workspaceResizeDragLimits = getWorkspaceSidebarWidthLimits();
  workspaceResizePendingWidth = sidebarWidth;
  workspaceResizeHandle.classList.add('is-dragging');
  document.body.classList.add('is-resizing-layout');

  try {
    workspaceResizeHandle.setPointerCapture(event.pointerId);
  } catch {
    // Ignore capture failures and keep drag state best-effort.
  }
});

workspaceResizeHandle.addEventListener('pointermove', (event) => {
  if (!workspaceResizeActive || event.pointerId !== workspaceResizePointerId) {
    return;
  }

  event.preventDefault();
  const nextWidth = workspaceResizeStartWidth + (event.clientX - workspaceResizeStartX);
  workspaceResizePendingWidth = clampSidebarWidthWithinLimits(
    nextWidth,
    workspaceResizeDragLimits ?? getWorkspaceSidebarWidthLimits()
  );
  scheduleWorkspaceResizeApply();
});

workspaceResizeHandle.addEventListener('pointerup', (event) => {
  if (!workspaceResizeActive || event.pointerId !== workspaceResizePointerId) {
    return;
  }

  finishWorkspaceResize();
});

workspaceResizeHandle.addEventListener('pointercancel', (event) => {
  if (!workspaceResizeActive || event.pointerId !== workspaceResizePointerId) {
    return;
  }

  finishWorkspaceResize();
});

workspaceResizeHandle.addEventListener('lostpointercapture', () => {
  if (workspaceResizeActive) {
    finishWorkspaceResize();
  }
});

window.addEventListener('resize', () => {
  clampSidebarWidthToWorkspace();
  closeContextMenu();
});

window.addEventListener(
  'scroll',
  () => {
    if (contextMenuOpen) {
      closeContextMenu();
    }
  },
  true
);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (contextMenuOpen) {
      closeContextMenu();
      event.stopPropagation();
      return;
    }

    if (propertiesDialogOpen) {
      closePropertiesDialog();
      event.stopPropagation();
    }
  }
});

window.addEventListener(
  'pointerdown',
  (event) => {
    if (contextMenuOpen && !isContextMenuEventTarget(event.target)) {
      closeContextMenu();
    }
  },
  true
);

window.addEventListener('pointerdown', handleHeadingMarkerWindowPointerDown, true);

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

function getCurrentEditorText(): string | null {
  const activeDocument = getActiveDocument();

  if (!activeDocument) {
    return null;
  }

  if (editorViewMode === 'source') {
    return sourceTextarea.value;
  }

  return activeDocument.content;
}

function countEditorLines(text: string | null): number {
  if (text === null) {
    return 0;
  }

  const normalized = text.replace(/\r/g, '');
  return normalized.length === 0 ? 1 : normalized.split('\n').length;
}

function countEditorCharacters(text: string | null): number {
  if (text === null) {
    return 0;
  }

  return text.replace(/\r/g, '').length;
}

function restoreSourceEditorContext(document: DocumentState): void {
  sourceTextarea.selectionStart = Math.min(document.sourceSelectionStart, sourceTextarea.value.length);
  sourceTextarea.selectionEnd = Math.min(document.sourceSelectionEnd, sourceTextarea.value.length);
  sourceTextarea.scrollTop = document.sourceScrollTop;
}

function rememberMilkdownSelection(
  document: DocumentState,
  selection: EditorView['state']['selection']
): void {
  document.editorSelectionFrom = selection.from;
  document.editorSelectionTo = selection.to;
}

function clampEditorSelectionPosition(docSize: number, position: number): number {
  return Math.max(0, Math.min(position, docSize));
}

function restoreMilkdownSelection(view: EditorView, document: DocumentState): void {
  const docSize = view.state.doc.content.size;
  const from = clampEditorSelectionPosition(docSize, document.editorSelectionFrom);
  const to = clampEditorSelectionPosition(docSize, document.editorSelectionTo);

  let nextSelection: EditorView['state']['selection'];

  try {
    nextSelection =
      from === to
        ? TextSelection.near(view.state.doc.resolve(from))
        : TextSelection.create(view.state.doc, from, to);
  } catch {
    nextSelection = TextSelection.near(view.state.doc.resolve(clampEditorSelectionPosition(docSize, to)));
  }

  if (!nextSelection.eq(view.state.selection)) {
    view.dispatch(view.state.tr.setSelection(nextSelection));
  }
}

function getSourceHistoryForDocument(document: DocumentState | null): SourceHistoryState | null {
  if (!document) {
    return null;
  }

  return getSourceHistoryState(document.id, document.content);
}

function readCurrentEditorCommandContext(): EditorCommandContext {
  const activeDocument = getActiveDocument();

  if (!activeDocument) {
    return {
      activeDocument: null,
      isRenderedReady: false,
      hasSelection: false,
      isInHeading: false,
      isInTable: false,
      canUndo: false,
      canRedo: false
    };
  }

  if (editorViewMode !== 'rendered') {
    const sourceHistoryState = getSourceHistoryForDocument(activeDocument);

    return {
      activeDocument,
      isRenderedReady: false,
      hasSelection: false,
      isInHeading: false,
      isInTable: false,
      canUndo: Boolean(sourceHistoryState && sourceHistoryState.undoStack.length > 0),
      canRedo: Boolean(sourceHistoryState && sourceHistoryState.redoStack.length > 0)
    };
  }

  const session = getActiveMilkdownSession();

  if (!session || milkdownDocumentId !== activeDocument.id) {
    return {
      activeDocument,
      isRenderedReady: false,
      hasSelection: false,
      isInHeading: false,
      isInTable: false,
      canUndo: false,
      canRedo: false
    };
  }

  try {
    return session.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { selection } = view.state;

      rememberMilkdownSelection(activeDocument, selection);

      return {
        activeDocument,
        isRenderedReady: true,
        hasSelection: !selection.empty,
        isInHeading: selection.$from.parent.type.name === 'heading',
        isInTable: isInTable(view.state),
        canUndo: undoDepth(view.state) > 0,
        canRedo: redoDepth(view.state) > 0
      };
    });
  } catch {
    return {
      activeDocument,
      isRenderedReady: false,
      hasSelection: false,
      isInHeading: false,
      isInTable: false,
      canUndo: false,
      canRedo: false
    };
  }
}

function isEditorCommandCurrentlyEnabled(
  commandId: EditorCommandId,
  context: EditorCommandContext = readCurrentEditorCommandContext()
): boolean {
  if (!context.activeDocument || !context.isRenderedReady) {
    return false;
  }

  if (INLINE_SELECTION_COMMAND_IDS.has(commandId)) {
    return context.hasSelection;
  }

  if (
    commandId === EDITOR_COMMAND_IDS.headingPromote ||
    commandId === EDITOR_COMMAND_IDS.headingDemote
  ) {
    return context.isInHeading;
  }

  if (TABLE_CONTEXT_COMMAND_IDS.has(commandId)) {
    return context.isInTable;
  }

  return true;
}

function getNativeMenuEnabledStates(): MenuEnabledState[] {
  const context = readCurrentEditorCommandContext();
  const hasActiveDocument = Boolean(context.activeDocument);

  const states: MenuEnabledState[] = [
    { id: MENU_EDIT_UNDO_ID, enabled: context.canUndo },
    { id: MENU_EDIT_REDO_ID, enabled: context.canRedo },
    { id: MENU_EDIT_FIND_ID, enabled: hasActiveDocument },
    { id: MENU_EDIT_REPLACE_ID, enabled: hasActiveDocument }
  ];

  for (const commandId of Object.values(EDITOR_COMMAND_IDS)) {
    states.push({
      id: `${EDITOR_COMMAND_MENU_PREFIX}${commandId}`,
      enabled: isEditorCommandCurrentlyEnabled(commandId, context)
    });
  }

  return states;
}

function scheduleNativeMenuStateSync(): void {
  if (menuStateSyncTimer !== null) {
    window.clearTimeout(menuStateSyncTimer);
  }

  menuStateSyncTimer = window.setTimeout(() => {
    menuStateSyncTimer = null;
    const states = getNativeMenuEnabledStates();

    void invoke('update_menu_enabled_states', { states }).catch(() => {
      // The app can keep working even if native menu state sync fails.
    });
  }, NATIVE_MENU_STATE_SYNC_DELAY_MS);
}

function getSourceHistoryState(documentId: string, initialContent: string): SourceHistoryState {
  let state = sourceHistoryByDocument.get(documentId);

  if (!state) {
    state = {
      snapshot: initialContent,
      undoStack: [],
      redoStack: []
    };
    sourceHistoryByDocument.set(documentId, state);
  }

  return state;
}

function setSourceHistorySnapshot(
  documentId: string,
  content: string,
  options: { resetStacks?: boolean } = {}
): void {
  const state = getSourceHistoryState(documentId, content);
  state.snapshot = content;

  if (options.resetStacks) {
    state.undoStack = [];
    state.redoStack = [];
  }
}

function pushSourceUndoSnapshot(state: SourceHistoryState, content: string): void {
  state.undoStack.push(content);

  if (state.undoStack.length > SOURCE_HISTORY_LIMIT) {
    state.undoStack.shift();
  }
}

function pushSourceRedoSnapshot(state: SourceHistoryState, content: string): void {
  state.redoStack.push(content);

  if (state.redoStack.length > SOURCE_HISTORY_LIMIT) {
    state.redoStack.shift();
  }
}

function rememberSourceEditorContext(document: DocumentState): void {
  document.sourceSelectionStart = sourceTextarea.selectionStart;
  document.sourceSelectionEnd = sourceTextarea.selectionEnd;
  document.sourceScrollTop = sourceTextarea.scrollTop;
}

function applySourceDocumentChange(
  nextContent: string,
  options: {
    recordUndo?: boolean;
    selectionStart?: number;
    selectionEnd?: number;
    scrollTop?: number;
  } = {}
): boolean {
  const activeDocument = getActiveDocument();

  if (!activeDocument || editorViewMode !== 'source') {
    return false;
  }

  const state = getSourceHistoryState(activeDocument.id, activeDocument.content);
  const previousSelectionStart = sourceTextarea.selectionStart;
  const previousSelectionEnd = sourceTextarea.selectionEnd;
  const previousScrollTop = sourceTextarea.scrollTop;

  if (options.recordUndo && state.snapshot !== nextContent) {
    pushSourceUndoSnapshot(state, state.snapshot);
    state.redoStack = [];
  }

  sourceTextarea.value = nextContent;
  state.snapshot = nextContent;
  sourceTextarea.selectionStart = Math.min(
    options.selectionStart ?? previousSelectionStart,
    sourceTextarea.value.length
  );
  sourceTextarea.selectionEnd = Math.min(
    options.selectionEnd ?? previousSelectionEnd,
    sourceTextarea.value.length
  );
  sourceTextarea.scrollTop = options.scrollTop ?? previousScrollTop;
  syncSourceEditorDocumentState(activeDocument);
  rememberSourceEditorContext(activeDocument);
  renderDocumentHeader();
  sourceTextarea.focus();
  return true;
}

function recordSourceInputHistory(document: DocumentState, nextContent: string): void {
  const state = getSourceHistoryState(document.id, document.content);

  if (state.snapshot === nextContent) {
    return;
  }

  pushSourceUndoSnapshot(state, state.snapshot);
  state.redoStack = [];
  state.snapshot = nextContent;
}

function renderStatusBar(): void {
  const activeDocument = getActiveDocument();
  const currentText = getCurrentEditorText();
  const isSourceMode = editorViewMode === 'source';

  sidebarToggleButton.textContent = isSidebarCollapsed ? '\u203a' : '\u2039';
  sidebarToggleButton.title = isSidebarCollapsed ? '\u5c55\u5f00\u4fa7\u680f' : '\u6536\u8d77\u4fa7\u680f';
  sidebarToggleButton.disabled = isSourceMode;
  sidebarToggleButton.classList.toggle('is-active', !isSidebarCollapsed && !isSourceMode);
  sidebarToggleButton.classList.toggle('is-collapsed', isSidebarCollapsed);

  sourceModeButton.title = isSourceMode ? '\u8fd4\u56de\u6e32\u67d3\u89c6\u56fe' : '\u663e\u793a\u6e90\u7801';
  sourceModeButton.disabled = !activeDocument;
  sourceModeButton.classList.toggle('is-active', isSourceMode);

  lineCountLabel.textContent = `${countEditorLines(currentText)} \u884c`;
  charCountLabel.textContent = `${countEditorCharacters(currentText)} \u5b57\u7b26`;
}

function applySidebarCollapsedState(): void {
  frame.classList.toggle('is-sidebar-collapsed', isSidebarCollapsed);
  sidebar.setAttribute('aria-hidden', String(isSidebarCollapsed));
  sidebar.inert = isSidebarCollapsed;
  workspaceResizeHandle.setAttribute('aria-hidden', String(isSidebarCollapsed));
  workspaceResizeHandle.inert = isSidebarCollapsed;
  renderStatusBar();
}

function setSidebarCollapsed(collapsed: boolean): void {
  if (isSidebarCollapsed === collapsed) {
    applySidebarCollapsedState();
    return;
  }

  isSidebarCollapsed = collapsed;
  applySidebarCollapsedState();
}

function syncSourceEditorDocumentState(document: DocumentState): void {
  const nextContent = sourceTextarea.value;

  rememberSourceEditorContext(document);
  updateDocumentContent(document, nextContent);
  document.sourceSnapshot = createMarkdownSourceSnapshot(nextContent);
  document.headingStyles = [];
}

function setEditorViewMode(nextMode: EditorViewMode): void {
  if (editorViewMode === nextMode) {
    renderStatusBar();
    return;
  }

  const activeDocument = getActiveDocument();

  if (nextMode === 'source') {
    syncActiveDocumentFromEditor();
    sidebarCollapsedBeforeSourceMode = isSidebarCollapsed;
    setSidebarCollapsed(true);

    if (activeDocument) {
      sourceTextarea.value = activeDocument.content;
      setSourceHistorySnapshot(activeDocument.id, activeDocument.content, { resetStacks: false });
      restoreSourceEditorContext(activeDocument);
    } else {
      sourceTextarea.value = '';
    }
  } else {
    if (editorViewMode === 'source' && activeDocument) {
      syncSourceEditorDocumentState(activeDocument);
    }

    setSidebarCollapsed(sidebarCollapsedBeforeSourceMode);
  }

  editorViewMode = nextMode;
  requestRender({ editor: true });
  requestSidebarRefreshForCurrentMode();
  if (findReplaceOpen) {
    recomputeFindReplaceMatches();
    renderFindReplaceBar();
  }
  renderStatusBar();
}

function toggleSourceMode(): void {
  if (!getActiveDocument()) {
    return;
  }

  setEditorViewMode(editorViewMode === 'source' ? 'rendered' : 'source');
}

function waitForNativeMenuToClose(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function focusActiveCommandContext(): void {
  const activeDocument = getActiveDocument();

  if (editorViewMode === 'source') {
    if (activeDocument) {
      restoreSourceEditorContext(activeDocument);
    }

    sourceTextarea.focus();
    return;
  }

  const session = getActiveMilkdownSession();

  if (session && activeDocument && milkdownDocumentId === activeDocument.id) {
    try {
      session.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        restoreMilkdownSelection(view, activeDocument);
        view.focus();
      });
    } catch {
      focusMilkdownSession(session);
    }
  }
}

function getSelectedSearchText(): string {
  if (editorViewMode === 'source') {
    const { selectionStart, selectionEnd, value } = sourceTextarea;
    return selectionEnd > selectionStart ? value.slice(selectionStart, selectionEnd) : '';
  }

  const session = getActiveMilkdownSession();

  if (!session || !milkdownEditor) {
    return '';
  }

  try {
    return milkdownEditor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { selection } = view.state;

      if (selection.empty) {
        return '';
      }

      return view.state.doc.textBetween(selection.from, selection.to, '\n', '\n');
    });
  } catch {
    return '';
  }
}

function buildRenderedTextSegments(view: EditorView): RenderedTextSegment[] {
  const segments: RenderedTextSegment[] = [];

  view.state.doc.descendants((node, position) => {
    if (!node.isTextblock) {
      return true;
    }

    const boundaries = [position + 1];
    let text = '';

    node.forEach((child, offset) => {
      const childPos = position + 1 + offset;

      if (child.isText && child.text) {
        text += child.text;

        for (let index = 0; index < child.text.length; index += 1) {
          boundaries.push(childPos + index + 1);
        }

        return;
      }

      if (child.type.name === 'hardbreak') {
        text += '\n';
        boundaries.push(childPos + 1);
      }
    });

    if (text.length > 0) {
      segments.push({ text, boundaries });
    }

    return true;
  });

  return segments;
}

function findAllTextMatches(text: string, query: string): Array<{ start: number; end: number }> {
  if (query.length === 0) {
    return [];
  }

  const matches: Array<{ start: number; end: number }> = [];
  let searchFrom = 0;

  while (searchFrom <= text.length) {
    const index = text.indexOf(query, searchFrom);

    if (index < 0) {
      break;
    }

    matches.push({
      start: index,
      end: index + query.length
    });
    searchFrom = index + Math.max(1, query.length);
  }

  return matches;
}

function getRenderedFindMatches(query: string): FindMatch[] {
  const session = getActiveMilkdownSession();

  if (!session || !milkdownEditor || !getActiveDocument()) {
    return [];
  }

  try {
    return milkdownEditor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const segments = buildRenderedTextSegments(view);
      const matches: FindMatch[] = [];

      for (const segment of segments) {
        for (const match of findAllTextMatches(segment.text, query)) {
          matches.push({
            kind: 'rendered',
            from: segment.boundaries[match.start] ?? 0,
            to: segment.boundaries[match.end] ?? 0
          });
        }
      }

      return matches.filter((match) => match.kind !== 'rendered' || match.to > match.from);
    });
  } catch {
    return [];
  }
}

function getSourceFindMatches(query: string): FindMatch[] {
  return findAllTextMatches(sourceTextarea.value, query).map((match) => ({
    kind: 'source',
    start: match.start,
    end: match.end
  }));
}

function getActiveFindMatch(): FindMatch | null {
  return findReplaceMatches[findReplaceActiveIndex] ?? null;
}

function revealFindMatch(match: FindMatch, focusEditor = false): void {
  if (match.kind === 'source') {
    sourceTextarea.setSelectionRange(match.start, match.end);

    if (focusEditor) {
      sourceTextarea.focus();
    }

    return;
  }

  const session = getActiveMilkdownSession();

  if (!session || !milkdownEditor) {
    return;
  }

  try {
    milkdownEditor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const selection = TextSelection.create(view.state.doc, match.from, match.to);
      const tr = view.state.tr.setSelection(selection).scrollIntoView();

      view.dispatch(tr);

      if (focusEditor) {
        view.focus();
      }
    });
  } catch {
    // Ignore failed reveal attempts during document/view transitions.
  }
}

function recomputeFindReplaceMatches(): void {
  if (!findReplaceOpen) {
    findReplaceMatches = [];
    findReplaceActiveIndex = -1;
    return;
  }

  const query = findQueryInput.value;

  if (!query) {
    findReplaceMatches = [];
    findReplaceActiveIndex = -1;
    return;
  }

  findReplaceMatches = editorViewMode === 'source' ? getSourceFindMatches(query) : getRenderedFindMatches(query);
  findReplaceActiveIndex = findReplaceMatches.length > 0 ? 0 : -1;
}

function renderFindReplaceBar(): void {
  const showReplace = findReplaceMode === 'replace';
  const activeCount = findReplaceActiveIndex >= 0 ? findReplaceActiveIndex + 1 : 0;
  const totalCount = findReplaceMatches.length;
  const hasMatches = totalCount > 0;
  const hasQuery = findQueryInput.value.length > 0;

  findReplaceBar.classList.toggle('is-hidden', !findReplaceOpen);
  findReplaceInput.hidden = !showReplace;
  replaceCurrentButton.hidden = !showReplace;
  replaceAllButton.hidden = !showReplace;
  findReplaceCount.textContent = `${activeCount} / ${totalCount}`;
  findPrevButton.disabled = !hasMatches;
  findNextButton.disabled = !hasMatches;
  replaceCurrentButton.disabled = !showReplace || !hasMatches;
  replaceAllButton.disabled = !showReplace || !hasQuery;
}

function openFindReplaceBar(mode: FindReplaceMode): void {
  syncActiveDocumentFromEditor();

  if (!getActiveDocument()) {
    return;
  }

  findReplaceOpen = true;
  findReplaceMode = mode;

  if (!findQueryInput.value) {
    const selectionText = getSelectedSearchText().trim();

    if (selectionText) {
      findQueryInput.value = selectionText;
    }
  }

  recomputeFindReplaceMatches();
  renderFindReplaceBar();
  findQueryInput.focus();
  findQueryInput.select();
}

function closeFindReplaceBar(): void {
  findReplaceOpen = false;
  findReplaceMatches = [];
  findReplaceActiveIndex = -1;
  renderFindReplaceBar();
}

function navigateFindReplaceMatch(direction: -1 | 1): void {
  recomputeFindReplaceMatches();

  if (findReplaceMatches.length === 0) {
    renderFindReplaceBar();
    return;
  }

  if (findReplaceActiveIndex < 0) {
    findReplaceActiveIndex = direction > 0 ? 0 : findReplaceMatches.length - 1;
  } else {
    findReplaceActiveIndex =
      (findReplaceActiveIndex + direction + findReplaceMatches.length) % findReplaceMatches.length;
  }

  revealFindMatch(findReplaceMatches[findReplaceActiveIndex]!, true);
  renderFindReplaceBar();
}

function replaceCurrentSourceMatch(match: Extract<FindMatch, { kind: 'source' }>, replacement: string): void {
  const nextContent =
    sourceTextarea.value.slice(0, match.start) +
    replacement +
    sourceTextarea.value.slice(match.end);
  applySourceDocumentChange(nextContent, { recordUndo: true });
}

function replaceCurrentRenderedMatch(match: Extract<FindMatch, { kind: 'rendered' }>, replacement: string): boolean {
  return executeEditorCommandWithActiveSession((_ctx, view) => {
    const tr = view.state.tr.insertText(replacement, match.from, match.to).scrollIntoView();

    if (!tr.docChanged) {
      return false;
    }

    view.dispatch(tr);
    return true;
  });
}

async function replaceCurrentFindMatch(): Promise<void> {
  const activeMatch = getActiveFindMatch();

  if (!activeMatch) {
    return;
  }

  const replacement = findReplaceInput.value;

  if (activeMatch.kind === 'source') {
    replaceCurrentSourceMatch(activeMatch, replacement);
  } else if (!replaceCurrentRenderedMatch(activeMatch, replacement)) {
    return;
  }

  recomputeFindReplaceMatches();
  renderFindReplaceBar();

  if (findReplaceMatches.length > 0) {
    findReplaceActiveIndex = Math.min(findReplaceActiveIndex, findReplaceMatches.length - 1);
    revealFindMatch(findReplaceMatches[findReplaceActiveIndex]!, true);
  }
}

function replaceAllSourceMatches(query: string, replacement: string): void {
  const nextContent = sourceTextarea.value.split(query).join(replacement);
  applySourceDocumentChange(nextContent, { recordUndo: true });
}

function replaceAllRenderedMatches(matches: Extract<FindMatch, { kind: 'rendered' }>[], replacement: string): boolean {
  return executeEditorCommandWithActiveSession((_ctx, view) => {
    const sortedMatches = [...matches].sort((left, right) => right.from - left.from);
    const tr = view.state.tr;

    for (const match of sortedMatches) {
      tr.insertText(replacement, match.from, match.to);
    }

    if (!tr.docChanged) {
      return false;
    }

    tr.scrollIntoView();
    view.dispatch(tr);
    return true;
  });
}

async function replaceAllFindMatches(): Promise<void> {
  const query = findQueryInput.value;

  if (!query) {
    return;
  }

  const replacement = findReplaceInput.value;
  recomputeFindReplaceMatches();

  if (findReplaceMatches.length === 0) {
    renderFindReplaceBar();
    return;
  }

  if (editorViewMode === 'source') {
    replaceAllSourceMatches(query, replacement);
  } else {
    const renderedMatches = findReplaceMatches.filter(
      (match): match is Extract<FindMatch, { kind: 'rendered' }> => match.kind === 'rendered'
    );

    if (!replaceAllRenderedMatches(renderedMatches, replacement)) {
      return;
    }
  }

  recomputeFindReplaceMatches();
  renderFindReplaceBar();
}

function applySidebarWidth(nextWidth: number): void {
  sidebarWidth = Math.round(nextWidth);
  frame.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
}

function clampSidebarWidthWithinLimits(
  nextWidth: number,
  limits: { min: number; max: number }
): number {
  return Math.min(Math.max(nextWidth, limits.min), limits.max);
}

function loadWorkspaceSidebarWidth(): number {
  try {
    const stored = window.localStorage.getItem(WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY);

    if (!stored) {
      return WORKSPACE_SIDEBAR_DEFAULT_WIDTH;
    }

    const parsed = Number(stored);

    if (!Number.isFinite(parsed)) {
      return WORKSPACE_SIDEBAR_DEFAULT_WIDTH;
    }

    return parsed;
  } catch {
    return WORKSPACE_SIDEBAR_DEFAULT_WIDTH;
  }
}

function persistWorkspaceSidebarWidth(): void {
  try {
    window.localStorage.setItem(WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  } catch {
    // Keep the in-memory width even if persistence fails.
  }
}

function getWorkspaceSidebarWidthLimits(): { min: number; max: number } {
  const workspaceWidth = frame.getBoundingClientRect().width;
  const min = WORKSPACE_SIDEBAR_MIN_WIDTH;

  if (workspaceWidth <= 0) {
    return {
      min,
      max: WORKSPACE_SIDEBAR_DEFAULT_WIDTH
    };
  }

  const available = Math.max(min, workspaceWidth - WORKSPACE_RESIZE_HANDLE_WIDTH - WORKSPACE_EDITOR_MIN_WIDTH);
  const max = Math.min(WORKSPACE_SIDEBAR_MAX_WIDTH, available);

  return {
    min,
    max: Math.max(min, max)
  };
}

function clampSidebarWidth(nextWidth: number): number {
  return clampSidebarWidthWithinLimits(nextWidth, getWorkspaceSidebarWidthLimits());
}

function scheduleWorkspaceResizeApply(): void {
  if (!workspaceResizeActive || workspaceResizePendingWidth === null) {
    return;
  }

  if (workspaceResizePendingFrame !== null) {
    return;
  }

  workspaceResizePendingFrame = window.requestAnimationFrame(() => {
    workspaceResizePendingFrame = null;

    if (!workspaceResizeActive || workspaceResizePendingWidth === null) {
      return;
    }

    applySidebarWidth(workspaceResizePendingWidth);
  });
}

function flushWorkspaceResizeApply(): void {
  if (workspaceResizePendingFrame !== null) {
    window.cancelAnimationFrame(workspaceResizePendingFrame);
    workspaceResizePendingFrame = null;
  }

  if (workspaceResizePendingWidth === null) {
    return;
  }

  applySidebarWidth(workspaceResizePendingWidth);
}

function clampSidebarWidthToWorkspace(): void {
  const nextWidth = clampSidebarWidth(sidebarWidth);

  if (nextWidth !== sidebarWidth) {
    applySidebarWidth(nextWidth);
    return;
  }

  frame.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
}

function finishWorkspaceResize(): void {
  if (!workspaceResizeActive) {
    return;
  }

  const pointerId = workspaceResizePointerId;
  workspaceResizeActive = false;
  workspaceResizePointerId = null;
  flushWorkspaceResizeApply();
  workspaceResizeDragLimits = null;
  workspaceResizePendingWidth = null;
  workspaceResizeHandle.classList.remove('is-dragging');
  document.body.classList.remove('is-resizing-layout');

  if (pointerId !== null && workspaceResizeHandle.hasPointerCapture(pointerId)) {
    try {
      workspaceResizeHandle.releasePointerCapture(pointerId);
    } catch {
      // Ignore release failures during teardown.
    }
  }

  clampSidebarWidthToWorkspace();
  persistWorkspaceSidebarWidth();
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

  scheduleRecentFilesMenuSync();
}

function loadCurrentDirectoryPath(): string | null {
  try {
    const stored = window.localStorage.getItem(CURRENT_DIRECTORY_STORAGE_KEY);
    return stored && stored.trim().length > 0 ? stored : null;
  } catch {
    return null;
  }
}

function loadFilesSidebarViewMode(): FilesSidebarViewMode {
  try {
    const stored = window.localStorage.getItem(FILES_SIDEBAR_VIEW_MODE_STORAGE_KEY);
    return stored === 'list' ? 'list' : 'tree';
  } catch {
    return 'tree';
  }
}

function persistFilesSidebarViewMode(): void {
  try {
    window.localStorage.setItem(FILES_SIDEBAR_VIEW_MODE_STORAGE_KEY, filesSidebarViewMode);
  } catch {
    // Keep the in-memory preference even if persistence fails.
  }
}

function loadFilesSidebarSearchVisible(): boolean {
  try {
    return window.localStorage.getItem(FILES_SIDEBAR_SEARCH_VISIBLE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistFilesSidebarSearchVisible(): void {
  try {
    window.localStorage.setItem(
      FILES_SIDEBAR_SEARCH_VISIBLE_STORAGE_KEY,
      String(filesSidebarSearchState.isVisible)
    );
  } catch {
    // Keep the in-memory preference even if persistence fails.
  }
}

function loadFileTreeExpansionState(): Record<string, boolean> {
  try {
    const stored = window.localStorage.getItem(FILE_TREE_EXPANSION_STORAGE_KEY);

    if (!stored) {
      return {};
    }

    const parsed = JSON.parse(stored);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
    );
  } catch {
    return {};
  }
}

function persistCurrentDirectoryPath(): void {
  try {
    if (currentDirectoryPath) {
      window.localStorage.setItem(CURRENT_DIRECTORY_STORAGE_KEY, currentDirectoryPath);
    } else {
      window.localStorage.removeItem(CURRENT_DIRECTORY_STORAGE_KEY);
    }
  } catch {
    // Keep the in-memory directory even if persistence fails.
  }
}

function persistFileTreeExpansionState(): void {
  try {
    window.localStorage.setItem(FILE_TREE_EXPANSION_STORAGE_KEY, JSON.stringify(fileTreeExpansionState));
  } catch {
    // Keep the in-memory expansion state even if persistence fails.
  }
}

function normalizeTreeRelativePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function createFileTreeExpansionKey(rootPath: string | null, relativePath: string): string {
  return `${rootPath ?? '__virtual-root__'}::${normalizeTreeRelativePath(relativePath)}`;
}

function getStoredFileTreeExpansion(rootPath: string | null, relativePath: string): boolean | undefined {
  return fileTreeExpansionState[createFileTreeExpansionKey(rootPath, relativePath)];
}

function setStoredFileTreeExpansion(rootPath: string | null, relativePath: string, expanded: boolean): void {
  fileTreeExpansionState[createFileTreeExpansionKey(rootPath, relativePath)] = expanded;
  persistFileTreeExpansionState();
}

function syncRecentFilesMenu(): Promise<void> {
  const entries: RecentMenuEntry[] = recentFiles.slice(0, 10).map((entry) => ({
    fileName: entry.fileName,
    filePath: entry.filePath
  }));

  return invoke<void>('update_recent_files_menu', { entries }).catch(() => {
    // The sidebar remains usable even if the native menu cannot be rebuilt.
  });
}

function scheduleRecentFilesMenuSync(): void {
  if (recentFilesMenuSyncTimer !== null) {
    window.clearTimeout(recentFilesMenuSyncTimer);
  }

  recentFilesMenuSyncTimer = window.setTimeout(() => {
    recentFilesMenuSyncTimer = null;
    void syncRecentFilesMenu();
  }, 180);
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

function getParentPathFromFilePath(filePath: string): string | null {
  const trimmed = filePath.replace(/[\\/]+$/, '');
  const separatorIndex = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  return separatorIndex > 0 ? trimmed.slice(0, separatorIndex) : null;
}

function isPathInsideDirectory(filePath: string, directoryPath: string): boolean {
  const normalizedFile = filePath.replace(/\//g, '\\').toLowerCase();
  const normalizedDirectory = directoryPath.replace(/\//g, '\\').replace(/\\+$/g, '').toLowerCase();
  return normalizedFile === normalizedDirectory || normalizedFile.startsWith(`${normalizedDirectory}\\`);
}

function getRelativePathFromRoot(filePath: string, rootPath: string): string | null {
  if (!isPathInsideDirectory(filePath, rootPath)) {
    return null;
  }

  const normalizedFile = filePath.replace(/\//g, '\\');
  const normalizedRoot = rootPath.replace(/\//g, '\\').replace(/\\+$/g, '');

  if (normalizedFile === normalizedRoot) {
    return '';
  }

  return normalizeTreeRelativePath(normalizedFile.slice(normalizedRoot.length + 1));
}

function buildPreview(source: string): string {
  const previewLines = source
    .split(/\r?\n/)
    .map((line) => stripMarkdownPreviewLine(line))
    .filter((line) => line.length > 0);

  if (previewLines.length === 0) {
    return '\u7a7a\u767d Markdown \u6587\u6863';
  }

  return previewLines.slice(0, 2).join(' ');
}

function stripMarkdownPreviewLine(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+\.\s+/, '')
    .replace(/[`*_~|[\]]/g, '')
    .trim();
}

const HEADING_PATTERN = /^(#{1,6})(?:[ \t]+)?(.+)$/;
const SETEXT_H1_PATTERN = /^\s*=+\s*$/;
const SETEXT_H2_PATTERN = /^\s*-+\s*$/;

function createMarkdownSourceSnapshot(source: string): MarkdownSourceSnapshot {
  if (source.length === 0) {
    return {
      prefix: '',
      blocks: []
    };
  }

  const { rawLines, lines } = splitMarkdownSourceLines(source);
  let index = 0;

  while (index < lines.length && lines[index].trim().length === 0) {
    index += 1;
  }

  const prefix = rawLines.slice(0, index).join('');
  const blocks: MarkdownSourceBlock[] = [];

  while (index < lines.length) {
    const blockStart = index;
    const blockEnd = findMarkdownBlockEnd(lines, index);
    let separatorEnd = blockEnd;

    while (separatorEnd < lines.length && lines[separatorEnd].trim().length === 0) {
      separatorEnd += 1;
    }

    const blockSource = rawLines.slice(blockStart, blockEnd).join('');
    const separator = rawLines.slice(blockEnd, separatorEnd).join('');
    const headingStyle = detectHeadingStyle(blockSource);

    blocks.push({
      source: blockSource,
      separator,
      semanticKey: createMarkdownSemanticKey(blockSource),
      kind: headingStyle ? 'heading' : 'other',
      headingStyle
    });

    index = separatorEnd;
  }

  return {
    prefix,
    blocks
  };
}

function splitMarkdownSourceLines(source: string): { rawLines: string[]; lines: string[] } {
  if (source.length === 0) {
    return {
      rawLines: [],
      lines: []
    };
  }

  const rawLines: string[] = [];
  let start = 0;

  while (start < source.length) {
    const lineBreakIndex = source.indexOf('\n', start);

    if (lineBreakIndex < 0) {
      rawLines.push(source.slice(start));
      break;
    }

    rawLines.push(source.slice(start, lineBreakIndex + 1));
    start = lineBreakIndex + 1;
  }

  return {
    rawLines,
    lines: rawLines.map((line) => line.replace(/\r?\n$/, ''))
  };
}

function findMarkdownBlockEnd(lines: string[], index: number): number {
  if (index >= lines.length) {
    return index;
  }

  const line = lines[index];

  if (parseAtxHeadingLine(line)) {
    return index + 1;
  }

  if (parseSetextHeading(lines, index)) {
    return index + 2;
  }

  const fenceMatch = line.match(/^\s*(`{3,}|~{3,})(.*)$/);

  if (fenceMatch) {
    const fenceToken = fenceMatch[1];
    const fenceCharacter = fenceToken[0];
    let cursor = index + 1;

    while (cursor < lines.length) {
      const currentLine = lines[cursor];

      if (new RegExp(`^\\s*${fenceCharacter}{${fenceToken.length},}\\s*$`).test(currentLine)) {
        cursor += 1;
        break;
      }

      cursor += 1;
    }

    return cursor;
  }

  if (isIndentedCodeLine(line)) {
    let cursor = index + 1;

    while (cursor < lines.length) {
      const currentLine = lines[cursor];

      if (currentLine.trim().length === 0 || isIndentedCodeLine(currentLine)) {
        cursor += 1;
        continue;
      }

      break;
    }

    return cursor;
  }

  let cursor = index + 1;

  while (cursor < lines.length && lines[cursor].trim().length > 0) {
    cursor += 1;
  }

  return cursor;
}

function parseAtxHeadingLine(line: string): { level: 1 | 2 | 3 | 4 | 5 | 6; text: string } | null {
  const match = line.match(HEADING_PATTERN);

  if (!match) {
    return null;
  }

  return {
    level: match[1].length as 1 | 2 | 3 | 4 | 5 | 6,
    text: match[2]
  };
}

function parseSetextHeading(
  lines: string[],
  index: number
): { level: 1 | 2; text: string } | null {
  if (index + 1 >= lines.length) {
    return null;
  }

  const titleLine = lines[index].trimEnd();
  const underlineLine = lines[index + 1];

  if (titleLine.trim().length === 0) {
    return null;
  }

  if (SETEXT_H1_PATTERN.test(underlineLine)) {
    return {
      level: 1,
      text: titleLine
    };
  }

  if (SETEXT_H2_PATTERN.test(underlineLine)) {
    return {
      level: 2,
      text: titleLine
    };
  }

  return null;
}

function detectHeadingStyle(source: string): HeadingMarkdownStyle | null {
  const normalizedSource = source.replace(/\r/g, '').replace(/\n+$/g, '');
  const lines = normalizedSource.split('\n');

  if (lines.length === 0) {
    return null;
  }

  const atxHeading = parseAtxHeadingLine(lines[0]);

  if (atxHeading) {
    return 'atx';
  }

  const setextHeading = parseSetextHeading(lines, 0);

  if (!setextHeading) {
    return null;
  }

  return setextHeading.level === 1 ? 'setext-h1' : 'setext-h2';
}

function createMarkdownSemanticKey(source: string): string {
  const normalizedSource = normalizeMarkdownBlockSource(source);

  if (normalizedSource.length === 0) {
    return 'blank';
  }

  try {
    const tree = markdownSemanticProcessor.parse(source) as { children?: unknown[] };
    const normalizedChildren = Array.isArray(tree.children)
      ? tree.children.map((child) => normalizeMarkdownAstValue(child))
      : [];

    return JSON.stringify(normalizedChildren);
  } catch {
    return `raw:${normalizedSource}`;
  }
}

function normalizeMarkdownAstValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeMarkdownAstValue(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const result: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'position') {
      continue;
    }

    result[key] = normalizeMarkdownAstValue(entry);
  }

  return result;
}

function normalizeMarkdownBlockSource(source: string): string {
  return source.replace(/\r/g, '').replace(/^\n+|\n+$/g, '');
}

function isIndentedCodeLine(line: string): boolean {
  return /^(?: {4}|\t)/.test(line);
}

function getSnapshotHeadingStyles(snapshot: MarkdownSourceSnapshot): HeadingMarkdownStyle[] {
  return snapshot.blocks
    .filter((block) => block.kind === 'heading')
    .map((block) => block.headingStyle ?? 'atx');
}

function syncDocumentHeadingStyles(
  document: DocumentState,
  headings: Array<Pick<OutlineItem, 'id'>>
): HeadingStyleState[] {
  const byId = new Map(document.headingStyles.map((item) => [item.id, item.style]));
  const fallbackStyles = getSnapshotHeadingStyles(document.sourceSnapshot);
  const previousStyles = document.headingStyles;
  const nextStyles = headings.map((heading, index) => ({
    id: heading.id,
    style:
      byId.get(heading.id) ??
      previousStyles[index]?.style ??
      fallbackStyles[index] ??
      'atx'
  }));

  document.headingStyles = nextStyles;
  return nextStyles;
}

function updateDocumentHeadingStyle(
  document: DocumentState,
  headingId: string,
  style: HeadingMarkdownStyle
): void {
  const headingStyles = document.headingStyles.map((item) =>
    item.id === headingId ? { ...item, style } : item
  );

  document.headingStyles = headingStyles;
}

function migrateDocumentHeadingStyle(
  document: DocumentState,
  previousHeadingId: string,
  nextHeadingId: string
): void {
  if (previousHeadingId === nextHeadingId) {
    return;
  }

  document.headingStyles = document.headingStyles.map((item) =>
    item.id === previousHeadingId ? { ...item, id: nextHeadingId } : item
  );
}

function getHeadingStyleForDocument(
  document: DocumentState,
  headingId: string,
  fallbackLevel: 1 | 2 | 3 | 4 | 5 | 6
): HeadingMarkdownStyle {
  return (
    document.headingStyles.find((item) => item.id === headingId)?.style ??
    (fallbackLevel <= 2 ? 'atx' : 'atx')
  );
}

function resolveHeadingStyleAfterLevelChange(
  currentStyle: HeadingMarkdownStyle,
  nextLevel: 1 | 2 | 3 | 4 | 5 | 6
): HeadingMarkdownStyle {
  if (nextLevel >= 3) {
    return 'atx';
  }

  if (currentStyle === 'setext-h1' || currentStyle === 'setext-h2') {
    return nextLevel === 1 ? 'setext-h1' : 'setext-h2';
  }

  return 'atx';
}

function shouldUseFidelityPreservation(document: DocumentState, serializedMarkdown: string): boolean {
  return (
    document.sourceSnapshot.blocks.length <= MARKDOWN_SYNC_FIDELITY_BLOCK_LIMIT &&
    serializedMarkdown.length <= MARKDOWN_SYNC_FIDELITY_LENGTH_LIMIT
  );
}

function buildHeadingStylesForSnapshot(
  document: DocumentState,
  snapshot: MarkdownSourceSnapshot
): HeadingMarkdownStyle[] {
  const previousStyles = document.headingStyles;
  const fallbackStyles = getSnapshotHeadingStyles(document.sourceSnapshot);

  return snapshot.blocks
    .filter((block) => block.kind === 'heading')
    .map((block, index) => {
      const style =
        previousStyles[index]?.style ??
        block.headingStyle ??
        fallbackStyles[index] ??
        'atx';
      return style;
    });
}

function buildFidelityPreservedMarkdown(
  document: DocumentState,
  serializedMarkdown: string
): string {
  const baseline = document.sourceSnapshot;
  const current = createMarkdownSourceSnapshot(serializedMarkdown);

  if (current.blocks.length === 0) {
    return current.prefix;
  }

  const headingStyles = buildHeadingStylesForSnapshot(document, current);
  const originalIndexByCurrent = buildSemanticBlockMatches(baseline.blocks, current.blocks);
  let nextContent =
    originalIndexByCurrent[0] === 0
      ? baseline.prefix
      : current.prefix;
  let headingIndex = 0;

  current.blocks.forEach((block, currentIndex) => {
    const originalIndex = originalIndexByCurrent[currentIndex];
    let source = originalIndex === null ? block.source : baseline.blocks[originalIndex].source;

    if (block.kind === 'heading') {
      const currentHeadingStyle = headingStyles[headingIndex] ?? block.headingStyle ?? 'atx';
      const originalHeadingStyle =
        originalIndex === null ? null : baseline.blocks[originalIndex].headingStyle;
      const semanticChanged =
        originalIndex === null ||
        baseline.blocks[originalIndex].semanticKey !== block.semanticKey;

      if (semanticChanged || currentHeadingStyle !== originalHeadingStyle) {
        const rewrittenHeading = rewriteHeadingBlockSource(block.source, currentHeadingStyle);

        if (rewrittenHeading !== null) {
          source = rewrittenHeading;
        }
      }

      headingIndex += 1;
    }

    nextContent += source;
    nextContent += resolveMarkdownBlockSeparator(
      baseline,
      current,
      originalIndexByCurrent,
      currentIndex
    );
  });

  return nextContent;
}

function rewriteHeadingBlockSource(
  source: string,
  style: HeadingMarkdownStyle
): string | null {
  const heading = parseHeadingSource(source);

  if (!heading) {
    return null;
  }

  if (style === 'atx') {
    return `${'#'.repeat(heading.level)} ${heading.text}`;
  }

  const underlineCharacter = style === 'setext-h1' ? '=' : '-';
  const underlineLength = Math.max(3, heading.text.trim().length || 0);
  return `${heading.text}\n${underlineCharacter.repeat(underlineLength)}`;
}

function parseHeadingSource(
  source: string
): { style: HeadingMarkdownStyle; level: 1 | 2 | 3 | 4 | 5 | 6; text: string } | null {
  const normalizedSource = source.replace(/\r/g, '').replace(/\n+$/g, '');
  const lines = normalizedSource.split('\n');
  const atxHeading = parseAtxHeadingLine(lines[0] ?? '');

  if (atxHeading) {
    return {
      style: 'atx',
      level: atxHeading.level,
      text: atxHeading.text
    };
  }

  const setextHeading = parseSetextHeading(lines, 0);

  if (!setextHeading) {
    return null;
  }

  return {
    style: setextHeading.level === 1 ? 'setext-h1' : 'setext-h2',
    level: setextHeading.level,
    text: setextHeading.text
  };
}

function buildSemanticBlockMatches(
  baselineBlocks: MarkdownSourceBlock[],
  currentBlocks: MarkdownSourceBlock[]
): Array<number | null> {
  const baselineCount = baselineBlocks.length;
  const currentCount = currentBlocks.length;
  const dp = Array.from({ length: baselineCount + 1 }, () => Array(currentCount + 1).fill(0));

  for (let baselineIndex = baselineCount - 1; baselineIndex >= 0; baselineIndex -= 1) {
    for (let currentIndex = currentCount - 1; currentIndex >= 0; currentIndex -= 1) {
      if (baselineBlocks[baselineIndex].semanticKey === currentBlocks[currentIndex].semanticKey) {
        dp[baselineIndex][currentIndex] = dp[baselineIndex + 1][currentIndex + 1] + 1;
        continue;
      }

      dp[baselineIndex][currentIndex] = Math.max(
        dp[baselineIndex + 1][currentIndex],
        dp[baselineIndex][currentIndex + 1]
      );
    }
  }

  const matches = Array.from({ length: currentCount }, () => null as number | null);
  let baselineIndex = 0;
  let currentIndex = 0;

  while (baselineIndex < baselineCount && currentIndex < currentCount) {
    if (baselineBlocks[baselineIndex].semanticKey === currentBlocks[currentIndex].semanticKey) {
      matches[currentIndex] = baselineIndex;
      baselineIndex += 1;
      currentIndex += 1;
      continue;
    }

    if (dp[baselineIndex + 1][currentIndex] >= dp[baselineIndex][currentIndex + 1]) {
      baselineIndex += 1;
    } else {
      currentIndex += 1;
    }
  }

  return matches;
}

function resolveMarkdownBlockSeparator(
  baseline: MarkdownSourceSnapshot,
  current: MarkdownSourceSnapshot,
  originalIndexByCurrent: Array<number | null>,
  currentIndex: number
): string {
  const originalIndex = originalIndexByCurrent[currentIndex];

  if (originalIndex !== null) {
    const nextOriginalIndex =
      currentIndex + 1 < originalIndexByCurrent.length ? originalIndexByCurrent[currentIndex + 1] : null;

    if (nextOriginalIndex === originalIndex + 1) {
      return baseline.blocks[originalIndex].separator;
    }

    if (
      currentIndex === current.blocks.length - 1 &&
      originalIndex === baseline.blocks.length - 1
    ) {
      return baseline.blocks[originalIndex].separator;
    }
  }

  return current.blocks[currentIndex].separator;
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
}

function updateDocumentContent(document: DocumentState, nextContent: string): void {
  document.content = nextContent;
  document.isDirty = document.isUntitled || nextContent !== document.savedContent;
  if (findReplaceOpen && document.id === activeDocumentId) {
    recomputeFindReplaceMatches();
    renderFindReplaceBar();
  }
  scheduleNativeMenuStateSync();
  renderStatusBar();
}

function getMilkdownSession(documentId: string): MilkdownSession | undefined {
  return milkdownSessions.get(documentId);
}

function getActiveMilkdownSession(): MilkdownSession | undefined {
  return milkdownDocumentId ? getMilkdownSession(milkdownDocumentId) : undefined;
}

function beginMilkdownActivation(): number {
  milkdownActivationToken += 1;
  return milkdownActivationToken;
}

function isCurrentMilkdownActivation(token: number): boolean {
  return token === milkdownActivationToken;
}

function beginMilkdownSessionPrepare(documentId: string): number {
  const nextToken = (milkdownSessionPrepareTokens.get(documentId) ?? 0) + 1;
  milkdownSessionPrepareTokens.set(documentId, nextToken);
  return nextToken;
}

function invalidateMilkdownSessionPrepare(documentId: string): void {
  milkdownSessionPrepareTokens.delete(documentId);
}

function isCurrentMilkdownSessionPrepare(documentId: string, token: number): boolean {
  return milkdownSessionPrepareTokens.get(documentId) === token;
}

function ensureEditorSurfaceStack(): void {
  content.className = 'viewer-content viewer-content-milkdown';

  if (editorSurfaceStack.parentElement !== content) {
    content.replaceChildren(editorSurfaceStack);
  }
}

function createEditorSurface(documentId: string): HTMLDivElement {
  const surface = document.createElement('div');
  surface.className = 'editor-surface is-hidden';
  surface.dataset.documentId = documentId;
  surface.setAttribute('aria-hidden', 'true');
  surface.inert = true;
  return surface;
}

function clearEditorSurfaceTransitionTimer(): void {
  if (editorSurfaceTransitionTimer !== null) {
    window.clearTimeout(editorSurfaceTransitionTimer);
    editorSurfaceTransitionTimer = null;
  }
}

function setEditorSurfaceInteractivity(session: MilkdownSession, isInteractive: boolean): void {
  session.surface.setAttribute('aria-hidden', String(!isInteractive));
  session.surface.inert = !isInteractive;
}

function finalizeEditorSurfaceStates(activeDocumentIdToShow: string): void {
  clearEditorSurfaceTransitionTimer();

  for (const entry of milkdownSessions.values()) {
    const isActive = entry.documentId === activeDocumentIdToShow;
    entry.surface.classList.remove('is-pre-enter', 'is-transitioning-out');
    entry.surface.classList.toggle('is-active', isActive);
    entry.surface.classList.toggle('is-hidden', !isActive);
    setEditorSurfaceInteractivity(entry, isActive);
  }
}

function transitionEditorSurface(
  nextSession: MilkdownSession,
  previousSession: MilkdownSession | null
): void {
  clearEditorSurfaceTransitionTimer();
  editorSurfaceTransitionToken += 1;
  const transitionToken = editorSurfaceTransitionToken;

  nextSession.surface.classList.remove('is-hidden', 'is-transitioning-out');
  nextSession.surface.classList.remove('is-active');
  nextSession.surface.classList.add('is-pre-enter');
  setEditorSurfaceInteractivity(nextSession, true);

  if (previousSession) {
    previousSession.surface.classList.remove('is-hidden', 'is-pre-enter');
    previousSession.surface.classList.remove('is-active');
    previousSession.surface.classList.add('is-transitioning-out');
    setEditorSurfaceInteractivity(previousSession, false);
  }

  window.requestAnimationFrame(() => {
    if (transitionToken !== editorSurfaceTransitionToken) {
      return;
    }

    nextSession.surface.classList.add('is-active');
    nextSession.surface.classList.remove('is-pre-enter');
  });

  editorSurfaceTransitionTimer = window.setTimeout(() => {
    if (transitionToken !== editorSurfaceTransitionToken) {
      return;
    }

    finalizeEditorSurfaceStates(nextSession.documentId);
  }, EDITOR_SURFACE_TRANSITION_MS);
}

function setActiveEditorSurface(session: MilkdownSession): void {
  ensureEditorSurfaceStack();

  if (session.surface.parentElement !== editorSurfaceStack) {
    editorSurfaceStack.append(session.surface);
  }

  const previousSession =
    [...milkdownSessions.values()].find(
      (entry) => entry.documentId !== session.documentId && entry.surface.classList.contains('is-active')
    ) ?? null;

  if (previousSession && previousSession.documentId !== session.documentId) {
    clearHeadingTargetHighlight();
  }

  if (!previousSession || prefersReducedMotion()) {
    finalizeEditorSurfaceStates(session.documentId);
  } else {
    transitionEditorSurface(session, previousSession);
  }

  focusMilkdownSession(session);
}

function focusMilkdownSession(session: MilkdownSession): void {
  const activeElement = document.activeElement;

  if (activeElement instanceof HTMLElement) {
    const activeSurface = activeElement.closest('.editor-surface');

    if (activeSurface instanceof HTMLElement && activeSurface !== session.surface) {
      activeElement.blur();
    }
  }

  try {
    session.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.focus();
    });
  } catch {
    // Ignore focus failures and keep the current selection state.
  }
}

function persistMilkdownSessionState(session: MilkdownSession): void {
  const document = documents.find((entry) => entry.id === session.documentId);

  session.scrollTop = session.surface.scrollTop;
  session.scrollLeft = session.surface.scrollLeft;

  if (document) {
    if (milkdownDocumentId === session.documentId) {
      try {
        session.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          rememberMilkdownSelection(document, view.state.selection);
        });
      } catch {
        // Ignore selection persistence failures when the session is being torn down.
      }
    }

    document.editorScrollTop = session.scrollTop;
    document.editorScrollLeft = session.scrollLeft;
  }
}

function persistActiveMilkdownSessionState(): void {
  const session = getActiveMilkdownSession();

  if (!session) {
    return;
  }

  persistMilkdownSessionState(session);
  session.markdownSnapshot = milkdownMarkdownSnapshot ?? session.markdownSnapshot;
  session.hasPendingChanges =
    milkdownHasPendingChanges && milkdownPendingSyncDocumentId === session.documentId;
  session.headingMarkerOverlay = headingMarkerOverlay;
  session.headingMarkerBadge = headingMarkerBadge;
  session.headingMarkerMenu = headingMarkerMenu;
  session.headingMarkerMenuOpen = headingMarkerMenuOpen;
  session.activeHeadingMarkerState = activeHeadingMarkerState;
}

function bindMilkdownSession(session: MilkdownSession): void {
  milkdownEditor = session.editor;
  milkdownDocumentId = session.documentId;
  milkdownHost = session.host;
  milkdownMarkdownSnapshot = session.markdownSnapshot;
  milkdownPendingSyncDocumentId = session.hasPendingChanges ? session.documentId : null;
  milkdownHasPendingChanges = session.hasPendingChanges;
  headingMarkerOverlay = session.headingMarkerOverlay;
  headingMarkerBadge = session.headingMarkerBadge;
  headingMarkerMenu = session.headingMarkerMenu;
  headingMarkerMenuOpen = session.headingMarkerMenuOpen;
  activeHeadingMarkerState = session.activeHeadingMarkerState;
  session.lastUsedAt = Date.now();
}

function clearMilkdownBinding(): void {
  milkdownEditor = null;
  milkdownDocumentId = null;
  milkdownHost = null;
  milkdownMarkdownSnapshot = null;
  milkdownPendingSyncDocumentId = null;
  milkdownHasPendingChanges = false;
  headingMarkerOverlay = null;
  headingMarkerBadge = null;
  headingMarkerMenu = null;
  headingMarkerMenuOpen = false;
  activeHeadingMarkerState = null;
}

function restoreMilkdownSessionScroll(session: MilkdownSession): void {
  session.surface.scrollTop = session.scrollTop;
  session.surface.scrollLeft = session.scrollLeft;
}

function hasPendingMilkdownChanges(documentId: string): boolean {
  const session = getMilkdownSession(documentId);

  if (session) {
    return session.hasPendingChanges;
  }

  return milkdownHasPendingChanges && milkdownPendingSyncDocumentId === documentId;
}

function markMilkdownPendingChanges(documentId: string): void {
  const session = getMilkdownSession(documentId);

  if (session) {
    session.hasPendingChanges = true;
  }

  if (milkdownDocumentId === documentId) {
    milkdownPendingSyncDocumentId = documentId;
    milkdownHasPendingChanges = true;
  }
}

function markMilkdownSynchronized(documentId: string, markdown: string): void {
  const session = getMilkdownSession(documentId);

  if (session) {
    session.markdownSnapshot = markdown;
    session.hasPendingChanges = false;
  }

  if (milkdownDocumentId === documentId) {
    milkdownMarkdownSnapshot = markdown;
    milkdownPendingSyncDocumentId = null;
    milkdownHasPendingChanges = false;
  }
}

function syncActiveDocumentFromEditor(): void {
  const activeDocument = getActiveDocument();

  if (!activeDocument) {
    return;
  }

  if (editorViewMode === 'source') {
    syncSourceEditorDocumentState(activeDocument);
    return;
  }

  if (
    milkdownEditor &&
    milkdownDocumentId === activeDocument.id &&
    hasPendingMilkdownChanges(activeDocument.id)
  ) {
    const markdown = readMilkdownMarkdown();

    if (markdown !== null) {
      applyMilkdownMarkdownUpdate(activeDocument, markdown);
    }
  }
}

function readMilkdownMarkdown(): string | null {
  if (!milkdownEditor) {
    return null;
  }

  return readMilkdownEditorMarkdown(milkdownEditor);
}

function readMilkdownEditorMarkdown(editor: Editor): string | null {
  try {
    return editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const serializer = ctx.get(serializerCtx);

      return serializer(view.state.doc);
    });
  } catch {
    return null;
  }
}

function syncMilkdownSessionDocumentBeforeDestroy(session: MilkdownSession): void {
  persistMilkdownSessionState(session);

  if (!session.hasPendingChanges) {
    return;
  }

  const document = documents.find((entry) => entry.id === session.documentId);
  const markdown = readMilkdownEditorMarkdown(session.editor);

  if (!document || markdown === null) {
    return;
  }

  if (session.documentId === milkdownDocumentId) {
    applyMilkdownMarkdownUpdate(document, markdown);
    return;
  }

  updateDocumentContent(document, markdown);
  markMilkdownSynchronized(document.id, markdown);
}

function applyMilkdownMarkdownUpdate(document: DocumentState, markdown: string): void {
  const useFidelityPreservation = shouldUseFidelityPreservation(document, markdown);
  let nextContent = markdown;

  if (useFidelityPreservation) {
    nextContent = buildFidelityPreservedMarkdown(document, markdown);
  }

  markMilkdownSynchronized(document.id, nextContent);

  if (document.content === nextContent) {
    return;
  }

  updateDocumentContent(document, nextContent);
  renderDocumentHeader();

  if (sidebarMode === FILES_MODE) {
    updateFilesSidebarActiveState();
  } else {
    scheduleOutlineSidebarRefresh(document.id);
  }
}

async function destroyMilkdownEditorInstance(editor: Editor | null): Promise<void> {
  if (!editor) {
    return;
  }

  await editor.destroy();
}

async function destroyMilkdownSession(documentId: string): Promise<void> {
  const session = getMilkdownSession(documentId);

  invalidateMilkdownSessionPrepare(documentId);

  if (!session) {
    return;
  }

  syncMilkdownSessionDocumentBeforeDestroy(session);
  milkdownSessions.delete(documentId);

  if (milkdownDocumentId === documentId) {
    clearMilkdownBinding();
  }

  session.surface.remove();
  await destroyMilkdownEditorInstance(session.editor);
}

async function destroyAllMilkdownSessions(): Promise<void> {
  beginMilkdownActivation();
  const sessions = [...milkdownSessions.values()];

  for (const session of sessions) {
    syncMilkdownSessionDocumentBeforeDestroy(session);
  }

  milkdownSessions = new Map();
  milkdownSessionPrepareTokens = new Map();
  clearMilkdownBinding();
  editorSurfaceStack.replaceChildren();

  await Promise.all(sessions.map((session) => destroyMilkdownEditorInstance(session.editor)));
}

function pruneMilkdownSessionCache(activeDocumentIdToKeep: string): void {
  if (milkdownSessions.size <= MILKDOWN_SESSION_CACHE_LIMIT) {
    return;
  }

  const inactiveSessions = [...milkdownSessions.values()]
    .filter((session) => session.documentId !== activeDocumentIdToKeep)
    .sort((left, right) => left.lastUsedAt - right.lastUsedAt);

  while (milkdownSessions.size > MILKDOWN_SESSION_CACHE_LIMIT && inactiveSessions.length > 0) {
    const session = inactiveSessions.shift();

    if (session) {
      void destroyMilkdownSession(session.documentId);
    }
  }
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
    scheduleNativeMenuStateSync();
    renderStatusBar();
    return;
  }

  fileHint.textContent = getDefaultHint(activeDocument);
  fileHint.classList.remove('is-error');
  scheduleNativeMenuStateSync();
  renderStatusBar();
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

function prefersReducedMotion(): boolean {
  return reducedMotionMediaQuery.matches;
}

function getSidebarView(mode: SidebarMode): HTMLElement {
  return mode === FILES_MODE ? filesSidebarView : outlineSidebarView;
}

function ensureSidebarViewsMounted(): void {
  if (filesSidebarView.parentElement !== sidebarBody) {
    sidebarBody.append(filesSidebarView);
  }

  if (outlineSidebarView.parentElement !== sidebarBody) {
    sidebarBody.append(outlineSidebarView);
  }
}

function clearSidebarViewTransitionTimer(): void {
  if (sidebarViewTransitionTimer !== null) {
    window.clearTimeout(sidebarViewTransitionTimer);
    sidebarViewTransitionTimer = null;
  }
}

function setSidebarViewInteractivity(view: HTMLElement, isInteractive: boolean): void {
  view.setAttribute('aria-hidden', String(!isInteractive));
  view.inert = !isInteractive;
}

function finalizeSidebarViewState(activeMode: SidebarMode): void {
  clearSidebarViewTransitionTimer();

  for (const mode of [FILES_MODE, OUTLINE_MODE] as const) {
    const view = getSidebarView(mode);
    const isActive = mode === activeMode;
    view.classList.remove('is-entering', 'is-leaving');
    view.classList.toggle('is-active', isActive);
    view.classList.toggle('is-inactive', !isActive);
    setSidebarViewInteractivity(view, isActive);
  }
}

function setSidebarViewState(nextMode: SidebarMode, animate: boolean): void {
  ensureSidebarViewsMounted();
  const nextView = getSidebarView(nextMode);
  const previousMode = sidebarVisibleMode;
  const previousView = getSidebarView(previousMode);

  if (!animate || previousMode === nextMode || prefersReducedMotion()) {
    finalizeSidebarViewState(nextMode);
    return;
  }

  clearSidebarViewTransitionTimer();
  previousView.classList.remove('is-active', 'is-entering');
  previousView.classList.add('is-leaving');
  previousView.classList.remove('is-inactive');
  setSidebarViewInteractivity(previousView, false);

  nextView.classList.remove('is-inactive', 'is-leaving');
  nextView.classList.add('is-active', 'is-entering');
  setSidebarViewInteractivity(nextView, true);

  window.requestAnimationFrame(() => {
    nextView.classList.remove('is-entering');
  });

  sidebarViewTransitionTimer = window.setTimeout(() => {
    finalizeSidebarViewState(nextMode);
  }, SIDEBAR_VIEW_TRANSITION_MS);
}

function setFilesSidebarEmptyState(text: string): void {
  filesSidebarNotice.hidden = true;
  filesSidebarNotice.textContent = '';
  filesSidebarEmpty.hidden = false;
  filesSidebarEmpty.textContent = text;
  filesSidebarList.hidden = true;
}

function setOutlineSidebarEmptyState(text: string): void {
  outlineSidebarEmpty.hidden = false;
  outlineSidebarEmpty.textContent = text;
  outlineSidebarList.hidden = true;
}

function reconcileKeyedChildren<T, E extends HTMLElement>(
  parent: HTMLElement,
  items: readonly T[],
  getKey: (item: T) => string,
  createNode: (item: T) => E,
  syncNode: (node: E, item: T) => void,
  nodeCache: Map<string, E>
): void {
  const nextKeys = new Set<string>();
  let cursor: ChildNode | null = null;

  for (const item of items) {
    const key = getKey(item);
    nextKeys.add(key);

    let node = nodeCache.get(key);

    if (!node) {
      node = createNode(item);
      nodeCache.set(key, node);
    }

    syncNode(node, item);

    if (cursor === null) {
      if (parent.firstChild !== node) {
        parent.insertBefore(node, parent.firstChild);
      }
    } else if (node.previousSibling !== cursor) {
      parent.insertBefore(node, cursor.nextSibling);
    }

    cursor = node;
  }

  const staleKeys: string[] = [];

  for (const [key, node] of nodeCache) {
    if (!nextKeys.has(key)) {
      node.remove();
      staleKeys.push(key);
    }
  }

  for (const key of staleKeys) {
    nodeCache.delete(key);
  }
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
}

function rememberSidebarScrollPosition(mode: SidebarMode): void {
  const view = getSidebarView(mode);
  sidebarScrollPositions.set(mode, {
    top: view.scrollTop,
    left: view.scrollLeft
  });
}

function restoreSidebarScrollPosition(mode: SidebarMode): void {
  const view = getSidebarView(mode);
  const saved = sidebarScrollPositions.get(mode);

  if (!saved) {
    return;
  }

  view.scrollTop = saved.top;
  view.scrollLeft = saved.left;
}

function scheduleRender(): void {
  if (renderFrame !== null) {
    return;
  }

  renderFrame = window.requestAnimationFrame(() => {
    renderFrame = null;
    flushRenderRequests();
  });
}

function requestRender(request: RenderRequest): void {
  renderEditorPending ||= Boolean(request.editor);
  renderSidebarPending ||= Boolean(request.sidebar);
  renderFilesSidebarPending ||= Boolean(request.filesSidebar);
  renderOutlineSidebarPending ||= Boolean(request.outlineSidebar);
  renderAnimateSidebarPending ||= Boolean(request.animateSidebar);

  if (request.activationToken !== undefined) {
    renderActivationToken = request.activationToken;
  }

  scheduleRender();
}

function clearPendingSidebarRender(): void {
  renderSidebarPending = false;
  renderFilesSidebarPending = false;
  renderOutlineSidebarPending = false;
  renderAnimateSidebarPending = false;
}

function flushRenderRequests(): void {
  const shouldRenderEditor = renderEditorPending;
  const shouldRenderSidebar = renderSidebarPending;
  const shouldRenderFilesSidebar = renderFilesSidebarPending;
  const shouldRenderOutlineSidebar = renderOutlineSidebarPending;
  const shouldAnimateSidebar = renderAnimateSidebarPending;
  const activationToken = renderActivationToken ?? milkdownActivationToken;

  renderEditorPending = false;
  renderActivationToken = null;
  clearPendingSidebarRender();

  if (shouldRenderEditor) {
    renderActiveDocument(activationToken);
  }

  if (shouldRenderSidebar) {
    renderSidebar(shouldAnimateSidebar);
    return;
  }

  if (sidebarMode === FILES_MODE && shouldRenderFilesSidebar) {
    renderFilesSidebar();
    return;
  }

  if (sidebarMode === OUTLINE_MODE && shouldRenderOutlineSidebar) {
    renderOutlineSidebar();
  }
}

function requestFilesSidebarRefresh(): void {
  requestRender({ filesSidebar: true });
}

function requestOutlineSidebarRefresh(): void {
  requestRender({ outlineSidebar: true });
}

function requestSidebarRefreshForCurrentMode(): void {
  if (sidebarMode === FILES_MODE) {
    requestFilesSidebarRefresh();
    return;
  }

  requestOutlineSidebarRefresh();
}

function setSidebarMode(nextMode: SidebarMode): void {
  if (sidebarMode === nextMode) {
    requestRender({ sidebar: true });
    return;
  }

  sidebarMode = nextMode;
  requestRender({ sidebar: true, animateSidebar: true });
}

function setFilesSidebarViewMode(nextMode: FilesSidebarViewMode): void {
  if (filesSidebarViewMode === nextMode) {
    requestFilesSidebarRefresh();
    return;
  }

  filesSidebarViewMode = nextMode;
  persistFilesSidebarViewMode();

  if (sidebarMode !== FILES_MODE) {
    setSidebarMode(FILES_MODE);
  } else {
    requestFilesSidebarRefresh();
  }
}

function setFilesSidebarSearchVisible(nextVisible: boolean): void {
  filesSidebarSearchState.isVisible = nextVisible;

  if (!nextVisible) {
    filesSidebarSearchState.query = '';
    filesSidebarSearchInput.value = '';
  }

  persistFilesSidebarSearchVisible();

  if (sidebarMode !== FILES_MODE) {
    setSidebarMode(FILES_MODE);
  } else {
    requestFilesSidebarRefresh();
  }

  if (nextVisible) {
    window.requestAnimationFrame(() => {
      filesSidebarSearchInput.focus();
      filesSidebarSearchInput.select();
    });
  }
}

function openFilesSidebarSearch(): void {
  setFilesSidebarSearchVisible(true);
}

function closePropertiesDialog(): void {
  propertiesDialogOpen = false;
  propertiesOverlay.classList.add('is-hidden');
  propertiesDialogBody.replaceChildren();
}

function formatPropertyValue(value: string): string {
  return value.length > 0 ? value : '—';
}

function formatPropertyTimestamp(value: number | null): string {
  if (value === null) {
    return '—';
  }

  try {
    return new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value * 1000));
  } catch {
    return String(value);
  }
}

function formatPropertySize(sizeBytes: number | null): string {
  if (sizeBytes === null) {
    return '—';
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function showPropertiesDialog(
  properties: PathPropertiesPayload,
  options: { isOpen?: boolean; isDirty?: boolean } = {}
): void {
  propertiesDialogBody.replaceChildren();

  const entries: Array<[string, string]> = [
    ['名称', properties.name],
    ['类型', properties.isDirectory ? '文件夹' : '文件'],
    ['路径', properties.path],
    ['所在目录', properties.parentPath],
    ['扩展名', properties.extension ?? ''],
    ['大小', formatPropertySize(properties.sizeBytes)],
    ['修改时间', formatPropertyTimestamp(properties.modifiedAt)]
  ];

  if (options.isOpen !== undefined) {
    entries.push(['已打开', options.isOpen ? '是' : '否']);
  }

  if (options.isDirty !== undefined) {
    entries.push(['未保存修改', options.isDirty ? '是' : '否']);
  }

  for (const [label, value] of entries) {
    const term = document.createElement('dt');
    term.textContent = label;

    const detail = document.createElement('dd');
    detail.textContent = formatPropertyValue(value);
    detail.title = value;

    propertiesDialogBody.append(term, detail);
  }

  propertiesDialogDescription.textContent = properties.isDirectory
    ? '当前项目中的文件夹信息。'
    : '当前项目中的文件信息。';
  propertiesDialogOpen = true;
  propertiesOverlay.classList.remove('is-hidden');
}

function cancelOutlineSidebarRefresh(): void {
  if (outlineSidebarRefreshTimer !== null) {
    window.clearTimeout(outlineSidebarRefreshTimer);
    outlineSidebarRefreshTimer = null;
  }

  outlineSidebarRefreshDocumentId = null;
}

function scheduleOutlineSidebarRefresh(documentId: string): void {
  cancelOutlineSidebarRefresh();
  outlineSidebarRefreshDocumentId = documentId;

  outlineSidebarRefreshTimer = window.setTimeout(() => {
    outlineSidebarRefreshTimer = null;

    if (
      sidebarMode !== OUTLINE_MODE ||
      activeDocumentId !== outlineSidebarRefreshDocumentId ||
      activeDocumentId === null
    ) {
      outlineSidebarRefreshDocumentId = null;
      return;
    }

    outlineSidebarRefreshDocumentId = null;
    renderOutlineSidebarIfVisible();
  }, OUTLINE_SIDEBAR_REFRESH_DELAY_MS);
}

async function setCurrentDirectoryPath(
  nextDirectoryPath: string | null,
  activationToken: number = milkdownActivationToken
): Promise<boolean> {
  return await refreshCurrentDirectoryFiles(nextDirectoryPath, activationToken);
}

async function setCurrentDirectoryFromFilePath(
  filePath: string,
  activationToken: number = milkdownActivationToken
): Promise<boolean> {
  const parentPath = getParentPathFromFilePath(filePath);

  if (parentPath && parentPath !== currentDirectoryPath) {
    return await setCurrentDirectoryPath(parentPath, activationToken);
  }

  return false;
}

async function refreshCurrentDirectoryFiles(
  nextDirectoryPath: string | null = currentDirectoryPath,
  activationToken: number = milkdownActivationToken
): Promise<boolean> {
  if (!isCurrentMilkdownActivation(activationToken)) {
    return false;
  }

  directoryFilesLoadToken += 1;
  const loadToken = directoryFilesLoadToken;

  if (!nextDirectoryPath) {
    currentDirectoryPath = null;
    persistCurrentDirectoryPath();
    directoryFiles = [];
    directoryFolders = [];
    directoryFilesLoading = false;
    directoryFilesError = null;
    directoryFilesNotice = null;
    requestRender({ sidebar: true });
    return true;
  }

  directoryFilesLoading = true;
  directoryFilesError = null;
  directoryFilesNotice = null;
  requestRender({ sidebar: true });

  try {
    const result = await invoke<TextFileListResult>('list_text_files', {
      rootPath: nextDirectoryPath
    });

    if (loadToken !== directoryFilesLoadToken || !isCurrentMilkdownActivation(activationToken)) {
      return false;
    }

    currentDirectoryPath = nextDirectoryPath;
    persistCurrentDirectoryPath();
    directoryFiles = result.files;
    directoryFolders = result.directories;
    directoryFilesError = null;
    directoryFilesNotice = result.isTruncated
      ? `\u5f53\u524d\u76ee\u5f55\u8fc7\u5927\uff0c\u5df2\u53ea\u663e\u793a\u524d ${TEXT_FILE_SCAN_DISPLAY_LIMIT} \u4e2a\u6587\u672c\u6587\u4ef6\u3002`
      : null;
    return true;
  } catch {
    if (loadToken !== directoryFilesLoadToken || !isCurrentMilkdownActivation(activationToken)) {
      return false;
    }

    currentDirectoryPath = nextDirectoryPath;
    persistCurrentDirectoryPath();
    directoryFiles = [];
    directoryFolders = [];
    directoryFilesError = '\u8bfb\u53d6\u5f53\u524d\u76ee\u5f55\u5931\u8d25\u3002';
    directoryFilesNotice = null;
    return true;
  } finally {
    if (loadToken === directoryFilesLoadToken) {
      directoryFilesLoading = false;
      requestRender({ sidebar: true });
    }
  }
}

function syncCurrentDirectoryFileEntry(
  document: Pick<DocumentState, 'fileName' | 'filePath' | 'directoryPath' | 'content'>,
  previousFilePath: string | null = null
): boolean {
  const directoryPath = document.directoryPath;
  const filePath = document.filePath;

  if (!currentDirectoryPath || !directoryPath || directoryPath !== currentDirectoryPath || !filePath) {
    return false;
  }

  const nextEntry: DirectoryFileEntry = {
    fileName: document.fileName,
    filePath,
    directoryPath,
    relativeDirectory: '.',
    modifiedAt: Date.now(),
    preview: buildPreview(document.content)
  };
  const pathToReplace = previousFilePath && previousFilePath !== filePath ? previousFilePath : filePath;

  directoryFiles = directoryFiles.filter((entry) => entry.filePath !== pathToReplace);
  directoryFiles.push(nextEntry);
  directoryFiles.sort((left, right) => left.filePath.localeCompare(right.filePath));
  return true;
}

async function closeDocument(documentId: string): Promise<void> {
  syncActiveDocumentFromEditor();
  closeFindReplaceBar();

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

  sourceHistoryByDocument.delete(documentId);
  await destroyMilkdownSession(documentId);
  documents = documents.filter((entry) => entry.id !== documentId);

  if (replacementDocumentId && documents.some((entry) => entry.id === replacementDocumentId)) {
    activeDocumentId = replacementDocumentId;
  } else {
    activeDocumentId = null;
  }

  requestRender({ editor: true });
  requestSidebarRefreshForCurrentMode();
}

function compareFileTreeNodes(left: FileTreeNode, right: FileTreeNode): number {
  const leftOrder = left.kind === 'folder' ? 0 : 1;
  const rightOrder = right.kind === 'folder' ? 0 : 1;

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: 'base'
  });
}

function getForcedExpandedFileTreePaths(): Set<string> {
  const forced = new Set<string>();
  const activeDocument = getActiveDocument();

  if (!activeDocument?.filePath || !currentDirectoryPath) {
    return forced;
  }

  const relativeFilePath = getRelativePathFromRoot(activeDocument.filePath, currentDirectoryPath);

  if (!relativeFilePath) {
    return forced;
  }

  const segments = relativeFilePath.split('/');
  segments.pop();
  let currentPath = '';

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    forced.add(currentPath);
  }

  return forced;
}

function resolveFileTreeNodeExpanded(
  rootPath: string | null,
  relativePath: string,
  forcedExpanded: Set<string>,
  forceAllExpanded = false
): boolean {
  if (forceAllExpanded) {
    return true;
  }

  const stored = getStoredFileTreeExpansion(rootPath, relativePath);

  if (stored !== undefined) {
    return stored;
  }

  if (forcedExpanded.has(relativePath)) {
    return true;
  }

  return relativePath === '';
}

function getDirectorySeparator(path: string): string {
  return path.includes('\\') ? '\\' : '/';
}

function joinDirectoryPath(basePath: string, relativePath: string): string {
  if (!relativePath) {
    return basePath;
  }

  const separator = getDirectorySeparator(basePath);
  return `${basePath}${separator}${relativePath.split('/').join(separator)}`;
}

function getFilteredDirectoryFiles(): DirectoryFileEntry[] {
  const query = filesSidebarSearchState.query.trim().toLowerCase();

  if (query.length === 0) {
    return directoryFiles;
  }

  return directoryFiles.filter((entry) => {
    const relativePath =
      entry.relativeDirectory === '.'
        ? entry.fileName
        : `${normalizeTreeRelativePath(entry.relativeDirectory)}/${entry.fileName}`;

    return relativePath.toLowerCase().includes(query) || entry.fileName.toLowerCase().includes(query);
  });
}

function getFilteredDirectoryFolders(): DirectoryFolderEntry[] {
  const query = filesSidebarSearchState.query.trim().toLowerCase();

  if (query.length === 0) {
    return directoryFolders;
  }

  return directoryFolders.filter((entry) => {
    const relativePath = normalizeTreeRelativePath(entry.relativePath);
    return relativePath.toLowerCase().includes(query) || entry.name.toLowerCase().includes(query);
  });
}

function getFilteredUntitledDocuments(): DocumentState[] {
  const untitledDocuments = documents.filter((document) => !document.filePath);
  const query = filesSidebarSearchState.query.trim().toLowerCase();

  if (query.length === 0) {
    return untitledDocuments;
  }

  return untitledDocuments.filter((document) => document.fileName.toLowerCase().includes(query));
}

function buildFileTreeRoot(
  fileEntries: DirectoryFileEntry[] = getFilteredDirectoryFiles(),
  folderEntries: DirectoryFolderEntry[] = getFilteredDirectoryFolders(),
  untitledDocuments: DocumentState[] = getFilteredUntitledDocuments()
): FileTreeNode | null {
  if (!currentDirectoryPath && untitledDocuments.length === 0) {
    return null;
  }

  const forcedExpanded = getForcedExpandedFileTreePaths();
  const rootPath = currentDirectoryPath;
  const forceAllExpanded = filesSidebarSearchState.query.trim().length > 0;
  const root: FileTreeNode = {
    key: `root:${rootPath ?? '__virtual-root__'}`,
    kind: 'root',
    name: rootPath ? getDirectoryLabel(rootPath) : '\u672a\u6253\u5f00\u6587\u4ef6\u5939',
    relativePath: '',
    filePath: rootPath,
    documentId: null,
    isActive: false,
    isDirty: false,
    isOpen: false,
    isExpanded: resolveFileTreeNodeExpanded(rootPath, '', forcedExpanded, forceAllExpanded),
    children: []
  };
  const foldersByRelativePath = new Map<string, FileTreeNode>([['', root]]);
  const documentsByPath = new Map<string, DocumentState>();

  for (const document of documents) {
    if (document.filePath) {
      documentsByPath.set(document.filePath, document);
    }
  }

  const ensureFolderNode = (relativePath: string, absolutePath: string | null = null): FileTreeNode => {
    const normalizedPath = normalizeTreeRelativePath(relativePath);

    if (!normalizedPath) {
      return root;
    }

    const segments = normalizedPath.split('/').filter(Boolean);
    let currentRelativePath = '';
    let parent = root;

    for (const segment of segments) {
      currentRelativePath = currentRelativePath ? `${currentRelativePath}/${segment}` : segment;
      let folder = foldersByRelativePath.get(currentRelativePath);

      if (!folder) {
        folder = {
          key: `folder:${currentRelativePath}`,
          kind: 'folder',
          name: segment,
          relativePath: currentRelativePath,
          filePath: rootPath ? joinDirectoryPath(rootPath, currentRelativePath) : null,
          documentId: null,
          isActive: false,
          isDirty: false,
          isOpen: false,
          isExpanded: resolveFileTreeNodeExpanded(
            rootPath,
            currentRelativePath,
            forcedExpanded,
            forceAllExpanded
          ),
          children: []
        };
        foldersByRelativePath.set(currentRelativePath, folder);
        parent.children.push(folder);
      }

      parent = folder;
    }

    if (absolutePath && parent.filePath !== absolutePath) {
      parent.filePath = absolutePath;
    }

    return parent;
  };

  for (const entry of folderEntries) {
    ensureFolderNode(entry.relativePath, entry.path);
  }

  for (const entry of fileEntries) {
    const normalizedDirectory =
      entry.relativeDirectory === '.' ? '' : normalizeTreeRelativePath(entry.relativeDirectory);
    const parent = ensureFolderNode(normalizedDirectory);
    const openDocument = documentsByPath.get(entry.filePath);
    const fileRelativePath = normalizedDirectory
      ? `${normalizedDirectory}/${entry.fileName}`
      : entry.fileName;

    parent.children.push({
      key: `file:${entry.filePath}`,
      kind: 'file',
      name: entry.fileName,
      relativePath: normalizeTreeRelativePath(fileRelativePath),
      filePath: entry.filePath,
      documentId: openDocument?.id ?? null,
      isActive: openDocument?.id === activeDocumentId,
      isDirty: openDocument ? isDocumentUnsaved(openDocument) : false,
      isOpen: Boolean(openDocument),
      isExpanded: false,
      children: []
    });
  }

  for (const document of untitledDocuments) {
    root.children.push({
      key: `untitled:${document.id}`,
      kind: 'file',
      name: document.fileName,
      relativePath: `__untitled__/${document.id}`,
      filePath: null,
      documentId: document.id,
      isActive: document.id === activeDocumentId,
      isDirty: isDocumentUnsaved(document),
      isOpen: true,
      isExpanded: false,
      children: []
    });
  }

  const sortNodeChildren = (node: FileTreeNode): void => {
    node.children.sort(compareFileTreeNodes);

    for (const child of node.children) {
      if (child.kind !== 'file') {
        sortNodeChildren(child);
      }
    }
  };

  sortNodeChildren(root);
  return root;
}

function buildFilesSidebarListRows(): FileTreeRow[] {
  const openDocumentsByPath = new Map<string, DocumentState>();

  for (const document of documents) {
    if (document.filePath) {
      openDocumentsByPath.set(document.filePath, document);
    }
  }

  const folderRows = getFilteredDirectoryFolders().map((entry) => ({
    key: `list-folder:${entry.path}`,
    kind: 'folder' as const,
    name: entry.name,
    relativePath: normalizeTreeRelativePath(entry.relativePath),
    filePath: entry.path,
    documentId: null,
    isActive: false,
    isDirty: false,
    isOpen: false,
    isExpanded: false,
    hasChildren: false,
    depth: Math.max(0, normalizeTreeRelativePath(entry.relativePath).split('/').filter(Boolean).length - 1)
  }));
  const fileRows = getFilteredDirectoryFiles().map((entry) => {
      const openDocument = openDocumentsByPath.get(entry.filePath);
      const relativePath =
        entry.relativeDirectory === '.'
          ? entry.fileName
          : `${normalizeTreeRelativePath(entry.relativeDirectory)}/${entry.fileName}`;

      return {
        key: `list-file:${entry.filePath}`,
        kind: 'file' as const,
        name: entry.fileName,
        relativePath,
        filePath: entry.filePath,
        documentId: openDocument?.id ?? null,
        isActive: openDocument?.id === activeDocumentId,
        isDirty: openDocument ? isDocumentUnsaved(openDocument) : false,
        isOpen: Boolean(openDocument),
        isExpanded: false,
        hasChildren: false,
        depth: 0
      };
    });
  const rows: FileTreeRow[] = [...folderRows, ...fileRows].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, undefined, {
      numeric: true,
      sensitivity: 'base'
    })
  );

  for (const document of getFilteredUntitledDocuments()) {
    rows.unshift({
      key: `list-untitled:${document.id}`,
      kind: 'file',
      name: document.fileName,
      relativePath: `__untitled__/${document.id}`,
      filePath: null,
      documentId: document.id,
      isActive: document.id === activeDocumentId,
      isDirty: isDocumentUnsaved(document),
      isOpen: true,
      isExpanded: false,
      hasChildren: false,
      depth: 0
    });
  }

  return rows;
}

function flattenFileTreeRows(node: FileTreeNode, depth = 0): FileTreeRow[] {
  const rows: FileTreeRow[] = [
    {
      key: node.key,
      kind: node.kind,
      name: node.name,
      relativePath: node.relativePath,
      filePath: node.filePath,
      documentId: node.documentId,
      isActive: node.isActive,
      isDirty: node.isDirty,
      isOpen: node.isOpen,
      isExpanded: node.isExpanded,
      hasChildren: node.children.length > 0,
      depth
    }
  ];

  if (!node.isExpanded) {
    return rows;
  }

  for (const child of node.children) {
    rows.push(...flattenFileTreeRows(child, depth + 1));
  }

  return rows;
}

function handleFileTreeRowAction(button: HTMLButtonElement): void {
  const kind = button.dataset.kind as FileTreeNodeKind | undefined;

  if (!kind) {
    return;
  }

  if (kind === 'file') {
    const documentId = button.dataset.documentId || '';
    const filePath = button.dataset.filePath || '';

    if (documentId) {
      void activateDocument(documentId);
      return;
    }

    if (filePath) {
      void openDocumentFromPath(filePath, { updateCurrentDirectory: false });
    }
    return;
  }

  if (filesSidebarViewMode === 'list') {
    const filePath = button.dataset.filePath || '';

    if (filePath) {
      void setCurrentDirectoryPath(filePath);
    }
    return;
  }

  const relativePath = button.dataset.relativePath || '';
  const expanded = button.dataset.expanded === 'true';
  setStoredFileTreeExpansion(currentDirectoryPath, relativePath, !expanded);
  requestFilesSidebarRefresh();
}

function createFileTreeRow(item: FileTreeRow): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'file-tree-row';
  row.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    handleFileTreeRowAction(row);
  });
  row.addEventListener('click', (event) => {
    if (event.detail === 0) {
      handleFileTreeRowAction(row);
    }
  });

  const twisty = document.createElement('span');
  twisty.className = 'file-tree-twisty';
  twisty.setAttribute('aria-hidden', 'true');

  const icon = document.createElement('span');
  icon.className = 'file-tree-icon';
  icon.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = 'file-tree-label';

  const dirtyDot = document.createElement('span');
  dirtyDot.className = 'file-tree-dirty-dot';
  dirtyDot.textContent = '\u25CF';
  dirtyDot.setAttribute('aria-hidden', 'true');

  row.append(twisty, icon, label, dirtyDot);
  fileTreeRowParts.set(row, {
    mainButton: row,
    twisty,
    icon,
    label,
    dirtyDot
  });
  syncFileTreeRow(row, item);
  return row;
}

function syncFileTreeRow(row: HTMLElement, item: FileTreeRow): void {
  const parts = fileTreeRowParts.get(row);

  if (!parts) {
    return;
  }

  row.dataset.kind = item.kind;
  row.dataset.relativePath = item.relativePath;
  row.dataset.filePath = item.filePath ?? '';
  row.dataset.documentId = item.documentId ?? '';
  row.dataset.expanded = String(item.isExpanded);
  row.style.setProperty('--tree-depth', String(item.depth));
  row.classList.toggle('is-root', item.kind === 'root');
  row.classList.toggle('is-folder', item.kind === 'folder');
  row.classList.toggle('is-file', item.kind === 'file');
  row.classList.toggle('has-children', item.hasChildren);
  row.classList.toggle('is-expanded', item.isExpanded);
  row.classList.toggle('is-active', item.isActive);
  row.classList.toggle('is-open', item.isOpen);
  row.classList.toggle('is-dirty', item.isDirty);
  row.classList.toggle('is-hidden-name', item.name.startsWith('.'));
  row.title = item.name;
  row.setAttribute('aria-selected', String(item.isActive));

  if (item.kind === 'file') {
    row.removeAttribute('aria-expanded');
  } else {
    row.setAttribute('aria-expanded', String(item.isExpanded));
  }

  row.setAttribute(
    'aria-label',
    item.kind === 'file'
      ? `${item.name}${item.isDirty ? '\uff0c\u672a\u4fdd\u5b58' : ''}`
      : `${item.name}${item.isExpanded ? '\uff0c\u5df2\u5c55\u5f00' : '\uff0c\u5df2\u6298\u53e0'}`
  );

  parts.label.textContent = item.name;
  parts.twisty.textContent = item.hasChildren ? (item.isExpanded ? '\u25be' : '\u25b8') : '';
  parts.twisty.classList.toggle('is-placeholder', !item.hasChildren);
  parts.icon.className = `file-tree-icon is-${item.kind}`;
  parts.dirtyDot.hidden = item.kind !== 'file' || !item.isDirty;
}

function renderFilesSidebar(): void {
  filesSidebarSearchBar.classList.toggle('is-hidden', !filesSidebarSearchState.isVisible);
  filesSidebarSearchInput.value = filesSidebarSearchState.query;

  if (directoryFilesLoading) {
    setFilesSidebarEmptyState('\u6b63\u5728\u8bfb\u53d6\u5f53\u524d\u76ee\u5f55...');
    return;
  }

  if (directoryFilesError) {
    setFilesSidebarEmptyState(directoryFilesError);
    return;
  }

  if (filesSidebarViewMode === 'list') {
    const rows = buildFilesSidebarListRows();

    if (rows.length === 0) {
      if (filesSidebarSearchState.query.trim().length > 0) {
        setFilesSidebarEmptyState('没有匹配的文档。');
        return;
      }

      if (!currentDirectoryPath) {
        setFilesSidebarEmptyState('\u901a\u8fc7 "\u6587\u4ef6 -> \u6253\u5f00\u6587\u4ef6\u5939" \u9009\u62e9\u4e00\u4e2a\u76ee\u5f55\u3002');
        return;
      }

      setFilesSidebarEmptyState('\u5f53\u524d\u76ee\u5f55\u4e0b\u6ca1\u6709 .md\u3001.markdown \u6216 .txt \u6587\u4ef6\u3002');
      return;
    }

    filesSidebarEmpty.hidden = true;
    filesSidebarNotice.hidden = !directoryFilesNotice;
    filesSidebarNotice.textContent = directoryFilesNotice ?? '';
    filesSidebarList.hidden = false;
    reconcileKeyedChildren(
      filesSidebarList,
      rows,
      (item) => item.key,
      createFileTreeRow,
      syncFileTreeRow,
      fileTreeRowNodeCache
    );
    return;
  }

  const root = buildFileTreeRoot();

  if (!root || root.children.length === 0) {
    if (filesSidebarSearchState.query.trim().length > 0) {
      setFilesSidebarEmptyState('没有匹配的文档。');
      return;
    }

    if (!currentDirectoryPath) {
      setFilesSidebarEmptyState('\u901a\u8fc7 "\u6587\u4ef6 -> \u6253\u5f00\u6587\u4ef6\u5939" \u9009\u62e9\u4e00\u4e2a\u76ee\u5f55\u3002');
      return;
    }

    setFilesSidebarEmptyState('\u5f53\u524d\u76ee\u5f55\u4e0b\u6ca1\u6709 .md\u3001.markdown \u6216 .txt \u6587\u4ef6\u3002');
    return;
  }

  filesSidebarEmpty.hidden = true;
  filesSidebarNotice.hidden = !directoryFilesNotice;
  filesSidebarNotice.textContent = directoryFilesNotice ?? '';
  filesSidebarList.hidden = false;
  const rows = flattenFileTreeRows(root);
  reconcileKeyedChildren(
    filesSidebarList,
    rows,
    (item) => item.key,
    createFileTreeRow,
    syncFileTreeRow,
    fileTreeRowNodeCache
  );
}

function updateFilesSidebarActiveState(): void {
  if (sidebarMode !== FILES_MODE) {
    return;
  }

  requestFilesSidebarRefresh();
}

function renderOutlineSidebar(): void {
  const activeDocument = getActiveDocument();

  if (!activeDocument) {
    currentOutlineActivePos = null;
    setOutlineSidebarEmptyState('\u5148\u6fc0\u6d3b\u4e00\u4e2a Markdown \u6587\u6863\uff0c\u518d\u67e5\u770b\u5927\u7eb2\u3002');
    return;
  }

  const outline = getMilkdownOutlineItems();

  if (outline.length === 0) {
    currentOutlineActivePos = null;
    setOutlineSidebarEmptyState('\u5f53\u524d\u6587\u6863\u8fd8\u6ca1\u6709\u53ef\u7528\u4e8e\u5927\u7eb2\u7684\u6807\u9898\u3002');
    return;
  }

  currentOutlineActivePos = getCurrentOutlineActivePos();
  outlineSidebarEmpty.hidden = true;
  outlineSidebarList.hidden = false;
  reconcileKeyedChildren(
    outlineSidebarList,
    outline,
    (item) => item.id,
    createOutlineItemButton,
    syncOutlineItemButton,
    outlineItemNodeCache
  );
}

function createOutlineItemButton(item: OutlineItem): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'outline-item';
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    scrollToOutlineItem(button);
  });
  button.addEventListener('click', (event) => {
    if (event.detail === 0) {
      scrollToOutlineItem(button);
    }
  });
  syncOutlineItemButton(button, item);
  return button;
}

function syncOutlineItemButton(button: HTMLButtonElement, item: OutlineItem): void {
  button.dataset.pos = String(item.pos);
  button.style.paddingLeft = `${10 + (item.level - 1) * 10}px`;
  button.textContent = item.text;
  button.classList.toggle('is-active', currentOutlineActivePos === item.pos);
}

function getCurrentOutlineActivePos(): number | null {
  if (!milkdownEditor || milkdownDocumentId !== activeDocumentId) {
    return null;
  }

  return milkdownEditor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const { selection } = view.state;

    if (selection.$from.parent.type.name !== 'heading') {
      return null;
    }

    return selection.$from.before();
  });
}

function updateOutlineActiveState(): void {
  currentOutlineActivePos = getCurrentOutlineActivePos();

  for (const button of outlineSidebarList.querySelectorAll<HTMLButtonElement>('.outline-item')) {
    const pos = Number(button.dataset.pos);
    button.classList.toggle('is-active', Number.isFinite(pos) && pos === currentOutlineActivePos);
  }
}

function scheduleOutlineActiveStateRefresh(documentId: string): void {
  window.requestAnimationFrame(() => {
    if (activeDocumentId === documentId && sidebarMode === OUTLINE_MODE) {
      updateOutlineActiveState();
    }
  });
}

function clearHeadingTargetHighlight(): void {
  if (highlightedHeadingClearTimer !== null) {
    window.clearTimeout(highlightedHeadingClearTimer);
    highlightedHeadingClearTimer = null;
  }

  highlightedHeadingElement?.classList.remove('is-outline-target');
  highlightedHeadingElement = null;
}

function highlightHeadingTarget(element: HTMLElement): void {
  clearHeadingTargetHighlight();

  if (prefersReducedMotion()) {
    return;
  }

  highlightedHeadingElement = element;
  highlightedHeadingElement.classList.add('is-outline-target');
  highlightedHeadingClearTimer = window.setTimeout(() => {
    highlightedHeadingElement?.classList.remove('is-outline-target');
    highlightedHeadingElement = null;
    highlightedHeadingClearTimer = null;
  }, HEADING_TARGET_HIGHLIGHT_MS);
}

function scrollEditorSurfaceToHeading(pos: number): void {
  const session = getActiveMilkdownSession();

  if (!session || !milkdownEditor || milkdownDocumentId !== activeDocumentId) {
    return;
  }

  milkdownEditor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const headingElement = view.nodeDOM(pos);

    if (!(headingElement instanceof HTMLElement)) {
      return;
    }

    const surfaceRect = session.surface.getBoundingClientRect();
    const headingRect = headingElement.getBoundingClientRect();
    const nextTop = session.surface.scrollTop + (headingRect.top - surfaceRect.top) - EDITOR_SCROLL_REVEAL_OFFSET;

    session.surface.scrollTo({
      top: Math.max(0, nextTop),
      behavior: prefersReducedMotion() ? 'auto' : 'smooth'
    });
    highlightHeadingTarget(headingElement);
  });
}

function scrollToOutlineItem(button: HTMLButtonElement): void {
  if (!milkdownEditor || milkdownDocumentId !== activeDocumentId) {
    return;
  }

  const pos = Number(button.dataset.pos);

  if (!Number.isFinite(pos)) {
    return;
  }

  milkdownEditor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const selectionPos = Math.min(pos + 1, view.state.doc.content.size);
    const tr = view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(selectionPos)));

    view.dispatch(tr);
    view.focus();
  });

  currentOutlineActivePos = pos;
  updateOutlineActiveState();
  window.requestAnimationFrame(() => {
    scrollEditorSurfaceToHeading(pos);
  });
}

function getMilkdownOutlineItems(): OutlineItem[] {
  if (!milkdownEditor || milkdownDocumentId !== activeDocumentId) {
    return [];
  }

  try {
    return milkdownEditor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const items: OutlineItem[] = [];
      let headingIndex = 0;

      view.state.doc.descendants((node, position) => {
        if (node.type.name !== 'heading') {
          return true;
        }

        const target = view.nodeDOM(position);
        const id =
          target instanceof HTMLElement && target.id.length > 0
            ? target.id
            : getHeadingId(node.attrs.id, headingIndex);

        items.push({
          id,
          level: normalizeHeadingLevel(node.attrs.level),
          pos: position,
          text: node.textContent.trim() || '\u65e0\u6807\u9898'
        });
        headingIndex += 1;
        return true;
      });

      return items;
    });
  } catch {
    return [];
  }
}

function normalizeHeadingLevel(value: unknown): 1 | 2 | 3 | 4 | 5 | 6 {
  const level = Number(value);

  if (Number.isInteger(level) && level >= 1 && level <= 6) {
    return level as 1 | 2 | 3 | 4 | 5 | 6;
  }

  return 1;
}

function getHeadingId(value: unknown, fallbackIndex: number): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  return `heading-${fallbackIndex}`;
}

function getHeadingLevelBadgeText(level: 1 | 2 | 3 | 4 | 5 | 6): string {
  return `h${level}`;
}

function getInlinePresetBadgeText(preset: InlineFormatPreset | null): string {
  switch (preset) {
    case 'strong':
      return 'B';
    case 'emphasis':
      return 'I';
    case 'strong-emphasis':
      return 'BI';
    case 'strike':
      return 'S';
    case 'inline-code':
      return '<>';
    case 'plain':
      return 'Tx';
    default:
      return 'Fmt';
  }
}

function getInlinePresetFromMarks(
  marks: readonly { type: { name: string } }[]
): InlineFormatPreset | null {
  let hasStrong = false;
  let hasEmphasis = false;
  let hasStrike = false;
  let hasInlineCode = false;

  for (const mark of marks) {
    switch (mark.type.name) {
      case 'strong':
        hasStrong = true;
        break;
      case 'em':
      case 'emphasis':
        hasEmphasis = true;
        break;
      case 'strike':
      case 'strikethrough':
      case 'strike_through':
        hasStrike = true;
        break;
      case 'code':
      case 'inline_code':
        hasInlineCode = true;
        break;
      default:
        break;
    }
  }

  if (hasInlineCode && (hasStrong || hasEmphasis || hasStrike)) {
    return null;
  }

  if (hasStrike && (hasStrong || hasEmphasis)) {
    return null;
  }

  if (hasInlineCode) {
    return 'inline-code';
  }

  if (hasStrong && hasEmphasis) {
    return 'strong-emphasis';
  }

  if (hasStrong) {
    return 'strong';
  }

  if (hasEmphasis) {
    return 'emphasis';
  }

  if (hasStrike) {
    return 'strike';
  }

  return 'plain';
}

function getInlinePresetForRange(
  doc: EditorView['state']['doc'],
  from: number,
  to: number
): InlineFormatPreset | null {
  let hasText = false;
  let activePreset: InlineFormatPreset | null | undefined;

  doc.nodesBetween(from, to, (node, position) => {
    if (!node.isText) {
      return true;
    }

    const nodeFrom = Math.max(from, position);
    const nodeTo = Math.min(to, position + node.nodeSize);

    if (nodeFrom >= nodeTo) {
      return false;
    }

    hasText = true;
    const nodePreset = getInlinePresetFromMarks(node.marks);

    if (activePreset === undefined) {
      activePreset = nodePreset;
      return false;
    }

    if (activePreset !== nodePreset) {
      activePreset = null;
    }

    return false;
  });

  if (!hasText) {
    return 'plain';
  }

  return activePreset ?? 'plain';
}

function getInlinePresetAtPosition(
  doc: EditorView['state']['doc'],
  pos: number
): InlineFormatPreset | null {
  const $pos = doc.resolve(pos);
  const marksAtPos = getInlinePresetFromMarks($pos.marks());

  if (marksAtPos && marksAtPos !== 'plain') {
    return marksAtPos;
  }

  if ($pos.nodeBefore?.isText) {
    const beforePreset = getInlinePresetFromMarks($pos.nodeBefore.marks);

    if (beforePreset && beforePreset !== 'plain') {
      return beforePreset;
    }
  }

  if ($pos.nodeAfter?.isText) {
    const afterPreset = getInlinePresetFromMarks($pos.nodeAfter.marks);

    if (afterPreset && afterPreset !== 'plain') {
      return afterPreset;
    }
  }

  return marksAtPos;
}

function getInlineRangeAtCursor(
  view: EditorView
): { from: number; to: number; preset: InlineFormatPreset | null } | null {
  const { selection, doc } = view.state;

  if (!selection.empty || selection.$from.parent.type.name !== 'paragraph') {
    return null;
  }

  const preset = getInlinePresetAtPosition(doc, selection.from);

  if (!preset || preset === 'plain') {
    return null;
  }

  const parentStart = selection.$from.start();
  const parentEnd = selection.$from.end();
  let from = selection.from;
  let to = selection.from;

  while (from > parentStart && getInlinePresetAtPosition(doc, from - 1) === preset) {
    from -= 1;
  }

  while (to < parentEnd && getInlinePresetAtPosition(doc, to) === preset) {
    to += 1;
  }

  if (from === to) {
    return null;
  }

  return {
    from,
    to,
    preset
  };
}

function setHeadingMarkerMenuContent(state: ActiveHeadingMarkerState): void {
  if (!headingMarkerMenu) {
    return;
  }

  headingMarkerMenu.replaceChildren();

  const appendLabel = (text: string) => {
    const label = document.createElement('div');
    label.className = 'format-menu-label';
    label.textContent = text;
    headingMarkerMenu?.append(label);
  };

  const appendDivider = () => {
    const divider = document.createElement('div');
    divider.className = 'format-menu-divider';
    headingMarkerMenu?.append(divider);
  };

  const appendOption = (
    text: string,
    isActive: boolean,
    onClick: () => void,
    className = 'heading-level-option'
  ) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = className;
    option.classList.toggle('is-active', isActive);
    option.setAttribute('role', 'menuitem');
    option.setAttribute('aria-pressed', String(isActive));
    option.textContent = text;
    option.addEventListener('click', onClick);
    headingMarkerMenu?.append(option);
  };

  if (state.kind === 'heading') {
    appendLabel(BLOCK_FORMAT_LABEL);
    appendOption(BODY_LABEL, false, () => {
      applyHeadingBlockSelection('paragraph');
    });

    HEADING_LEVEL_LABELS.forEach((label, index) => {
      const level = (index + 1) as 1 | 2 | 3 | 4 | 5 | 6;
      appendOption(`${getHeadingLevelBadgeText(level)} ${label}`, state.level === level, () => {
        applyHeadingBlockSelection(level);
      });
    });

    appendDivider();
    appendLabel(INLINE_FORMAT_LABEL);
  }

  (
    ['plain', 'strong', 'emphasis', 'strong-emphasis', 'strike', 'inline-code'] as InlineFormatPreset[]
  ).forEach((preset) => {
    appendOption(
      `${getInlinePresetBadgeText(preset)} ${INLINE_FORMAT_LABELS[preset]}`,
      state.inlinePreset === preset,
      () => {
        applyInlineFormatSelection(preset);
      },
      'inline-format-option'
    );
  });
}

function setHeadingMarkerMenuOpen(nextOpen: boolean): void {
  headingMarkerMenuOpen = nextOpen;

  if (!headingMarkerOverlay || !headingMarkerBadge || !headingMarkerMenu) {
    return;
  }

  headingMarkerOverlay.classList.toggle('is-open', nextOpen);
  headingMarkerBadge.setAttribute('aria-expanded', String(nextOpen));
  headingMarkerMenu.classList.toggle('is-hidden', !nextOpen);
}

function closeHeadingMarkerMenu(): void {
  setHeadingMarkerMenuOpen(false);
}

function handleHeadingMarkerWindowPointerDown(event: PointerEvent): void {
  if (!headingMarkerMenuOpen || !headingMarkerOverlay) {
    return;
  }

  if (event.target instanceof Node && headingMarkerOverlay.contains(event.target)) {
    return;
  }

  closeHeadingMarkerMenu();
}

function clearHeadingMarkerOverlay(): void {
  activeHeadingMarkerState = null;
  headingMarkerMenuOpen = false;

  if (!headingMarkerOverlay || !headingMarkerBadge || !headingMarkerMenu) {
    return;
  }

  headingMarkerOverlay.classList.add('is-hidden');
  headingMarkerOverlay.classList.remove('is-open');
  headingMarkerBadge.textContent = '';
  headingMarkerBadge.setAttribute('aria-expanded', 'false');
  headingMarkerMenu.classList.add('is-hidden');
  headingMarkerMenu.replaceChildren();
}

function renderHeadingMarkerOverlay(documentId: string): void {
  if (
    !milkdownEditor ||
    !milkdownHost ||
    !headingMarkerOverlay ||
    !headingMarkerBadge ||
    !headingMarkerMenu ||
    milkdownDocumentId !== documentId ||
    activeDocumentId !== documentId
  ) {
    clearHeadingMarkerOverlay();
    return;
  }

  const activeDocument = getActiveDocument();

  if (!activeDocument) {
    clearHeadingMarkerOverlay();
    return;
  }

  const view = milkdownEditor.action((ctx) => ctx.get(editorViewCtx));
  const selection = view.state.selection;
  let nextState: ActiveHeadingMarkerState | null = null;
  let nextTop = 0;
  let nextLeft = 0;
  let badgeText = '';
  let badgeLabel = '';

  if (selection.$from.parent.type.name === 'heading') {
    const headings = getMilkdownOutlineItems();
    syncDocumentHeadingStyles(activeDocument, headings);
    const headingPos = selection.$from.before();
    const heading = headings.find((item) => item.pos === headingPos);
    const headingElement = view.nodeDOM(headingPos);
    const headingNode = view.state.doc.nodeAt(headingPos);

    if (heading && headingElement instanceof HTMLElement && headingNode) {
      const nextStyle = getHeadingStyleForDocument(activeDocument, heading.id, heading.level);
      const headingFrom = headingPos + 1;
      const headingTo = headingPos + headingNode.nodeSize - 1;
      nextState = {
        documentId,
        kind: 'heading',
        headingId: heading.id,
        pos: heading.pos,
        level: heading.level,
        style: nextStyle,
        from: headingFrom,
        to: headingTo,
        inlinePreset: getInlinePresetForRange(view.state.doc, headingFrom, headingTo)
      };

      const hostBounds = milkdownHost.getBoundingClientRect();
      const headingBounds = headingElement.getBoundingClientRect();
      const topOffset = Math.max(0, (headingBounds.height - 24) / 2);
      nextTop = headingBounds.top - hostBounds.top + topOffset;
      nextLeft = Math.max(0, headingBounds.left - hostBounds.left - 38);
      badgeText = getHeadingLevelBadgeText(heading.level);
      badgeLabel = `\u5f53\u524d\u4e3a${HEADING_LEVEL_LABELS[heading.level - 1]}\uff0c\u70b9\u51fb\u4fee\u6539\u683c\u5f0f`;
    }
  } else if (
    selection.$from.parent.type.name === 'paragraph' &&
    selection.$from.sameParent(selection.$to)
  ) {
    const hostBounds = milkdownHost.getBoundingClientRect();

    if (!selection.empty) {
      const fromCoords = view.coordsAtPos(selection.from);
      nextState = {
        documentId,
        kind: 'inline',
        from: selection.from,
        to: selection.to,
        inlinePreset: getInlinePresetForRange(view.state.doc, selection.from, selection.to)
      };
      nextTop = Math.max(0, fromCoords.top - hostBounds.top - 30);
      nextLeft = Math.max(0, fromCoords.left - hostBounds.left);
      badgeText = getInlinePresetBadgeText(nextState.inlinePreset);
      badgeLabel = '\u70b9\u51fb\u4fee\u6539\u6587\u672c\u6837\u5f0f';
    } else {
      const inlineRange = getInlineRangeAtCursor(view);

      if (inlineRange) {
        const fromCoords = view.coordsAtPos(inlineRange.from);
        nextState = {
          documentId,
          kind: 'inline',
          from: inlineRange.from,
          to: inlineRange.to,
          inlinePreset: inlineRange.preset
        };
        nextTop = Math.max(0, fromCoords.top - hostBounds.top - 30);
        nextLeft = Math.max(0, fromCoords.left - hostBounds.left);
        badgeText = getInlinePresetBadgeText(inlineRange.preset);
        badgeLabel = '\u70b9\u51fb\u4fee\u6539\u6587\u672c\u6837\u5f0f';
      }
    }
  }

  if (!nextState) {
    clearHeadingMarkerOverlay();
    return;
  }

  if (
    activeHeadingMarkerState &&
    (activeHeadingMarkerState.kind !== nextState.kind ||
      activeHeadingMarkerState.documentId !== nextState.documentId)
  ) {
    headingMarkerMenuOpen = false;
  }

  activeHeadingMarkerState = nextState;
  headingMarkerOverlay.classList.remove('is-hidden');
  headingMarkerOverlay.style.top = `${nextTop}px`;
  headingMarkerOverlay.style.left = `${nextLeft}px`;
  headingMarkerBadge.textContent = badgeText;
  headingMarkerBadge.setAttribute('aria-label', badgeLabel);
  setHeadingMarkerMenuContent(nextState);
  setHeadingMarkerMenuOpen(headingMarkerMenuOpen);
}

function applyHeadingBlockSelection(nextBlock: 'paragraph' | (1 | 2 | 3 | 4 | 5 | 6)): void {
  if (
    !activeHeadingMarkerState ||
    activeHeadingMarkerState.kind !== 'heading' ||
    !milkdownEditor ||
    milkdownDocumentId !== activeHeadingMarkerState.documentId
  ) {
    return;
  }

  const markerState = activeHeadingMarkerState;
  const activeDocument = documents.find((item) => item.id === markerState.documentId);

  if (!activeDocument) {
    return;
  }

  const view = milkdownEditor.action((ctx) => ctx.get(editorViewCtx));
  const headingNode = view.state.doc.nodeAt(markerState.pos);
  const paragraphType = view.state.schema.nodes.paragraph;

  if (!headingNode || headingNode.type.name !== 'heading') {
    return;
  }

  closeHeadingMarkerMenu();

  if (nextBlock === 'paragraph') {
    if (!paragraphType) {
      return;
    }

    const tr = view.state.tr.setNodeMarkup(markerState.pos, paragraphType, null).scrollIntoView();
    tr.setSelection(TextSelection.near(tr.doc.resolve(markerState.pos + 1)));
    view.dispatch(tr);
    renderHeadingMarkerOverlay(activeDocument.id);
    requestSidebarRefreshForCurrentMode();
    view.focus();
    return;
  }

  const currentLevel = normalizeHeadingLevel(headingNode.attrs.level);
  const nextStyle = resolveHeadingStyleAfterLevelChange(markerState.style, nextBlock);
  const styleChanged = nextStyle !== markerState.style;
  const levelChanged = currentLevel !== nextBlock;

  if (!levelChanged && !styleChanged) {
    view.focus();
    renderHeadingMarkerOverlay(activeDocument.id);
    return;
  }

  updateDocumentHeadingStyle(activeDocument, markerState.headingId, nextStyle);

  if (levelChanged) {
    const tr = view.state.tr
      .setNodeMarkup(markerState.pos, undefined, {
        ...headingNode.attrs,
        level: nextBlock
      })
      .scrollIntoView();

    tr.setSelection(TextSelection.near(tr.doc.resolve(markerState.pos + 1)));

    view.dispatch(tr);
  } else if (styleChanged) {
    markMilkdownPendingChanges(activeDocument.id);
    syncActiveDocumentFromEditor();
  }

  renderHeadingMarkerOverlay(activeDocument.id);
  requestSidebarRefreshForCurrentMode();
  view.focus();
}

function getSupportedInlineMarkTypes(schema: EditorView['state']['schema']) {
  return {
    strong: schema.marks.strong ?? null,
    emphasis: schema.marks.emphasis ?? schema.marks.em ?? null,
    strike: schema.marks.strike_through ?? schema.marks.strikethrough ?? schema.marks.strike ?? null,
    inlineCode: schema.marks.code ?? schema.marks.inline_code ?? null
  };
}

function applyInlinePresetToTransaction(
  tr: EditorView['state']['tr'],
  schema: EditorView['state']['schema'],
  from: number,
  to: number,
  preset: InlineFormatPreset
): void {
  const markTypes = getSupportedInlineMarkTypes(schema);

  for (const markType of Object.values(markTypes)) {
    if (markType) {
      tr.removeMark(from, to, markType);
    }
  }

  switch (preset) {
    case 'strong':
      if (markTypes.strong) {
        tr.addMark(from, to, markTypes.strong.create());
      }
      break;
    case 'emphasis':
      if (markTypes.emphasis) {
        tr.addMark(from, to, markTypes.emphasis.create());
      }
      break;
    case 'strong-emphasis':
      if (markTypes.strong) {
        tr.addMark(from, to, markTypes.strong.create());
      }
      if (markTypes.emphasis) {
        tr.addMark(from, to, markTypes.emphasis.create());
      }
      break;
    case 'strike':
      if (markTypes.strike) {
        tr.addMark(from, to, markTypes.strike.create());
      }
      break;
    case 'inline-code':
      if (markTypes.inlineCode) {
        tr.addMark(from, to, markTypes.inlineCode.create());
      }
      break;
    case 'plain':
    default:
      break;
  }
}

function applyInlineFormatSelection(nextPreset: InlineFormatPreset): void {
  if (!activeHeadingMarkerState || !milkdownEditor || milkdownDocumentId !== activeHeadingMarkerState.documentId) {
    return;
  }

  const markerState = activeHeadingMarkerState;
  const activeDocument = documents.find((item) => item.id === markerState.documentId);

  if (!activeDocument) {
    return;
  }

  const view = milkdownEditor.action((ctx) => ctx.get(editorViewCtx));
  const { from, to } = markerState;

  closeHeadingMarkerMenu();

  if (from >= to) {
    view.focus();
    renderHeadingMarkerOverlay(activeDocument.id);
    return;
  }

  const tr = view.state.tr;
  applyInlinePresetToTransaction(tr, view.state.schema, from, to, nextPreset);

  if (!tr.docChanged) {
    view.focus();
    renderHeadingMarkerOverlay(activeDocument.id);
    return;
  }

  tr.scrollIntoView();
  view.dispatch(tr);
  renderHeadingMarkerOverlay(activeDocument.id);
  requestFilesSidebarRefresh();
  view.focus();
}

type MilkdownCommandKey<T = unknown> = {
  key: unknown;
};

type EditorCommandHandler = () => boolean;

function executeEditorCommandWithActiveSession(
  executor: (ctx: MilkdownCtxAccessor, view: EditorView, activeDocument: DocumentState) => boolean
): boolean {
  const activeDocument = getActiveDocument();
  const session = getActiveMilkdownSession();

  if (!activeDocument || !session || milkdownDocumentId !== activeDocument.id) {
    return false;
  }

  closeHeadingMarkerMenu();

  return session.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const result = executor(ctx as MilkdownCtxAccessor, view, activeDocument);

    if (!result) {
      return false;
    }

    requestSidebarRefreshForCurrentMode();
    renderHeadingMarkerOverlay(activeDocument.id);
    view.focus();
    return true;
  });
}

function executeRegisteredMilkdownCommand<T>(
  command: MilkdownCommandKey<T>,
  payload?: T
): boolean {
  return executeEditorCommandWithActiveSession((ctx) => {
    const commands = ctx.get<{ call: (slice: unknown, nextPayload?: unknown) => boolean }>(commandsCtx);

    return payload === undefined
      ? commands.call(command.key)
      : commands.call(command.key, payload);
  });
}

function setSelectionBlockType(nextBlock: 'paragraph' | (1 | 2 | 3 | 4 | 5 | 6)): boolean {
  return executeEditorCommandWithActiveSession((_ctx, view) => {
    const { selection, schema } = view.state;
    const tr = view.state.tr;

    if (nextBlock === 'paragraph') {
      const paragraphType = schema.nodes.paragraph;

      if (!paragraphType) {
        return false;
      }

      try {
        tr.setBlockType(selection.from, selection.to, paragraphType);
      } catch {
        return false;
      }
    } else {
      const headingType = schema.nodes.heading;

      if (!headingType) {
        return false;
      }

      try {
        tr.setBlockType(selection.from, selection.to, headingType, { level: nextBlock });
      } catch {
        return false;
      }
    }

    if (!tr.docChanged) {
      return false;
    }

    tr.scrollIntoView();
    view.dispatch(tr);
    return true;
  });
}

function changeCurrentHeadingLevel(delta: -1 | 1): boolean {
  return executeEditorCommandWithActiveSession((_ctx, view) => {
    const headingType = view.state.schema.nodes.heading;
    const { selection } = view.state;
    const { $from } = selection;

    if (!headingType || $from.parent.type !== headingType) {
      return false;
    }

    const currentLevel = normalizeHeadingLevel($from.parent.attrs.level);
    const nextLevel = Math.max(1, Math.min(6, currentLevel + delta)) as 1 | 2 | 3 | 4 | 5 | 6;

    if (nextLevel === currentLevel) {
      return false;
    }

    const tr = view.state.tr
      .setNodeMarkup($from.before(), undefined, {
        ...$from.parent.attrs,
        level: nextLevel
      })
      .scrollIntoView();

    view.dispatch(tr);
    return true;
  });
}

function toggleSelectionMark(
  markName: string,
  options: { clearMarks?: string[] } = {}
): boolean {
  return executeEditorCommandWithActiveSession((_ctx, view) => {
    const { schema, selection, doc } = view.state;

    if (selection.empty) {
      return false;
    }

    const markType = schema.marks[markName];

    if (!markType) {
      return false;
    }

    const { from, to } = selection;
    const tr = view.state.tr;
    const hasMark = doc.rangeHasMark(from, to, markType);

    if (hasMark) {
      tr.removeMark(from, to, markType);
    } else {
      for (const clearMarkName of options.clearMarks ?? []) {
        const clearMark = schema.marks[clearMarkName];

        if (clearMark && clearMark !== markType) {
          tr.removeMark(from, to, clearMark);
        }
      }

      tr.addMark(from, to, markType.create());
    }

    if (!tr.docChanged) {
      return false;
    }

    tr.scrollIntoView();
    view.dispatch(tr);
    return true;
  });
}

function getCurrentTableRect(view: EditorView) {
  if (!isInTable(view.state)) {
    return null;
  }

  try {
    return selectedRect(view.state);
  } catch {
    return null;
  }
}

function moveCurrentTableRow(delta: -1 | 1): boolean {
  return executeEditorCommandWithActiveSession((_ctx, view) => {
    const rect = getCurrentTableRect(view);

    if (!rect) {
      return false;
    }

    const from = rect.top;
    const to = from + delta;

    if (to < 0 || to >= rect.map.height) {
      return false;
    }

    return moveTableRow({ from, to })(view.state, view.dispatch, view);
  });
}

function moveCurrentTableColumn(delta: -1 | 1): boolean {
  return executeEditorCommandWithActiveSession((_ctx, view) => {
    const rect = getCurrentTableRect(view);

    if (!rect) {
      return false;
    }

    const from = rect.left;
    const to = from + delta;

    if (to < 0 || to >= rect.map.width) {
      return false;
    }

    return moveTableColumn({ from, to })(view.state, view.dispatch, view);
  });
}

const editorCommandHandlers = new Map<EditorCommandId, EditorCommandHandler>([
  [EDITOR_COMMAND_IDS.heading1, () => setSelectionBlockType(1)],
  [EDITOR_COMMAND_IDS.heading2, () => setSelectionBlockType(2)],
  [EDITOR_COMMAND_IDS.heading3, () => setSelectionBlockType(3)],
  [EDITOR_COMMAND_IDS.heading4, () => setSelectionBlockType(4)],
  [EDITOR_COMMAND_IDS.heading5, () => setSelectionBlockType(5)],
  [EDITOR_COMMAND_IDS.heading6, () => setSelectionBlockType(6)],
  [EDITOR_COMMAND_IDS.paragraph, () => setSelectionBlockType('paragraph')],
  [EDITOR_COMMAND_IDS.headingPromote, () => changeCurrentHeadingLevel(-1)],
  [EDITOR_COMMAND_IDS.headingDemote, () => changeCurrentHeadingLevel(1)],
  [EDITOR_COMMAND_IDS.blockquote, () => executeRegisteredMilkdownCommand(wrapInBlockquoteCommand)],
  [EDITOR_COMMAND_IDS.orderedList, () => executeRegisteredMilkdownCommand(wrapInOrderedListCommand)],
  [EDITOR_COMMAND_IDS.bulletList, () => executeRegisteredMilkdownCommand(wrapInBulletListCommand)],
  [EDITOR_COMMAND_IDS.codeBlock, () => executeRegisteredMilkdownCommand(createCodeBlockCommand)],
  [EDITOR_COMMAND_IDS.tableInsert, () => executeRegisteredMilkdownCommand(insertTableCommand)],
  [EDITOR_COMMAND_IDS.tableRowAbove, () => executeRegisteredMilkdownCommand(addRowBeforeCommand)],
  [EDITOR_COMMAND_IDS.tableRowBelow, () => executeRegisteredMilkdownCommand(addRowAfterCommand)],
  [EDITOR_COMMAND_IDS.tableColLeft, () => executeRegisteredMilkdownCommand(addColBeforeCommand)],
  [EDITOR_COMMAND_IDS.tableColRight, () => executeRegisteredMilkdownCommand(addColAfterCommand)],
  [EDITOR_COMMAND_IDS.tableRowUp, () => moveCurrentTableRow(-1)],
  [EDITOR_COMMAND_IDS.tableRowDown, () => moveCurrentTableRow(1)],
  [EDITOR_COMMAND_IDS.tableColMoveLeft, () => moveCurrentTableColumn(-1)],
  [EDITOR_COMMAND_IDS.tableColMoveRight, () => moveCurrentTableColumn(1)],
  [
    EDITOR_COMMAND_IDS.tableDeleteRow,
    () => executeEditorCommandWithActiveSession((_ctx, view) => deleteRow(view.state, view.dispatch))
  ],
  [
    EDITOR_COMMAND_IDS.tableDeleteCol,
    () => executeEditorCommandWithActiveSession((_ctx, view) => deleteColumn(view.state, view.dispatch))
  ],
  [
    EDITOR_COMMAND_IDS.tableDelete,
    () => executeEditorCommandWithActiveSession((_ctx, view) => deleteTable(view.state, view.dispatch))
  ],
  [EDITOR_COMMAND_IDS.inlineStrong, () => executeRegisteredMilkdownCommand(toggleStrongCommand)],
  [EDITOR_COMMAND_IDS.inlineEmphasis, () => executeRegisteredMilkdownCommand(toggleEmphasisCommand)],
  [EDITOR_COMMAND_IDS.inlineStrike, () => executeRegisteredMilkdownCommand(toggleStrikethroughCommand)],
  [EDITOR_COMMAND_IDS.inlineCode, () => executeRegisteredMilkdownCommand(toggleInlineCodeCommand)],
  [EDITOR_COMMAND_IDS.inlineHighlight, () => toggleSelectionMark('madoHighlight')],
  [
    EDITOR_COMMAND_IDS.inlineSuperscript,
    () => toggleSelectionMark('madoSuperscript', { clearMarks: ['madoSubscript'] })
  ],
  [
    EDITOR_COMMAND_IDS.inlineSubscript,
    () => toggleSelectionMark('madoSubscript', { clearMarks: ['madoSuperscript'] })
  ],
  [EDITOR_COMMAND_IDS.inlineKbd, () => toggleSelectionMark('madoKeyboard')]
]);

function executeEditorCommand(commandId: string): boolean {
  const typedCommandId = commandId as EditorCommandId;
  const unavailableMessage = getEditorCommandUnavailableMessage(typedCommandId);

  if (unavailableMessage) {
    showHeaderNotice(unavailableMessage, true);
    return false;
  }

  const handler = editorCommandHandlers.get(typedCommandId);

  if (!handler) {
    showHeaderNotice('\u8be5\u547d\u4ee4\u5f53\u524d\u672a\u5b9e\u73b0\u3002', true);
    return false;
  }

  const executed = handler();

  if (!executed) {
    showHeaderNotice('\u5f53\u524d\u4e0a\u4e0b\u6587\u65e0\u6cd5\u6267\u884c\u8be5\u64cd\u4f5c\u3002', true);
  }

  return executed;
}

const editorShortcutDefinitions: ShortcutDefinition[] = [
  { commandId: EDITOR_COMMAND_IDS.heading1, key: '1', ctrl: true, shift: false, alt: false },
  { commandId: EDITOR_COMMAND_IDS.heading2, key: '2', ctrl: true, shift: false, alt: false },
  { commandId: EDITOR_COMMAND_IDS.heading3, key: '3', ctrl: true, shift: false, alt: false },
  { commandId: EDITOR_COMMAND_IDS.heading4, key: '4', ctrl: true, shift: false, alt: false },
  { commandId: EDITOR_COMMAND_IDS.heading5, key: '5', ctrl: true, shift: false, alt: false },
  { commandId: EDITOR_COMMAND_IDS.heading6, key: '6', ctrl: true, shift: false, alt: false },
  { commandId: EDITOR_COMMAND_IDS.paragraph, key: '0', ctrl: true, shift: false, alt: false },
  { commandId: EDITOR_COMMAND_IDS.headingPromote, code: 'Equal', ctrl: true, shift: false, alt: false },
  { commandId: EDITOR_COMMAND_IDS.headingDemote, code: 'Minus', ctrl: true, shift: false, alt: false },
  { commandId: EDITOR_COMMAND_IDS.blockquote, key: 'q', ctrl: true, shift: true, alt: false },
  { commandId: EDITOR_COMMAND_IDS.orderedList, code: 'BracketLeft', ctrl: true, shift: true, alt: false },
  { commandId: EDITOR_COMMAND_IDS.bulletList, code: 'BracketRight', ctrl: true, shift: true, alt: false },
  { commandId: EDITOR_COMMAND_IDS.codeBlock, key: 'k', ctrl: true, shift: true, alt: false },
  { commandId: EDITOR_COMMAND_IDS.tableInsert, key: 't', ctrl: true, shift: false, alt: false },
  { commandId: EDITOR_COMMAND_IDS.tableRowBelow, key: 'Enter', ctrl: true, shift: false, alt: false },
  { commandId: EDITOR_COMMAND_IDS.tableRowUp, key: 'ArrowUp', ctrl: false, shift: false, alt: true },
  { commandId: EDITOR_COMMAND_IDS.tableRowDown, key: 'ArrowDown', ctrl: false, shift: false, alt: true },
  { commandId: EDITOR_COMMAND_IDS.tableColMoveLeft, key: 'ArrowLeft', ctrl: false, shift: false, alt: true },
  { commandId: EDITOR_COMMAND_IDS.tableColMoveRight, key: 'ArrowRight', ctrl: false, shift: false, alt: true },
  { commandId: EDITOR_COMMAND_IDS.inlineStrong, key: 'b', ctrl: true, shift: false, alt: false },
  { commandId: EDITOR_COMMAND_IDS.inlineEmphasis, key: 'i', ctrl: true, shift: false, alt: false },
  { commandId: EDITOR_COMMAND_IDS.inlineStrike, code: 'Digit5', ctrl: false, shift: true, alt: true },
  { commandId: EDITOR_COMMAND_IDS.inlineCode, code: 'Backquote', ctrl: true, shift: true, alt: false }
];

const fileShortcutDefinitions: FileShortcutDefinition[] = [
  { command: { type: 'newFile' }, key: 'n', ctrl: true, shift: false, alt: false },
  { command: { type: 'openFile' }, key: 'o', ctrl: true, shift: false, alt: false },
  { command: { type: 'saveFile' }, key: 's', ctrl: true, shift: false, alt: false },
  { command: { type: 'saveAsFile' }, key: 's', ctrl: true, shift: true, alt: false },
  { command: { type: 'closeFile' }, key: 'w', ctrl: true, shift: false, alt: false }
];

const editShortcutDefinitions: EditShortcutDefinition[] = [
  { commandId: 'undo', key: 'z', ctrl: true, shift: false, alt: false },
  { commandId: 'redo', key: 'y', ctrl: true, shift: false, alt: false },
  { commandId: 'find', key: 'f', ctrl: true, shift: false, alt: false },
  { commandId: 'replace', key: 'h', ctrl: true, shift: false, alt: false }
];

function getShortcutEventTargetElement(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) {
    return target;
  }

  if (target instanceof Node) {
    return target.parentElement;
  }

  return null;
}

function isBlockingGlobalShortcutTarget(target: EventTarget | null): boolean {
  if (!renameOverlay.classList.contains('is-hidden')) {
    return true;
  }

  const element = getShortcutEventTargetElement(target);

  if (!element) {
    return false;
  }

  if (element.closest('.milkdown-host')) {
    return false;
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return true;
  }

  if (element.isContentEditable) {
    return true;
  }

  return false;
}

function normalizeShortcutEventKey(event: KeyboardEvent): string {
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

function matchesShortcut(event: KeyboardEvent, definition: ShortcutBinding): boolean {
  if (
    event.ctrlKey !== definition.ctrl ||
    event.shiftKey !== definition.shift ||
    event.altKey !== definition.alt ||
    event.metaKey
  ) {
    return false;
  }

  if (definition.code) {
    return event.code === definition.code;
  }

  if (!definition.key) {
    return false;
  }

  return normalizeShortcutEventKey(event) === definition.key;
}

function findMatchingFileShortcut(event: KeyboardEvent): FileShortcutDefinition | null {
  for (const shortcut of fileShortcutDefinitions) {
    if (matchesShortcut(event, shortcut)) {
      return shortcut;
    }
  }

  return null;
}

function findMatchingEditorShortcut(event: KeyboardEvent): ShortcutDefinition | null {
  for (const shortcut of editorShortcutDefinitions) {
    if (matchesShortcut(event, shortcut)) {
      return shortcut;
    }
  }

  return null;
}

function findMatchingEditShortcut(event: KeyboardEvent): EditShortcutDefinition | null {
  for (const shortcut of editShortcutDefinitions) {
    if (matchesShortcut(event, shortcut)) {
      return shortcut;
    }
  }

  return null;
}

function canHandleEditorShortcutEvent(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing) {
    return false;
  }

  if (editorViewMode !== 'rendered') {
    return false;
  }

  if (!getActiveDocument() || !getActiveMilkdownSession()) {
    return false;
  }

  if (isBlockingGlobalShortcutTarget(event.target)) {
    return false;
  }

  return true;
}

function canHandleFileShortcutEvent(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing) {
    return false;
  }

  if (isBlockingGlobalShortcutTarget(event.target)) {
    return false;
  }

  return true;
}

function isBlockingEditShortcutTarget(target: EventTarget | null): boolean {
  if (!renameOverlay.classList.contains('is-hidden')) {
    return true;
  }

  const element = getShortcutEventTargetElement(target);

  if (!element) {
    return false;
  }

  if (element === sourceTextarea || element.closest('.milkdown-host')) {
    return false;
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return true;
  }

  if (element.isContentEditable) {
    return true;
  }

  return false;
}

function canHandleEditShortcutEvent(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing) {
    return false;
  }

  if (isBlockingEditShortcutTarget(event.target)) {
    return false;
  }

  return true;
}

function getAppCommandDedupKey(command: Exclude<AppCommandPayload, { type: 'openRecentFile' }>): string {
  if (command.type === 'editorCommand') {
    return `editor:${command.commandId}`;
  }

  if (command.type === 'editCommand') {
    return `edit:${command.commandId}`;
  }

  return `app:${command.type}`;
}

function markKeyboardCommandInvocation(command: Exclude<AppCommandPayload, { type: 'openRecentFile' }>): void {
  lastKeyboardCommandInvocation = {
    key: getAppCommandDedupKey(command),
    timestamp: performance.now()
  };
}

function shouldIgnoreNativeMenuCommand(command: AppCommandPayload, source: AppCommandSource): boolean {
  if (source !== 'native-menu' || !lastKeyboardCommandInvocation || command.type === 'openRecentFile') {
    return false;
  }

  return (
    lastKeyboardCommandInvocation.key === getAppCommandDedupKey(command) &&
    performance.now() - lastKeyboardCommandInvocation.timestamp <= EDITOR_COMMAND_DEDUP_WINDOW_MS
  );
}

function isAppCommandPayload(payload: unknown): payload is AppCommandPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;

  switch (candidate.type) {
    case 'newFile':
    case 'openFile':
    case 'openFolder':
    case 'saveFile':
    case 'saveAsFile':
    case 'renameFile':
    case 'closeFile':
    case 'clearRecentFiles':
      return true;
    case 'openRecentFile':
      return typeof candidate.path === 'string' && candidate.path.length > 0;
    case 'editCommand':
      return (
        (candidate.commandId === 'undo' ||
          candidate.commandId === 'redo' ||
          candidate.commandId === 'find' ||
          candidate.commandId === 'replace')
      );
    case 'editorCommand':
      return typeof candidate.commandId === 'string' && candidate.commandId.length > 0;
    default:
      return false;
  }
}

function executeSourceEditCommand(commandId: Extract<EditCommandId, 'undo' | 'redo'>): boolean {
  const activeDocument = getActiveDocument();

  if (!activeDocument || editorViewMode !== 'source') {
    return false;
  }

  const state = getSourceHistoryState(activeDocument.id, sourceTextarea.value);

  if (commandId === 'undo') {
    const nextContent = state.undoStack.pop();

    if (nextContent === undefined) {
      return false;
    }

    state.redoStack.push(state.snapshot);
    return applySourceDocumentChange(nextContent);
  }

  const nextContent = state.redoStack.pop();

  if (nextContent === undefined) {
    return false;
  }

  pushSourceUndoSnapshot(state, state.snapshot);
  return applySourceDocumentChange(nextContent);
}

function executeEditCommand(commandId: EditCommandId): boolean {
  const context = readCurrentEditorCommandContext();
  const activeDocument = context.activeDocument;

  switch (commandId) {
    case 'undo':
    case 'redo': {
      if (!activeDocument) {
        showHeaderNotice('\u5f53\u524d\u6ca1\u6709\u6fc0\u6d3b\u6587\u6863\u3002', true);
        return false;
      }

      if (commandId === 'undo' && !context.canUndo) {
        showHeaderNotice(
          editorViewMode === 'source'
            ? '\u5f53\u524d\u6ca1\u6709\u53ef\u64a4\u9500\u7684\u5185\u5bb9\u3002'
            : '\u5f53\u524d\u4e0a\u4e0b\u6587\u6ca1\u6709\u53ef\u64a4\u9500\u7684\u64cd\u4f5c\u3002',
          true
        );
        return false;
      }

      if (commandId === 'redo' && !context.canRedo) {
        showHeaderNotice(
          editorViewMode === 'source'
            ? '\u5f53\u524d\u6ca1\u6709\u53ef\u6062\u590d\u7684\u5185\u5bb9\u3002'
            : '\u5f53\u524d\u4e0a\u4e0b\u6587\u6ca1\u6709\u53ef\u6062\u590d\u7684\u64cd\u4f5c\u3002',
          true
        );
        return false;
      }

      const executed =
        editorViewMode === 'source'
          ? executeSourceEditCommand(commandId)
          : commandId === 'undo'
            ? executeEditorCommandWithActiveSession((_ctx, view) => undo(view.state, view.dispatch))
            : executeEditorCommandWithActiveSession((_ctx, view) => redo(view.state, view.dispatch));

      if (!executed) {
        const notice =
          editorViewMode === 'source'
            ? commandId === 'undo'
              ? '\u5f53\u524d\u6ca1\u6709\u53ef\u64a4\u9500\u7684\u5185\u5bb9\u3002'
              : '\u5f53\u524d\u6ca1\u6709\u53ef\u6062\u590d\u7684\u5185\u5bb9\u3002'
            : '\u5f53\u524d\u4e0a\u4e0b\u6587\u65e0\u6cd5\u6267\u884c\u8be5\u64cd\u4f5c\u3002';
        showHeaderNotice(notice, true);
      }

      return executed;
    }
    case 'find':
      if (!activeDocument) {
        showHeaderNotice('\u5f53\u524d\u6ca1\u6709\u6fc0\u6d3b\u6587\u6863\u3002', true);
        return false;
      }
      openFindReplaceBar('find');
      return true;
    case 'replace':
      if (!activeDocument) {
        showHeaderNotice('\u5f53\u524d\u6ca1\u6709\u6fc0\u6d3b\u6587\u6863\u3002', true);
        return false;
      }
      openFindReplaceBar('replace');
      return true;
  }
}

function getEditorCommandUnavailableMessage(commandId: EditorCommandId): string | null {
  const context = readCurrentEditorCommandContext();

  if (!context.activeDocument) {
    return '\u5f53\u524d\u6ca1\u6709\u6fc0\u6d3b\u6587\u6863\u3002';
  }

  if (editorViewMode !== 'rendered') {
    return '\u6bb5\u843d\u4e0e\u683c\u5f0f\u547d\u4ee4\u4ec5\u5728\u6e32\u67d3\u7f16\u8f91\u89c6\u56fe\u53ef\u7528\u3002';
  }

  if (!context.isRenderedReady) {
    return '\u5f53\u524d\u7f16\u8f91\u5668\u5c1a\u672a\u5c31\u7eea\u3002';
  }

  if (INLINE_SELECTION_COMMAND_IDS.has(commandId) && !context.hasSelection) {
    return '\u8bf7\u5148\u9009\u62e9\u4e00\u6bb5\u6587\u672c\uff0c\u518d\u6267\u884c\u8be5\u683c\u5f0f\u64cd\u4f5c\u3002';
  }

  if (
    (commandId === EDITOR_COMMAND_IDS.headingPromote ||
      commandId === EDITOR_COMMAND_IDS.headingDemote) &&
    !context.isInHeading
  ) {
    return '\u8bf7\u5148\u5c06\u5149\u6807\u653e\u5728\u6807\u9898\u4e2d\uff0c\u518d\u8c03\u6574\u6807\u9898\u7ea7\u522b\u3002';
  }

  if (TABLE_CONTEXT_COMMAND_IDS.has(commandId) && !context.isInTable) {
    return '\u8bf7\u5148\u5c06\u5149\u6807\u653e\u5728\u8868\u683c\u4e2d\uff0c\u518d\u6267\u884c\u8be5\u8868\u683c\u64cd\u4f5c\u3002';
  }

  return null;
}

async function dispatchAppCommand(
  command: AppCommandPayload,
  source: AppCommandSource
): Promise<void> {
  if (source === 'keyboard' && command.type !== 'openRecentFile') {
    markKeyboardCommandInvocation(command);
  }

  if (shouldIgnoreNativeMenuCommand(command, source)) {
    return;
  }

  if (source === 'native-menu' && (command.type === 'editCommand' || command.type === 'editorCommand')) {
    await waitForNativeMenuToClose();
    focusActiveCommandContext();
  }

  switch (command.type) {
    case 'newFile':
      handleNewFileRequest();
      return;
    case 'openFile':
      await handleOpenFileRequest();
      return;
    case 'openFolder':
      await handleOpenFolderRequest();
      return;
    case 'saveFile':
      await handleSaveRequest();
      return;
    case 'saveAsFile':
      await handleSaveAsRequest();
      return;
    case 'renameFile':
      await handleRenameRequest();
      return;
    case 'closeFile': {
      const activeDocument = getActiveDocument();

      if (activeDocument) {
        await closeDocument(activeDocument.id);
      }
      return;
    }
    case 'clearRecentFiles':
      recentFiles = [];
      persistRecentFiles();
      return;
    case 'openRecentFile':
      await openDocumentFromPath(command.path);
      return;
    case 'editCommand':
      executeEditCommand(command.commandId);
      return;
    case 'editorCommand':
      executeEditorCommand(command.commandId);
      return;
  }
}

function handleGlobalFileShortcut(event: KeyboardEvent): void {
  if (!canHandleFileShortcutEvent(event)) {
    return;
  }

  const shortcut = findMatchingFileShortcut(event);

  if (!shortcut) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  void dispatchAppCommand(shortcut.command, 'keyboard');
}

function handleGlobalEditShortcut(event: KeyboardEvent): void {
  if (!canHandleEditShortcutEvent(event)) {
    return;
  }

  const shortcut = findMatchingEditShortcut(event);

  if (!shortcut) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  void dispatchAppCommand(
    {
      type: 'editCommand',
      commandId: shortcut.commandId
    },
    'keyboard'
  );
}

function handleGlobalEditorShortcut(event: KeyboardEvent): void {
  if (!canHandleEditorShortcutEvent(event)) {
    return;
  }

  const shortcut = findMatchingEditorShortcut(event);

  if (!shortcut) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  void dispatchAppCommand(
    {
      type: 'editorCommand',
      commandId: shortcut.commandId
    },
    'keyboard'
  );
}

function createHeadingMarkerOverlay(
  host: HTMLDivElement,
  documentId: string
): {
  overlay: HTMLDivElement;
  badge: HTMLButtonElement;
  menu: HTMLDivElement;
} {
  const overlay = document.createElement('div');
  overlay.className = 'heading-marker-overlay is-hidden';

  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'heading-level-badge';
  badge.setAttribute('aria-haspopup', 'menu');
  badge.setAttribute('aria-expanded', 'false');
  badge.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    event.preventDefault();
  });
  badge.addEventListener('click', () => {
    if (!activeHeadingMarkerState || activeHeadingMarkerState.documentId !== documentId) {
      return;
    }

    setHeadingMarkerMenuOpen(!headingMarkerMenuOpen);
  });

  const menu = document.createElement('div');
  menu.className = 'heading-level-menu is-hidden';
  menu.setAttribute('role', 'menu');
  menu.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    event.preventDefault();
  });

  overlay.append(badge, menu);
  host.append(overlay);
  return { overlay, badge, menu };
}

function scheduleHeadingMarkerRefresh(documentId: string): void {
  window.requestAnimationFrame(() => {
    if (activeDocumentId === documentId) {
      renderHeadingMarkerOverlay(documentId);
    }
  });
}

function createTrailingCodeBlockExitPlugin(documentId: string): Plugin {
  return new Plugin({
    key: new PluginKey('TIAS_TRAILING_CODE_BLOCK_EXIT'),
    props: {
      handleKeyDown(view, event) {
        if (event.key !== 'ArrowDown' || !shouldExitTrailingCodeBlock(view)) {
          return false;
        }

        event.preventDefault();
        return moveSelectionAfterTrailingCodeBlock(view);
      }
    },
    appendTransaction(transactions) {
      if (transactions.some((tr) => tr.docChanged && tr.getMeta('addToHistory') !== false)) {
        markMilkdownPendingChanges(documentId);
      }

      return null;
    }
  });
}

function getTrailingCodeBlockInfo(view: EditorView): TrailingCodeBlockInfo | null {
  const { doc } = view.state;

  if (doc.childCount === 0) {
    return null;
  }

  const lastIndex = doc.childCount - 1;
  const lastNode = doc.child(lastIndex);

  if (lastNode.type.name !== 'code_block') {
    return null;
  }

  let pos = 0;

  for (let index = 0; index < lastIndex; index += 1) {
    pos += doc.child(index).nodeSize;
  }

  return {
    nodeSize: lastNode.nodeSize,
    pos,
    contentSize: lastNode.content.size
  };
}

function normalizeCodeBlockLanguage(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().toLowerCase();

  if (trimmed.length === 0) {
    return null;
  }

  return CODE_BLOCK_LANGUAGE_ALIASES[trimmed] ?? trimmed;
}

async function loadHighlightJsApi(): Promise<HighlightJsApi> {
  if (highlightJsApi) {
    return highlightJsApi;
  }

  if (!highlightJsLoadPromise) {
    highlightJsLoadPromise = import('highlight.js/lib/core').then((module) => {
      highlightJsApi = module.default as HighlightJsApi;
      return highlightJsApi;
    });
  }

  return highlightJsLoadPromise;
}

function scheduleCodeBlockHighlightRefresh(): void {
  if (codeBlockHighlightRefreshFrame !== null) {
    return;
  }

  codeBlockHighlightRefreshFrame = window.requestAnimationFrame(() => {
    codeBlockHighlightRefreshFrame = null;

    for (const view of Array.from(codeBlockHighlightViews)) {
      if (!view.dom.isConnected) {
        codeBlockHighlightViews.delete(view);
        continue;
      }

      view.dispatch(view.state.tr.setMeta(CODE_BLOCK_HIGHLIGHT_REFRESH_META, true));
    }
  });
}

async function ensureCodeBlockHighlightLanguage(language: string): Promise<boolean> {
  if (registeredHighlightLanguages.has(language)) {
    return true;
  }

  const existingLoad = pendingHighlightLanguageLoads.get(language);

  if (existingLoad) {
    return existingLoad;
  }

  const loader = CODE_BLOCK_HIGHLIGHT_LANGUAGE_LOADERS[language];

  if (!loader) {
    return false;
  }

  const loadTask = (async () => {
    try {
      const [api, languageModule] = await Promise.all([loadHighlightJsApi(), loader()]);

      if (!registeredHighlightLanguages.has(language)) {
        api.registerLanguage(language, languageModule.default);
        registeredHighlightLanguages.add(language);
      }

      scheduleCodeBlockHighlightRefresh();
      return true;
    } catch {
      return false;
    } finally {
      pendingHighlightLanguageLoads.delete(language);
    }
  })();

  pendingHighlightLanguageLoads.set(language, loadTask);
  return loadTask;
}

function collectCodeBlockLanguages(doc: EditorView['state']['doc']): string[] {
  const languages = new Set<string>();

  doc.descendants((node) => {
    if (node.type.name !== 'code_block') {
      return true;
    }

    const language = normalizeCodeBlockLanguage(node.attrs.language);

    if (language && CODE_BLOCK_HIGHLIGHT_LANGUAGE_LOADERS[language]) {
      languages.add(language);
    }

    return true;
  });

  return [...languages];
}

function requestCodeBlockHighlightSupport(doc: EditorView['state']['doc']): void {
  for (const language of collectCodeBlockLanguages(doc)) {
    if (!registeredHighlightLanguages.has(language) && !pendingHighlightLanguageLoads.has(language)) {
      void ensureCodeBlockHighlightLanguage(language);
    }
  }
}

function getCachedHighlightedMarkup(api: HighlightJsApi, language: string, text: string): string | null {
  const cacheKey = `${language}\u0000${text}`;
  const cached = codeBlockHighlightMarkupCache.get(cacheKey);

  if (cached !== undefined) {
    codeBlockHighlightMarkupCache.delete(cacheKey);
    codeBlockHighlightMarkupCache.set(cacheKey, cached);
    return cached;
  }

  try {
    const highlighted = api.highlight(text, {
      language,
      ignoreIllegals: true
    }).value;

    codeBlockHighlightMarkupCache.set(cacheKey, highlighted);

    while (codeBlockHighlightMarkupCache.size > CODE_BLOCK_HIGHLIGHT_CACHE_LIMIT) {
      const oldestKey = codeBlockHighlightMarkupCache.keys().next().value;

      if (!oldestKey) {
        break;
      }

      codeBlockHighlightMarkupCache.delete(oldestKey);
    }

    return highlighted;
  } catch {
    return null;
  }
}

function collectHighlightDecorationsFromNode(
  node: ChildNode,
  codeStart: number,
  offset: number,
  classNames: string[],
  decorations: Decoration[]
): number {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    const nextOffset = offset + text.length;

    if (text.length > 0 && classNames.length > 0) {
      decorations.push(
        Decoration.inline(codeStart + offset, codeStart + nextOffset, {
          class: [...new Set(classNames)].join(' ')
        })
      );
    }

    return nextOffset;
  }

  if (!(node instanceof HTMLElement)) {
    return offset;
  }

  const nextClassNames = [
    ...classNames,
    ...node.className
      .split(/\s+/)
      .map((name) => name.trim())
      .filter((name) => name.startsWith('hljs-'))
  ];

  let nextOffset = offset;

  for (const child of Array.from(node.childNodes)) {
    nextOffset = collectHighlightDecorationsFromNode(
      child,
      codeStart,
      nextOffset,
      nextClassNames,
      decorations
    );
  }

  return nextOffset;
}

function documentHasCodeBlockBetween(
  doc: EditorView['state']['doc'],
  from: number,
  to: number
): boolean {
  const docSize = doc.content.size;
  const start = Math.max(0, Math.min(from, docSize));
  const end = Math.max(start, Math.min(Math.max(from, to) + 1, docSize));
  let hasCodeBlock = false;

  doc.nodesBetween(start, end, (node) => {
    if (node.type.name === 'code_block') {
      hasCodeBlock = true;
      return false;
    }

    return true;
  });

  return hasCodeBlock;
}

function transactionTouchesCodeBlock(
  tr: Parameters<NonNullable<Plugin['spec']['state']>['apply']>[0],
  previousDoc: EditorView['state']['doc'],
  nextDoc: EditorView['state']['doc']
): boolean {
  let touchesCodeBlock = false;

  for (const map of tr.mapping.maps) {
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      if (touchesCodeBlock) {
        return;
      }

      if (
        documentHasCodeBlockBetween(previousDoc, oldStart, oldEnd) ||
        documentHasCodeBlockBetween(nextDoc, newStart, newEnd)
      ) {
        touchesCodeBlock = true;
      }
    });

    if (touchesCodeBlock) {
      break;
    }
  }

  return touchesCodeBlock;
}

function buildCodeBlockHighlightDecorations(doc: EditorView['state']['doc']): DecorationSet {
  requestCodeBlockHighlightSupport(doc);

  if (!highlightJsApi) {
    return DecorationSet.empty;
  }

  const decorations: Decoration[] = [];

  doc.descendants((node, position) => {
    if (node.type.name !== 'code_block') {
      return true;
    }

    const language = normalizeCodeBlockLanguage(node.attrs.language);

    if (
      !language ||
      node.textContent.length === 0 ||
      !registeredHighlightLanguages.has(language) ||
      !highlightJsApi?.getLanguage(language)
    ) {
      return true;
    }

    const highlighted = getCachedHighlightedMarkup(highlightJsApi, language, node.textContent);

    if (!highlighted) {
      return true;
    }

    const root = codeBlockHighlightParser.parseFromString(`<div>${highlighted}</div>`, 'text/html').body
      .firstElementChild;

    if (!root) {
      return true;
    }

    const codeStart = position + 1;
    let offset = 0;

    decorations.push(
      Decoration.node(position, position + node.nodeSize, {
        class: 'code-block-highlighted'
      })
    );

    for (const child of Array.from(root.childNodes)) {
      offset = collectHighlightDecorationsFromNode(child, codeStart, offset, [], decorations);
    }

    return true;
  });

  return DecorationSet.create(doc, decorations);
}

function createCodeBlockHighlightPlugin(): Plugin {
  const key = new PluginKey<DecorationSet>('TIAS_CODE_BLOCK_HIGHLIGHT');

  return new Plugin({
    key,
    state: {
      init: (_, state) => buildCodeBlockHighlightDecorations(state.doc),
      apply: (tr, previous, oldState) => {
        if (tr.getMeta(CODE_BLOCK_HIGHLIGHT_REFRESH_META)) {
          return buildCodeBlockHighlightDecorations(tr.doc);
        }

        if (!tr.docChanged) {
          return previous.map(tr.mapping, tr.doc);
        }

        if (!transactionTouchesCodeBlock(tr, oldState.doc, tr.doc)) {
          requestCodeBlockHighlightSupport(tr.doc);
          return previous.map(tr.mapping, tr.doc);
        }

        return buildCodeBlockHighlightDecorations(tr.doc);
      }
    },
    props: {
      decorations(state) {
        return key.getState(state) ?? DecorationSet.empty;
      }
    },
    view(view) {
      codeBlockHighlightViews.add(view);
      requestCodeBlockHighlightSupport(view.state.doc);

      return {
        update(updatedView, previousState) {
          if (updatedView.state.doc !== previousState.doc) {
            requestCodeBlockHighlightSupport(updatedView.state.doc);
          }
        },
        destroy() {
          codeBlockHighlightViews.delete(view);
        }
      };
    }
  });
}

function shouldExitTrailingCodeBlock(view: EditorView): boolean {
  const trailingCodeBlock = getTrailingCodeBlockInfo(view);

  if (!trailingCodeBlock) {
    return false;
  }

  const { selection } = view.state;

  return (
    selection.empty &&
    selection.$from.parent.type.name === 'code_block' &&
    selection.$from.pos >= trailingCodeBlock.pos + 1 &&
    selection.$from.parentOffset === trailingCodeBlock.contentSize
  );
}

function isClickBelowTrailingCodeBlock(
  view: EditorView,
  event: MouseEvent | PointerEvent,
  container: HTMLElement
): boolean {
  const trailingCodeBlock = getTrailingCodeBlockInfo(view);

  if (!trailingCodeBlock) {
    return false;
  }

  const lastElement = view.nodeDOM(trailingCodeBlock.pos);

  if (!(lastElement instanceof HTMLElement)) {
    return false;
  }

  const containerBounds = container.getBoundingClientRect();
  const lastBounds = lastElement.getBoundingClientRect();

  return (
    event.clientX >= containerBounds.left &&
    event.clientX <= containerBounds.right &&
    event.clientY > lastBounds.bottom &&
    event.clientY <= containerBounds.bottom
  );
}

function moveSelectionAfterTrailingCodeBlock(view: EditorView): boolean {
  const trailingCodeBlock = getTrailingCodeBlockInfo(view);
  const paragraphType = view.state.doc.type.schema.nodes.paragraph;

  if (!trailingCodeBlock || !paragraphType) {
    return false;
  }

  const insertPos = trailingCodeBlock.pos + trailingCodeBlock.nodeSize;
  const tr = view.state.tr.insert(insertPos, paragraphType.create());
  const selection = TextSelection.create(tr.doc, insertPos + 1);

  tr.setSelection(selection).scrollIntoView();
  view.dispatch(tr);
  view.focus();
  return true;
}

function handleTrailingCodeBlockPointerDown(event: PointerEvent, documentId: string): void {
  if (
    event.button !== 0 ||
    !milkdownEditor ||
    !milkdownHost ||
    milkdownDocumentId !== documentId ||
    activeDocumentId !== documentId
  ) {
    return;
  }

  const view = milkdownEditor.action((ctx) => ctx.get(editorViewCtx));

  if (!isClickBelowTrailingCodeBlock(view, event, milkdownHost)) {
    return;
  }

  event.preventDefault();
  moveSelectionAfterTrailingCodeBlock(view);
}

function renderOutlineSidebarIfVisible(): void {
  if (sidebarMode === OUTLINE_MODE) {
    requestOutlineSidebarRefresh();
  }
}

function renderSidebar(animateModeSwitch = false): void {
  clearPendingSidebarRender();
  ensureSidebarViewsMounted();
  rememberSidebarScrollPosition(sidebarVisibleMode);
  cancelOutlineSidebarRefresh();
  filesTab.classList.toggle('is-active', sidebarMode === FILES_MODE);
  outlineTab.classList.toggle('is-active', sidebarMode === OUTLINE_MODE);

  if (sidebarMode === FILES_MODE) {
    renderFilesSidebar();
  } else {
    renderOutlineSidebar();
  }

  restoreSidebarScrollPosition(sidebarMode);
  setSidebarViewState(sidebarMode, animateModeSwitch && sidebarVisibleMode !== sidebarMode);
  sidebarVisibleMode = sidebarMode;
}

function closeContextSubmenu(): void {
  contextSubmenuEntries = [];
  contextSubmenuAnchorElement = null;
  contextSubmenuPanel.classList.add('is-hidden');
  contextSubmenuPanel.replaceChildren();
}

function closeContextMenu(): void {
  contextMenuOpen = false;
  contextMenuEntries = [];
  contextMenuAnchorPoint = null;
  contextMenuLayer.classList.add('is-hidden');
  contextMenuPanel.replaceChildren();
  closeContextSubmenu();
}

function positionContextMenuPanel(panel: HTMLElement, x: number, y: number): void {
  panel.style.left = '0px';
  panel.style.top = '0px';
  panel.classList.remove('is-hidden');
  const { innerWidth, innerHeight } = window;
  const rect = panel.getBoundingClientRect();
  const nextLeft = Math.max(8, Math.min(x, innerWidth - rect.width - 8));
  const nextTop = Math.max(8, Math.min(y, innerHeight - rect.height - 8));
  panel.style.left = `${nextLeft}px`;
  panel.style.top = `${nextTop}px`;
}

function openContextSubmenu(anchor: HTMLElement, items: ContextMenuItem[]): void {
  contextSubmenuEntries = items;
  contextSubmenuAnchorElement = anchor;
  renderContextMenuPanel(contextSubmenuPanel, items);

  window.requestAnimationFrame(() => {
    if (!contextSubmenuAnchorElement) {
      return;
    }

    const anchorRect = contextSubmenuAnchorElement.getBoundingClientRect();
    const panelRect = contextSubmenuPanel.getBoundingClientRect();
    const openRight = anchorRect.right + panelRect.width + 8 <= window.innerWidth;
    const nextLeft = openRight
      ? anchorRect.right + 4
      : Math.max(8, anchorRect.left - panelRect.width - 4);
    const nextTop = Math.max(8, Math.min(anchorRect.top, window.innerHeight - panelRect.height - 8));
    contextSubmenuPanel.style.left = `${nextLeft}px`;
    contextSubmenuPanel.style.top = `${nextTop}px`;
  });
}

function createContextMenuButton(item: Extract<ContextMenuItem, { kind: 'item' }>): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'context-menu-item';
  button.disabled = item.enabled === false;
  button.classList.toggle('is-danger', Boolean(item.danger));
  button.classList.toggle('is-checked', Boolean(item.checked));

  const label = document.createElement('span');
  label.className = 'context-menu-label';
  label.textContent = item.label;

  const meta = document.createElement('span');
  meta.className = 'context-menu-meta';
  meta.textContent = item.submenu ? '›' : item.checked ? '√' : '';

  button.append(label, meta);

  if (item.submenu && item.submenu.length > 0) {
    button.addEventListener('pointerenter', () => {
      if (!button.disabled) {
        openContextSubmenu(button, item.submenu!);
      }
    });
  } else {
    button.addEventListener('pointerenter', () => {
      closeContextSubmenu();
    });
  }

  button.addEventListener('click', () => {
    if (button.disabled || item.submenu) {
      return;
    }

    closeContextMenu();
    void item.action?.();
  });

  return button;
}

function renderContextMenuPanel(panel: HTMLElement, items: ContextMenuItem[]): void {
  panel.replaceChildren();

  for (const item of items) {
    if (item.kind === 'separator') {
      const separator = document.createElement('div');
      separator.className = 'context-menu-separator';
      panel.append(separator);
      continue;
    }

    panel.append(createContextMenuButton(item));
  }
}

function openContextMenu(items: ContextMenuItem[], x: number, y: number): void {
  contextMenuEntries = items;
  contextMenuAnchorPoint = { x, y };
  contextMenuOpen = true;
  contextMenuLayer.classList.remove('is-hidden');
  renderContextMenuPanel(contextMenuPanel, items);
  closeContextSubmenu();

  window.requestAnimationFrame(() => {
    if (contextMenuOpen && contextMenuAnchorPoint) {
      positionContextMenuPanel(contextMenuPanel, contextMenuAnchorPoint.x, contextMenuAnchorPoint.y);
    }
  });
}

function isContextMenuEventTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('.context-menu-panel'));
}

function isPathWithinDirectory(filePath: string, directoryPath: string): boolean {
  const normalizedFilePath = filePath.toLowerCase();
  const normalizedDirectoryPath = directoryPath.toLowerCase();
  const separator = normalizedDirectoryPath.includes('\\') ? '\\' : '/';
  return (
    normalizedFilePath === normalizedDirectoryPath ||
    normalizedFilePath.startsWith(`${normalizedDirectoryPath}${separator}`)
  );
}

function getOpenDocumentsWithinPath(path: string): DocumentState[] {
  return documents.filter((document) => document.filePath && isPathWithinDirectory(document.filePath, path));
}

function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (path === oldPrefix) {
    return newPrefix;
  }

  const separator = oldPrefix.includes('\\') ? '\\' : '/';
  return path.replace(`${oldPrefix}${separator}`, `${newPrefix}${separator}`);
}

async function copyTextToClipboard(text: string, successNotice?: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);

    if (successNotice) {
      showHeaderNotice(successNotice);
    }
  } catch {
    showHeaderNotice('复制失败。', true);
  }
}

async function revealPath(path: string): Promise<void> {
  try {
    await invoke('reveal_path_in_explorer', { path });
  } catch (error) {
    showHeaderNotice(typeof error === 'string' ? error : '无法打开文件位置。', true);
  }
}

async function showPathProperties(path: string): Promise<void> {
  try {
    const properties = await invoke<PathPropertiesPayload>('get_path_properties', { path });
    const openDocument = documents.find((document) => document.filePath === path);
    showPropertiesDialog(properties, {
      isOpen: Boolean(openDocument),
      isDirty: openDocument ? isDocumentUnsaved(openDocument) : undefined
    });
  } catch (error) {
    showHeaderNotice(typeof error === 'string' ? error : '无法读取属性。', true);
  }
}

function getSidebarTargetDirectoryPath(target: SidebarContextTarget): string | null {
  switch (target.kind) {
    case 'file':
      return target.directoryPath;
    case 'folder':
      return target.path;
    case 'blank':
      return target.directoryPath;
  }
}

async function promptCreateMarkdownFile(directoryPath: string): Promise<void> {
  const fileName = await showRenameDialog({
    title: '新建文件',
    description: '输入要创建的 Markdown 文件名。',
    defaultValue: 'untitled.md',
    confirmText: '创建'
  });

  if (!fileName) {
    return;
  }

  try {
    const created = await invoke<OpenedDocument>('create_markdown_file_in_directory', {
      directoryPath,
      fileName
    });
    await refreshCurrentDirectoryFiles(currentDirectoryPath);
    await openDocumentFromPath(created.filePath, { reloadExisting: true, updateCurrentDirectory: false });
  } catch (error) {
    showHeaderNotice(typeof error === 'string' ? error : '创建文件失败。', true);
  }
}

async function promptCreateFolder(directoryPath: string): Promise<void> {
  const folderName = await showRenameDialog({
    title: '新建文件夹',
    description: '输入要创建的文件夹名称。',
    defaultValue: '新建文件夹',
    confirmText: '创建'
  });

  if (!folderName) {
    return;
  }

  try {
    await invoke<PathEntryPayload>('create_folder_in_directory', {
      directoryPath,
      folderName
    });
    await refreshCurrentDirectoryFiles(currentDirectoryPath);
  } catch (error) {
    showHeaderNotice(typeof error === 'string' ? error : '创建文件夹失败。', true);
  }
}

async function duplicateSidebarPath(path: string): Promise<void> {
  try {
    await invoke<PathEntryPayload>('duplicate_fs_entry', { path });
    await refreshCurrentDirectoryFiles(currentDirectoryPath);
  } catch (error) {
    showHeaderNotice(typeof error === 'string' ? error : '创建副本失败。', true);
  }
}

async function moveSidebarPathToRecycleBin(path: string): Promise<void> {
  const openDocuments = getOpenDocumentsWithinPath(path);

  if (openDocuments.some((document) => isDocumentUnsaved(document))) {
    showHeaderNotice('请先保存或关闭相关文档，再删除。', true);
    return;
  }

  const shouldDelete = window.confirm('确定将所选项目移到回收站吗？');

  if (!shouldDelete) {
    return;
  }

  for (const document of openDocuments) {
    await closeDocument(document.id);
  }

  try {
    await invoke('move_path_to_recycle_bin', { path });
    await refreshCurrentDirectoryFiles(currentDirectoryPath);
  } catch (error) {
    showHeaderNotice(typeof error === 'string' ? error : '删除失败。', true);
  }
}

function updateDocumentsAfterDirectoryRename(oldPath: string, newPath: string): void {
  for (const document of documents) {
    if (!document.filePath || !document.directoryPath) {
      continue;
    }

    if (isPathWithinDirectory(document.filePath, oldPath)) {
      document.filePath = replacePathPrefix(document.filePath, oldPath, newPath);
      document.directoryPath = replacePathPrefix(document.directoryPath, oldPath, newPath);
    }
  }

  if (currentDirectoryPath && isPathWithinDirectory(currentDirectoryPath, oldPath)) {
    currentDirectoryPath = replacePathPrefix(currentDirectoryPath, oldPath, newPath);
    persistCurrentDirectoryPath();
  }
}

async function renameSidebarFile(target: Extract<SidebarContextTarget, { kind: 'file' }>): Promise<void> {
  const renameResult = await showRenameDialog({
    title: '重命名文件',
    description: '修改当前文件名称。',
    defaultValue: target.fileName,
    confirmText: '重命名'
  });

  if (!renameResult) {
    return;
  }

  try {
    const renamed = await invoke<OpenedDocument>('rename_markdown_file', {
      path: target.filePath,
      newName: renameResult
    });
    const openDocument = documents.find((document) => document.filePath === target.filePath);

    if (openDocument) {
      applyRenamedDocumentState(openDocument, renamed);
    }

    await refreshCurrentDirectoryFiles(currentDirectoryPath);
    renderDocumentHeader();
    requestSidebarRefreshForCurrentMode();
  } catch (error) {
    showHeaderNotice(typeof error === 'string' ? error : '重命名失败。', true);
  }
}

async function renameSidebarFolder(target: Extract<SidebarContextTarget, { kind: 'folder' }>): Promise<void> {
  const renameResult = await showRenameDialog({
    title: target.isRoot ? '重命名根目录' : '重命名文件夹',
    description: '修改当前文件夹名称。',
    defaultValue: target.name,
    confirmText: '重命名'
  });

  if (!renameResult) {
    return;
  }

  try {
    const renamed = await invoke<RenamedDirectoryPayload>('rename_directory', {
      path: target.path,
      newName: renameResult
    });
    updateDocumentsAfterDirectoryRename(renamed.oldPath, renamed.newPath);
    await refreshCurrentDirectoryFiles(currentDirectoryPath);
    renderDocumentHeader();
    requestSidebarRefreshForCurrentMode();
  } catch (error) {
    showHeaderNotice(typeof error === 'string' ? error : '重命名文件夹失败。', true);
  }
}

function getEditorSelectionText(): string {
  return getSelectedSearchText();
}

async function performEditorCopy(): Promise<void> {
  const text = getEditorSelectionText();

  if (!text) {
    return;
  }

  await copyTextToClipboard(text);
}

async function performEditorCut(): Promise<void> {
  const text = getEditorSelectionText();

  if (!text) {
    return;
  }

  await copyTextToClipboard(text);

  if (editorViewMode === 'source') {
    const start = sourceTextarea.selectionStart;
    const end = sourceTextarea.selectionEnd;
    void applySourceDocumentChange(
      sourceTextarea.value.slice(0, start) + sourceTextarea.value.slice(end),
      { recordUndo: true, selectionStart: start, selectionEnd: start, scrollTop: sourceTextarea.scrollTop }
    );
    return;
  }

  executeEditorCommandWithActiveSession((_ctx, view) => {
    const { selection } = view.state;

    if (selection.empty) {
      return false;
    }

    view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
    return true;
  });
}

async function performEditorPaste(): Promise<void> {
  let text = '';

  try {
    text = await navigator.clipboard.readText();
  } catch {
    showHeaderNotice('无法读取剪贴板。', true);
    return;
  }

  if (!text) {
    return;
  }

  if (editorViewMode === 'source') {
    const start = sourceTextarea.selectionStart;
    const end = sourceTextarea.selectionEnd;
    void applySourceDocumentChange(
      sourceTextarea.value.slice(0, start) + text + sourceTextarea.value.slice(end),
      {
        recordUndo: true,
        selectionStart: start + text.length,
        selectionEnd: start + text.length,
        scrollTop: sourceTextarea.scrollTop
      }
    );
    return;
  }

  executeEditorCommandWithActiveSession((_ctx, view) => {
    const { from, to } = view.state.selection;
    view.dispatch(view.state.tr.insertText(text, from, to).scrollIntoView());
    return true;
  });
}

function performEditorSelectAll(): void {
  if (editorViewMode === 'source') {
    sourceTextarea.focus();
    sourceTextarea.select();
    return;
  }

  executeEditorCommandWithActiveSession((_ctx, view) => {
    const selection = TextSelection.create(view.state.doc, 0, view.state.doc.content.size);
    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
    return true;
  });
}

function resolveSidebarContextTarget(target: EventTarget | null): SidebarContextTarget {
  const element = getShortcutEventTargetElement(target);

  if (sidebarMode === OUTLINE_MODE) {
    return {
      kind: 'blank',
      directoryPath: currentDirectoryPath,
      sidebarMode: OUTLINE_MODE
    };
  }

  const row = element?.closest('.file-tree-row') as HTMLElement | null;

  if (!row) {
    return {
      kind: 'blank',
      directoryPath: currentDirectoryPath,
      sidebarMode
    };
  }

  const kind = row.dataset.kind as FileTreeNodeKind;

  if (kind === 'file') {
    return {
      kind: 'file',
      sidebarMode,
      filePath: row.dataset.filePath || '',
      documentId: row.dataset.documentId || null,
      directoryPath: getParentPathFromFilePath(row.dataset.filePath || '') ?? currentDirectoryPath ?? '',
      fileName: row.querySelector('.file-tree-label')?.textContent ?? row.dataset.filePath ?? ''
    };
  }

  return {
    kind: 'folder',
    sidebarMode,
    path: row.dataset.filePath || currentDirectoryPath || '',
    name: row.querySelector('.file-tree-label')?.textContent ?? getDirectoryLabel(currentDirectoryPath),
    isRoot: kind === 'root'
  };
}

function buildSidebarViewModeItems(): ContextMenuItem[] {
  return [
    {
      kind: 'item',
      label: '文档列表',
      checked: filesSidebarViewMode === 'list',
      action: () => {
        setSidebarMode(FILES_MODE);
        setFilesSidebarViewMode('list');
      }
    },
    {
      kind: 'item',
      label: '文档树',
      checked: filesSidebarViewMode === 'tree',
      action: () => {
        setSidebarMode(FILES_MODE);
        setFilesSidebarViewMode('tree');
      }
    }
  ];
}

function buildSidebarContextMenuItems(target: SidebarContextTarget): ContextMenuItem[] {
  if (target.sidebarMode === OUTLINE_MODE) {
    return [
      { kind: 'item', label: '搜索', action: () => openFilesSidebarSearch() },
      ...buildSidebarViewModeItems()
    ];
  }

  const directoryPath = getSidebarTargetDirectoryPath(target);
  const filePath = target.kind === 'file' ? target.filePath : target.kind === 'folder' ? target.path : target.directoryPath;
  const items: ContextMenuItem[] = [
    {
      kind: 'item',
      label: '打开',
      enabled: Boolean(filePath),
      action: async () => {
        if (!filePath) {
          return;
        }

        if (target.kind === 'file') {
          if (target.documentId) {
            await activateDocument(target.documentId);
          } else {
            await openDocumentFromPath(filePath, { updateCurrentDirectory: false });
          }
          return;
        }

        await setCurrentDirectoryPath(filePath);
      }
    },
    {
      kind: 'item',
      label: '在新窗口中打开',
      enabled: Boolean(filePath),
      action: async () => {
        if (!filePath) {
          return;
        }

        await openTargetInNewWindow(
          target.kind === 'file'
            ? { filePath, directoryPath: target.directoryPath }
            : { directoryPath: filePath }
        );
      }
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: '新建文件',
      enabled: Boolean(directoryPath),
      action: async () => {
        if (directoryPath) {
          await promptCreateMarkdownFile(directoryPath);
        }
      }
    },
    {
      kind: 'item',
      label: '新建文件夹',
      enabled: Boolean(directoryPath),
      action: async () => {
        if (directoryPath) {
          await promptCreateFolder(directoryPath);
        }
      }
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: '搜索',
      action: () => openFilesSidebarSearch()
    },
    ...buildSidebarViewModeItems(),
    { kind: 'separator' }
  ];

  if (target.kind !== 'blank') {
    items.push(
      {
        kind: 'item',
        label: '重命名',
        enabled: target.kind !== 'file' || Boolean(target.filePath || target.documentId),
        action: async () => {
          if (target.kind === 'file') {
            if (!target.filePath && target.documentId) {
              await activateDocument(target.documentId);
              await handleRenameRequest();
              return;
            }

            await renameSidebarFile(target);
          } else {
            await renameSidebarFolder(target);
          }
        }
      },
      {
        kind: 'item',
        label: '创建副本',
        enabled: Boolean(filePath),
        action: async () => {
          if (filePath) {
            await duplicateSidebarPath(filePath);
          }
        }
      },
      {
        kind: 'item',
        label: '删除',
        danger: true,
        enabled:
          (Boolean(filePath) || (target.kind === 'file' && Boolean(target.documentId))) &&
          !(target.kind === 'folder' && target.isRoot),
        action: async () => {
          if (target.kind === 'file' && !target.filePath && target.documentId) {
            await closeDocument(target.documentId);
            return;
          }

          if (filePath) {
            await moveSidebarPathToRecycleBin(filePath);
          }
        }
      },
      { kind: 'separator' },
      {
        kind: 'item',
        label: '属性',
        enabled: Boolean(filePath),
        action: async () => {
          if (filePath) {
            await showPathProperties(filePath);
          }
        }
      },
      {
        kind: 'item',
        label: '复制文件路径',
        enabled: Boolean(filePath),
        action: async () => {
          if (filePath) {
            await copyTextToClipboard(filePath, '已复制文件路径。');
          }
        }
      },
      {
        kind: 'item',
        label: '打开文件位置',
        enabled: Boolean(filePath),
        action: async () => {
          if (filePath) {
            await revealPath(filePath);
          }
        }
      }
    );
  }

  return items;
}

function buildParagraphContextItems(): ContextMenuItem[] {
  return [
    { kind: 'item', label: '正文', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.paragraph), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.paragraph) },
    { kind: 'item', label: '一级标题', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.heading1), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.heading1) },
    { kind: 'item', label: '二级标题', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.heading2), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.heading2) },
    { kind: 'item', label: '三级标题', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.heading3), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.heading3) },
    { kind: 'item', label: '四级标题', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.heading4), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.heading4) },
    { kind: 'item', label: '五级标题', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.heading5), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.heading5) },
    { kind: 'item', label: '六级标题', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.heading6), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.heading6) },
    { kind: 'separator' },
    { kind: 'item', label: '标题升级', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.headingPromote), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.headingPromote) },
    { kind: 'item', label: '标题降级', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.headingDemote), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.headingDemote) },
    { kind: 'separator' },
    { kind: 'item', label: '引用', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.blockquote), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.blockquote) },
    { kind: 'item', label: '有序列表', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.orderedList), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.orderedList) },
    { kind: 'item', label: '无序列表', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.bulletList), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.bulletList) },
    { kind: 'item', label: '代码块', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.codeBlock), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.codeBlock) },
    { kind: 'item', label: '插入表格', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableInsert), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableInsert) }
  ];
}

function buildFormatContextItems(): ContextMenuItem[] {
  return [
    { kind: 'item', label: '粗体', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineStrong), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineStrong) },
    { kind: 'item', label: '斜体', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineEmphasis), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineEmphasis) },
    { kind: 'item', label: '删除线', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineStrike), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineStrike) },
    { kind: 'item', label: '行内代码', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineCode), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineCode) },
    { kind: 'item', label: '高亮', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineHighlight), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineHighlight) },
    { kind: 'item', label: '上标', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineSuperscript), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineSuperscript) },
    { kind: 'item', label: '下标', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineSubscript), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineSubscript) },
    { kind: 'item', label: '按键', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineKbd), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineKbd) }
  ];
}

function buildTableContextItems(): ContextMenuItem[] {
  return [
    { kind: 'item', label: '上方插入行', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableRowAbove), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableRowAbove) },
    { kind: 'item', label: '下方插入行', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableRowBelow), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableRowBelow) },
    { kind: 'item', label: '左侧插入列', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableColLeft), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableColLeft) },
    { kind: 'item', label: '右侧插入列', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableColRight), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableColRight) },
    { kind: 'separator' },
    { kind: 'item', label: '行上移', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableRowUp), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableRowUp) },
    { kind: 'item', label: '行下移', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableRowDown), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableRowDown) },
    { kind: 'item', label: '列左移', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableColMoveLeft), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableColMoveLeft) },
    { kind: 'item', label: '列右移', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableColMoveRight), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableColMoveRight) },
    { kind: 'separator' },
    { kind: 'item', label: '删除行', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableDeleteRow), danger: true, action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableDeleteRow) },
    { kind: 'item', label: '删除列', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableDeleteCol), danger: true, action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableDeleteCol) },
    { kind: 'item', label: '删除表格', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableDelete), danger: true, action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableDelete) }
  ];
}

function buildEditorContextMenuItems(): ContextMenuItem[] {
  const context = readCurrentEditorCommandContext();
  const hasSelection = editorViewMode === 'source'
    ? sourceTextarea.selectionStart !== sourceTextarea.selectionEnd
    : context.hasSelection;
  const items: ContextMenuItem[] = [
    { kind: 'item', label: '撤销', enabled: context.canUndo, action: () => executeEditCommand('undo') },
    { kind: 'item', label: '恢复', enabled: context.canRedo, action: () => executeEditCommand('redo') },
    { kind: 'separator' },
    { kind: 'item', label: '剪切', enabled: hasSelection, action: async () => performEditorCut() },
    { kind: 'item', label: '复制', enabled: hasSelection, action: async () => performEditorCopy() },
    { kind: 'item', label: '粘贴', action: async () => performEditorPaste() },
    { kind: 'item', label: '全选', action: () => performEditorSelectAll() },
    { kind: 'separator' },
    { kind: 'item', label: '查找', enabled: Boolean(context.activeDocument), action: () => executeEditCommand('find') },
    { kind: 'item', label: '替换', enabled: Boolean(context.activeDocument), action: () => executeEditCommand('replace') }
  ];

  if (editorViewMode === 'rendered') {
    items.push(
      { kind: 'separator' },
      { kind: 'item', label: '段落', submenu: buildParagraphContextItems() },
      { kind: 'item', label: '格式', submenu: buildFormatContextItems() }
    );

    if (context.isInTable) {
      items.push({ kind: 'item', label: '表格', submenu: buildTableContextItems() });
    }
  }

  return items;
}

function handleSidebarContextMenu(event: MouseEvent): void {
  event.preventDefault();
  const target = resolveSidebarContextTarget(event.target);
  openContextMenu(buildSidebarContextMenuItemsCurrent(target), event.clientX, event.clientY);
}

function handleEditorContextMenu(event: MouseEvent): void {
  event.preventDefault();

  if (editorViewMode === 'rendered') {
    const session = getActiveMilkdownSession();

    if (session) {
      try {
        session.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const position = view.posAtCoords({ left: event.clientX, top: event.clientY });

          if (position && view.state.selection.empty) {
            const selection = TextSelection.near(view.state.doc.resolve(position.pos));
            view.dispatch(view.state.tr.setSelection(selection));
          }
        });
      } catch {
        // Keep the current selection when the click position cannot be resolved.
      }
    }
  }

  openContextMenu(buildEditorContextMenuItemsFinal(), event.clientX, event.clientY);
}

function buildSidebarContextMenuItemsCurrent(target: SidebarContextTarget): ContextMenuItem[] {
  const refreshItem: ContextMenuItem = {
    kind: 'item',
    label: '刷新',
    enabled: Boolean(currentDirectoryPath),
    action: async () => {
      if (currentDirectoryPath) {
        await refreshCurrentDirectoryFiles(currentDirectoryPath);
      }
    }
  };

  if (target.sidebarMode === OUTLINE_MODE) {
    return [
      { kind: 'item', label: '搜索', action: () => openFilesSidebarSearch() },
      refreshItem
    ];
  }

  const directoryPath = getSidebarTargetDirectoryPath(target);
  const filePath =
    target.kind === 'file' ? target.filePath : target.kind === 'folder' ? target.path : target.directoryPath;
  const items: ContextMenuItem[] = [
    {
      kind: 'item',
      label: '新建文件',
      enabled: Boolean(directoryPath),
      action: async () => {
        if (directoryPath) {
          await promptCreateMarkdownFileFinal(directoryPath);
        }
      }
    },
    {
      kind: 'item',
      label: '新建文件夹',
      enabled: Boolean(directoryPath),
      action: async () => {
        if (directoryPath) {
          await promptCreateFolderFinal(directoryPath);
        }
      }
    },
    { kind: 'separator' },
    { kind: 'item', label: '搜索', action: () => openFilesSidebarSearch() },
    refreshItem
  ];

  if (target.kind !== 'blank') {
    items.push(
      { kind: 'separator' },
      {
        kind: 'item',
        label: '重命名',
        enabled: target.kind !== 'file' || Boolean(target.filePath || target.documentId),
        action: async () => {
          if (target.kind === 'file') {
            if (!target.filePath && target.documentId) {
              await activateDocument(target.documentId);
              await handleRenameRequest();
              return;
            }

            await renameSidebarFileFinal(target);
            return;
          }

          await renameSidebarFolderFinal(target);
        }
      },
      {
        kind: 'item',
        label: '创建副本',
        enabled: Boolean(filePath),
        action: async () => {
          if (filePath) {
            await duplicateSidebarPathFinal(filePath);
          }
        }
      },
      {
        kind: 'item',
        label: '删除',
        danger: true,
        enabled:
          (Boolean(filePath) || (target.kind === 'file' && Boolean(target.documentId))) &&
          !(target.kind === 'folder' && target.isRoot),
        action: async () => {
          if (target.kind === 'file' && !target.filePath && target.documentId) {
            await closeDocument(target.documentId);
            return;
          }

          if (filePath) {
            await moveSidebarPathToRecycleBinFinal(filePath);
          }
        }
      },
      {
        kind: 'item',
        label: '复制文件路径',
        enabled: Boolean(filePath),
        action: async () => {
          if (filePath) {
            await copyTextToClipboard(filePath, '已复制文件路径。');
          }
        }
      },
      {
        kind: 'item',
        label: '打开文件位置',
        enabled: Boolean(filePath),
        action: async () => {
          if (filePath) {
            await revealPath(filePath);
          }
        }
      }
    );
  }

  return items;
}

async function openTargetInNewWindow(options: {
  filePath?: string | null;
  directoryPath?: string | null;
}): Promise<void> {
  void options;
  showHeaderNotice('“在新窗口打开”已移除。', true);
}

async function openTargetInNewWindowFinal(options: {
  filePath?: string | null;
  directoryPath?: string | null;
}): Promise<void> {
  void options;
  showHeaderNotice('“在新窗口打开”已移除。', true);
  return;
  try {
    await invoke('open_in_new_window', {
      payload: {
        filePath: options.filePath ?? null,
        directoryPath: options.directoryPath ?? null
      }
    });
  } catch (error) {
    showHeaderNotice(getErrorMessage(error, '无法在新窗口中打开。'), true);
  }
}

async function promptCreateMarkdownFileFinal(directoryPath: string): Promise<void> {
  const fileName = await showRenameDialog({
    title: '新建文件',
    description: '输入要创建的 Markdown 文件名。',
    defaultValue: 'untitled.md',
    confirmText: '创建',
    normalizeValue: async (value) =>
      await invoke<string>('validate_markdown_file_name', {
        newName: value
      })
  });

  if (!fileName) {
    return;
  }

  try {
    const created = await invoke<OpenedDocument>('create_markdown_file_in_directory', {
      directoryPath,
      fileName
    });
    await refreshCurrentDirectoryFiles(currentDirectoryPath);
    await openDocumentFromPath(created.filePath, {
      reloadExisting: true,
      updateCurrentDirectory: false
    });
  } catch (error) {
    showHeaderNotice(getErrorMessage(error, '创建文件失败。'), true);
  }
}

async function promptCreateFolderFinal(directoryPath: string): Promise<void> {
  const folderName = await showRenameDialog({
    title: '新建文件夹',
    description: '输入要创建的文件夹名称。',
    defaultValue: '新建文件夹',
    confirmText: '创建',
    normalizeValue: async (value) => value
  });

  if (!folderName) {
    return;
  }

  try {
    const created = await invoke<PathEntryPayload>('create_folder_in_directory', {
      directoryPath,
      folderName
    });
    await refreshCurrentDirectoryFiles(currentDirectoryPath);
    showHeaderNotice(`已创建文件夹：${created.name}`);
  } catch (error) {
    showHeaderNotice(getErrorMessage(error, '创建文件夹失败。'), true);
  }
}

async function duplicateSidebarPathFinal(path: string): Promise<void> {
  try {
    const duplicated = await invoke<PathEntryPayload>('duplicate_fs_entry', { path });
    await refreshCurrentDirectoryFiles(currentDirectoryPath);

    if (duplicated.isDirectory) {
      showHeaderNotice(`已创建副本：${duplicated.name}`);
      return;
    }

    showHeaderNotice(`已创建副本：${duplicated.name}`);
    await openDocumentFromPath(duplicated.path, {
      reloadExisting: true,
      updateCurrentDirectory: false
    });
  } catch (error) {
    showHeaderNotice(getErrorMessage(error, '创建副本失败。'), true);
  }
}

async function moveSidebarPathToRecycleBinFinal(path: string): Promise<void> {
  const openDocuments = getOpenDocumentsWithinPath(path);

  if (openDocuments.some((document) => isDocumentUnsaved(document))) {
    showHeaderNotice('请先保存或关闭相关文档，再删除。', true);
    return;
  }

  const itemName = getFileNameFromPath(path);
  const extraNote =
    openDocuments.length > 0 ? `\n\n相关已打开文档会先关闭：${openDocuments.length} 个。` : '';
  const shouldDelete = await showDeleteConfirmDialog({
    title: '确认删除',
    description: `确定将“${itemName}”移到回收站吗？${extraNote}`,
    confirmText: '删除'
  });

  if (!shouldDelete) {
    return;
  }

  for (const document of openDocuments) {
    await closeDocument(document.id);
  }

  try {
    await invoke('move_path_to_recycle_bin', { path });
    await refreshCurrentDirectoryFiles(currentDirectoryPath);
  } catch (error) {
    showHeaderNotice(getErrorMessage(error, '删除失败。'), true);
  }
}

async function renameSidebarFileFinal(
  target: Extract<SidebarContextTarget, { kind: 'file' }>
): Promise<void> {
  const renameResult = await showRenameDialog({
    title: '重命名文件',
    description: '修改当前文件名称。',
    defaultValue: target.fileName,
    confirmText: '重命名',
    normalizeValue: async (value) =>
      await invoke<string>('validate_markdown_file_name', {
        newName: value
      })
  });

  if (!renameResult) {
    return;
  }

  try {
    const renamed = await invoke<OpenedDocument>('rename_markdown_file', {
      path: target.filePath,
      newName: renameResult
    });
    const openDocument = documents.find((document) => document.filePath === target.filePath);

    if (openDocument) {
      applyRenamedDocumentState(openDocument, renamed);
    }

    await refreshCurrentDirectoryFiles(currentDirectoryPath);
    renderDocumentHeader();
    requestSidebarRefreshForCurrentMode();
  } catch (error) {
    showHeaderNotice(getErrorMessage(error, '重命名失败。'), true);
  }
}

async function renameSidebarFolderFinal(
  target: Extract<SidebarContextTarget, { kind: 'folder' }>
): Promise<void> {
  const renameResult = await showRenameDialog({
    title: target.isRoot ? '重命名根目录' : '重命名文件夹',
    description: '修改当前文件夹名称。',
    defaultValue: target.name,
    confirmText: '重命名',
    normalizeValue: async (value) => value
  });

  if (!renameResult) {
    return;
  }

  try {
    const renamed = await invoke<RenamedDirectoryPayload>('rename_directory', {
      path: target.path,
      newName: renameResult
    });
    updateDocumentsAfterDirectoryRename(renamed.oldPath, renamed.newPath);
    await refreshCurrentDirectoryFiles(currentDirectoryPath);
    renderDocumentHeader();
    requestSidebarRefreshForCurrentMode();
  } catch (error) {
    showHeaderNotice(getErrorMessage(error, '重命名文件夹失败。'), true);
  }
}

function buildSidebarContextMenuItemsFinal(target: SidebarContextTarget): ContextMenuItem[] {
  const refreshItem: ContextMenuItem = {
    kind: 'item',
    label: '刷新',
    enabled: Boolean(currentDirectoryPath),
    action: async () => {
      if (currentDirectoryPath) {
        await refreshCurrentDirectoryFiles(currentDirectoryPath);
      }
    }
  };

  if (target.sidebarMode === OUTLINE_MODE) {
    return [
      { kind: 'item', label: '搜索', action: () => openFilesSidebarSearch() },
      refreshItem
    ];
  }

  const directoryPath = getSidebarTargetDirectoryPath(target);
  const filePath =
    target.kind === 'file' ? target.filePath : target.kind === 'folder' ? target.path : target.directoryPath;
  const items: ContextMenuItem[] = [
    {
      kind: 'item',
      label: '在新窗口中打开',
      enabled: Boolean(filePath),
      action: async () => {
        if (filePath) {
          await openTargetInNewWindowFinal(
            target.kind === 'file'
              ? { filePath, directoryPath: target.directoryPath }
              : { directoryPath: filePath }
          );
        }
      }
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: '新建文件',
      enabled: Boolean(directoryPath),
      action: async () => {
        if (directoryPath) {
          await promptCreateMarkdownFileFinal(directoryPath);
        }
      }
    },
    {
      kind: 'item',
      label: '新建文件夹',
      enabled: Boolean(directoryPath),
      action: async () => {
        if (directoryPath) {
          await promptCreateFolderFinal(directoryPath);
        }
      }
    },
    { kind: 'separator' },
    { kind: 'item', label: '搜索', action: () => openFilesSidebarSearch() },
    refreshItem
  ];

  if (target.kind !== 'blank') {
    items.push(
      { kind: 'separator' },
      {
        kind: 'item',
        label: '重命名',
        enabled: target.kind !== 'file' || Boolean(target.filePath || target.documentId),
        action: async () => {
          if (target.kind === 'file') {
            if (!target.filePath && target.documentId) {
              await activateDocument(target.documentId);
              await handleRenameRequest();
              return;
            }

            await renameSidebarFileFinal(target);
            return;
          }

          await renameSidebarFolderFinal(target);
        }
      },
      {
        kind: 'item',
        label: '创建副本',
        enabled: Boolean(filePath),
        action: async () => {
          if (filePath) {
            await duplicateSidebarPathFinal(filePath);
          }
        }
      },
      {
        kind: 'item',
        label: '删除',
        danger: true,
        enabled:
          (Boolean(filePath) || (target.kind === 'file' && Boolean(target.documentId))) &&
          !(target.kind === 'folder' && target.isRoot),
        action: async () => {
          if (target.kind === 'file' && !target.filePath && target.documentId) {
            await closeDocument(target.documentId);
            return;
          }

          if (filePath) {
            await moveSidebarPathToRecycleBinFinal(filePath);
          }
        }
      },
      {
        kind: 'item',
        label: '复制文件路径',
        enabled: Boolean(filePath),
        action: async () => {
          if (filePath) {
            await copyTextToClipboard(filePath, '已复制文件路径。');
          }
        }
      },
      {
        kind: 'item',
        label: '打开文件位置',
        enabled: Boolean(filePath),
        action: async () => {
          if (filePath) {
            await revealPath(filePath);
          }
        }
      }
    );
  }

  return items;
}

function buildParagraphContextItemsFinal(): ContextMenuItem[] {
  return [
    { kind: 'item', label: '正文', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.paragraph), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.paragraph) },
    { kind: 'item', label: '一级标题', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.heading1), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.heading1) },
    { kind: 'item', label: '二级标题', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.heading2), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.heading2) },
    { kind: 'item', label: '三级标题', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.heading3), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.heading3) },
    { kind: 'item', label: '四级标题', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.heading4), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.heading4) },
    { kind: 'item', label: '五级标题', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.heading5), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.heading5) },
    { kind: 'item', label: '六级标题', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.heading6), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.heading6) },
    { kind: 'separator' },
    { kind: 'item', label: '标题升级', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.headingPromote), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.headingPromote) },
    { kind: 'item', label: '标题降级', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.headingDemote), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.headingDemote) },
    { kind: 'separator' },
    { kind: 'item', label: '引用', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.blockquote), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.blockquote) },
    { kind: 'item', label: '有序列表', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.orderedList), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.orderedList) },
    { kind: 'item', label: '无序列表', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.bulletList), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.bulletList) },
    { kind: 'item', label: '代码块', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.codeBlock), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.codeBlock) },
    { kind: 'item', label: '插入表格', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableInsert), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableInsert) }
  ];
}

function buildFormatContextItemsFinal(): ContextMenuItem[] {
  return [
    { kind: 'item', label: '粗体', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineStrong), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineStrong) },
    { kind: 'item', label: '斜体', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineEmphasis), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineEmphasis) },
    { kind: 'item', label: '删除线', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineStrike), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineStrike) },
    { kind: 'item', label: '行内代码', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineCode), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineCode) },
    { kind: 'item', label: '高亮', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineHighlight), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineHighlight) },
    { kind: 'item', label: '上标', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineSuperscript), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineSuperscript) },
    { kind: 'item', label: '下标', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineSubscript), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineSubscript) },
    { kind: 'item', label: '按键', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineKbd), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineKbd) }
  ];
}

function buildTableContextItemsFinal(): ContextMenuItem[] {
  return [
    { kind: 'item', label: '上方插入行', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableRowAbove), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableRowAbove) },
    { kind: 'item', label: '下方插入行', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableRowBelow), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableRowBelow) },
    { kind: 'item', label: '左侧插入列', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableColLeft), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableColLeft) },
    { kind: 'item', label: '右侧插入列', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableColRight), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableColRight) },
    { kind: 'separator' },
    { kind: 'item', label: '行上移', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableRowUp), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableRowUp) },
    { kind: 'item', label: '行下移', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableRowDown), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableRowDown) },
    { kind: 'item', label: '列左移', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableColMoveLeft), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableColMoveLeft) },
    { kind: 'item', label: '列右移', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableColMoveRight), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableColMoveRight) },
    { kind: 'separator' },
    { kind: 'item', label: '删除行', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableDeleteRow), danger: true, action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableDeleteRow) },
    { kind: 'item', label: '删除列', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableDeleteCol), danger: true, action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableDeleteCol) },
    { kind: 'item', label: '删除表格', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableDelete), danger: true, action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableDelete) }
  ];
}

function buildEditorContextMenuItemsFinal(): ContextMenuItem[] {
  const context = readCurrentEditorCommandContext();
  const hasSelection =
    editorViewMode === 'source'
      ? sourceTextarea.selectionStart !== sourceTextarea.selectionEnd
      : context.hasSelection;
  const items: ContextMenuItem[] = [
    { kind: 'item', label: '撤销', enabled: context.canUndo, action: () => executeEditCommand('undo') },
    { kind: 'item', label: '恢复', enabled: context.canRedo, action: () => executeEditCommand('redo') },
    { kind: 'separator' },
    { kind: 'item', label: '剪切', enabled: hasSelection, action: async () => performEditorCut() },
    { kind: 'item', label: '复制', enabled: hasSelection, action: async () => performEditorCopy() },
    { kind: 'item', label: '粘贴', action: async () => performEditorPaste() },
    { kind: 'item', label: '全选', action: () => performEditorSelectAll() },
    { kind: 'separator' },
    { kind: 'item', label: '查找', enabled: Boolean(context.activeDocument), action: () => executeEditCommand('find') },
    { kind: 'item', label: '替换', enabled: Boolean(context.activeDocument), action: () => executeEditCommand('replace') }
  ];

  if (editorViewMode === 'rendered') {
    items.push(
      { kind: 'separator' },
      { kind: 'item', label: '段落', submenu: buildParagraphContextItemsFinal() },
      { kind: 'item', label: '格式', submenu: buildFormatContextItemsFinal() }
    );

    if (context.isInTable) {
      items.push({ kind: 'item', label: '表格', submenu: buildTableContextItemsFinal() });
    }
  }

  return items;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return typeof error === 'string' && error.length > 0 ? error : fallback;
}

async function openTargetInNewWindowClean(options: {
  filePath?: string | null;
  directoryPath?: string | null;
}): Promise<void> {
  void options;
  showHeaderNotice('“在新窗口打开”已移除。', true);
  return;
  try {
    await invoke('open_in_new_window', {
      payload: {
        filePath: options.filePath ?? null,
        directoryPath: options.directoryPath ?? null
      }
    });
  } catch (error) {
    showHeaderNotice(getErrorMessage(error, '无法在新窗口中打开。'), true);
  }
}

async function promptCreateMarkdownFileClean(directoryPath: string): Promise<void> {
  const fileName = await showRenameDialog({
    title: '新建文件',
    description: '输入要创建的 Markdown 文件名。',
    defaultValue: 'untitled.md',
    confirmText: '创建',
    normalizeValue: async (value) =>
      await invoke<string>('validate_markdown_file_name', {
        newName: value
      })
  });

  if (!fileName) {
    return;
  }

  try {
    const created = await invoke<OpenedDocument>('create_markdown_file_in_directory', {
      directoryPath,
      fileName
    });
    await refreshCurrentDirectoryFiles(currentDirectoryPath);
    await openDocumentFromPath(created.filePath, {
      reloadExisting: true,
      updateCurrentDirectory: false
    });
  } catch (error) {
    showHeaderNotice(getErrorMessage(error, '创建文件失败。'), true);
  }
}

async function promptCreateFolderClean(directoryPath: string): Promise<void> {
  const folderName = await showRenameDialog({
    title: '新建文件夹',
    description: '输入要创建的文件夹名称。',
    defaultValue: '新建文件夹',
    confirmText: '创建',
    normalizeValue: async (value) => value
  });

  if (!folderName) {
    return;
  }

  try {
    const created = await invoke<PathEntryPayload>('create_folder_in_directory', {
      directoryPath,
      folderName
    });
    await refreshCurrentDirectoryFiles(currentDirectoryPath);
    showHeaderNotice(`已创建文件夹：${created.name}`);
  } catch (error) {
    showHeaderNotice(getErrorMessage(error, '创建文件夹失败。'), true);
  }
}

async function duplicateSidebarPathClean(path: string): Promise<void> {
  try {
    const duplicated = await invoke<PathEntryPayload>('duplicate_fs_entry', { path });
    await refreshCurrentDirectoryFiles(currentDirectoryPath);

    if (duplicated.isDirectory) {
      showHeaderNotice(`已创建副本：${duplicated.name}`);
      return;
    }

    await openDocumentFromPath(duplicated.path, {
      reloadExisting: true,
      updateCurrentDirectory: false
    });
  } catch (error) {
    showHeaderNotice(getErrorMessage(error, '创建副本失败。'), true);
  }
}

async function moveSidebarPathToRecycleBinClean(path: string): Promise<void> {
  const openDocuments = getOpenDocumentsWithinPath(path);

  if (openDocuments.some((document) => isDocumentUnsaved(document))) {
    showHeaderNotice('请先保存或关闭相关文档，再删除。', true);
    return;
  }

  if (!window.confirm('确定将所选项目移到回收站吗？')) {
    return;
  }

  for (const document of openDocuments) {
    await closeDocument(document.id);
  }

  try {
    await invoke('move_path_to_recycle_bin', { path });
    await refreshCurrentDirectoryFiles(currentDirectoryPath);
  } catch (error) {
    showHeaderNotice(getErrorMessage(error, '删除失败。'), true);
  }
}

async function renameSidebarFileClean(
  target: Extract<SidebarContextTarget, { kind: 'file' }>
): Promise<void> {
  const renameResult = await showRenameDialog({
    title: '重命名文件',
    description: '修改当前文件名称。',
    defaultValue: target.fileName,
    confirmText: '重命名',
    normalizeValue: async (value) =>
      await invoke<string>('validate_markdown_file_name', {
        newName: value
      })
  });

  if (!renameResult) {
    return;
  }

  try {
    const renamed = await invoke<OpenedDocument>('rename_markdown_file', {
      path: target.filePath,
      newName: renameResult
    });
    const openDocument = documents.find((document) => document.filePath === target.filePath);

    if (openDocument) {
      applyRenamedDocumentState(openDocument, renamed);
    }

    await refreshCurrentDirectoryFiles(currentDirectoryPath);
    renderDocumentHeader();
    requestSidebarRefreshForCurrentMode();
  } catch (error) {
    showHeaderNotice(getErrorMessage(error, '重命名失败。'), true);
  }
}

async function renameSidebarFolderClean(
  target: Extract<SidebarContextTarget, { kind: 'folder' }>
): Promise<void> {
  const renameResult = await showRenameDialog({
    title: target.isRoot ? '重命名根目录' : '重命名文件夹',
    description: '修改当前文件夹名称。',
    defaultValue: target.name,
    confirmText: '重命名',
    normalizeValue: async (value) => value
  });

  if (!renameResult) {
    return;
  }

  try {
    const renamed = await invoke<RenamedDirectoryPayload>('rename_directory', {
      path: target.path,
      newName: renameResult
    });
    updateDocumentsAfterDirectoryRename(renamed.oldPath, renamed.newPath);
    await refreshCurrentDirectoryFiles(currentDirectoryPath);
    renderDocumentHeader();
    requestSidebarRefreshForCurrentMode();
  } catch (error) {
    showHeaderNotice(getErrorMessage(error, '重命名文件夹失败。'), true);
  }
}

function buildSidebarContextMenuItemsClean(target: SidebarContextTarget): ContextMenuItem[] {
  if (target.sidebarMode === OUTLINE_MODE) {
    return [{ kind: 'item', label: '搜索', action: () => openFilesSidebarSearch() }];
  }

  const directoryPath = getSidebarTargetDirectoryPath(target);
  const filePath =
    target.kind === 'file' ? target.filePath : target.kind === 'folder' ? target.path : target.directoryPath;
  const items: ContextMenuItem[] = [
    {
      kind: 'item',
      label: '在新窗口中打开',
      enabled: Boolean(filePath),
      action: async () => {
        if (!filePath) {
          return;
        }

        await openTargetInNewWindowClean(
          target.kind === 'file'
            ? { filePath, directoryPath: target.directoryPath }
            : { directoryPath: filePath }
        );
      }
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: '新建文件',
      enabled: Boolean(directoryPath),
      action: async () => {
        if (directoryPath) {
          await promptCreateMarkdownFileClean(directoryPath);
        }
      }
    },
    {
      kind: 'item',
      label: '新建文件夹',
      enabled: Boolean(directoryPath),
      action: async () => {
        if (directoryPath) {
          await promptCreateFolderClean(directoryPath);
        }
      }
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: '搜索',
      action: () => openFilesSidebarSearch()
    }
  ];

  if (target.kind !== 'blank') {
    items.push(
      { kind: 'separator' },
      {
        kind: 'item',
        label: '重命名',
        enabled: target.kind !== 'file' || Boolean(target.filePath || target.documentId),
        action: async () => {
          if (target.kind === 'file') {
            if (!target.filePath && target.documentId) {
              await activateDocument(target.documentId);
              await handleRenameRequest();
              return;
            }

            await renameSidebarFileClean(target);
            return;
          }

          await renameSidebarFolderClean(target);
        }
      },
      {
        kind: 'item',
        label: '创建副本',
        enabled: Boolean(filePath),
        action: async () => {
          if (filePath) {
            await duplicateSidebarPathClean(filePath);
          }
        }
      },
      {
        kind: 'item',
        label: '删除',
        danger: true,
        enabled:
          (Boolean(filePath) || (target.kind === 'file' && Boolean(target.documentId))) &&
          !(target.kind === 'folder' && target.isRoot),
        action: async () => {
          if (target.kind === 'file' && !target.filePath && target.documentId) {
            await closeDocument(target.documentId);
            return;
          }

          if (filePath) {
            await moveSidebarPathToRecycleBinClean(filePath);
          }
        }
      },
      {
        kind: 'item',
        label: '复制文件路径',
        enabled: Boolean(filePath),
        action: async () => {
          if (filePath) {
            await copyTextToClipboard(filePath, '已复制文件路径。');
          }
        }
      },
      {
        kind: 'item',
        label: '打开文件位置',
        enabled: Boolean(filePath),
        action: async () => {
          if (filePath) {
            await revealPath(filePath);
          }
        }
      }
    );
  }

  return items;
}

function buildParagraphContextItemsClean(): ContextMenuItem[] {
  return [
    { kind: 'item', label: '正文', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.paragraph), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.paragraph) },
    { kind: 'item', label: '一级标题', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.heading1), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.heading1) },
    { kind: 'item', label: '二级标题', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.heading2), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.heading2) },
    { kind: 'item', label: '三级标题', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.heading3), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.heading3) },
    { kind: 'item', label: '四级标题', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.heading4), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.heading4) },
    { kind: 'item', label: '五级标题', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.heading5), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.heading5) },
    { kind: 'item', label: '六级标题', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.heading6), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.heading6) },
    { kind: 'separator' },
    { kind: 'item', label: '标题升级', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.headingPromote), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.headingPromote) },
    { kind: 'item', label: '标题降级', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.headingDemote), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.headingDemote) },
    { kind: 'separator' },
    { kind: 'item', label: '引用', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.blockquote), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.blockquote) },
    { kind: 'item', label: '有序列表', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.orderedList), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.orderedList) },
    { kind: 'item', label: '无序列表', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.bulletList), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.bulletList) },
    { kind: 'item', label: '代码块', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.codeBlock), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.codeBlock) },
    { kind: 'item', label: '插入表格', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableInsert), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableInsert) }
  ];
}

function buildFormatContextItemsClean(): ContextMenuItem[] {
  return [
    { kind: 'item', label: '粗体', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineStrong), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineStrong) },
    { kind: 'item', label: '斜体', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineEmphasis), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineEmphasis) },
    { kind: 'item', label: '删除线', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineStrike), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineStrike) },
    { kind: 'item', label: '行内代码', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineCode), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineCode) },
    { kind: 'item', label: '高亮', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineHighlight), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineHighlight) },
    { kind: 'item', label: '上标', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineSuperscript), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineSuperscript) },
    { kind: 'item', label: '下标', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineSubscript), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineSubscript) },
    { kind: 'item', label: '按键', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.inlineKbd), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.inlineKbd) }
  ];
}

function buildTableContextItemsClean(): ContextMenuItem[] {
  return [
    { kind: 'item', label: '上方插入行', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableRowAbove), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableRowAbove) },
    { kind: 'item', label: '下方插入行', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableRowBelow), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableRowBelow) },
    { kind: 'item', label: '左侧插入列', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableColLeft), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableColLeft) },
    { kind: 'item', label: '右侧插入列', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableColRight), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableColRight) },
    { kind: 'separator' },
    { kind: 'item', label: '行上移', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableRowUp), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableRowUp) },
    { kind: 'item', label: '行下移', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableRowDown), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableRowDown) },
    { kind: 'item', label: '列左移', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableColMoveLeft), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableColMoveLeft) },
    { kind: 'item', label: '列右移', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableColMoveRight), action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableColMoveRight) },
    { kind: 'separator' },
    { kind: 'item', label: '删除行', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableDeleteRow), danger: true, action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableDeleteRow) },
    { kind: 'item', label: '删除列', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableDeleteCol), danger: true, action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableDeleteCol) },
    { kind: 'item', label: '删除表格', enabled: isEditorCommandCurrentlyEnabled(EDITOR_COMMAND_IDS.tableDelete), danger: true, action: () => executeEditorCommand(EDITOR_COMMAND_IDS.tableDelete) }
  ];
}

function buildEditorContextMenuItemsClean(): ContextMenuItem[] {
  const context = readCurrentEditorCommandContext();
  const hasSelection =
    editorViewMode === 'source'
      ? sourceTextarea.selectionStart !== sourceTextarea.selectionEnd
      : context.hasSelection;
  const items: ContextMenuItem[] = [
    { kind: 'item', label: '撤销', enabled: context.canUndo, action: () => executeEditCommand('undo') },
    { kind: 'item', label: '恢复', enabled: context.canRedo, action: () => executeEditCommand('redo') },
    { kind: 'separator' },
    { kind: 'item', label: '剪切', enabled: hasSelection, action: async () => performEditorCut() },
    { kind: 'item', label: '复制', enabled: hasSelection, action: async () => performEditorCopy() },
    { kind: 'item', label: '粘贴', action: async () => performEditorPaste() },
    { kind: 'item', label: '全选', action: () => performEditorSelectAll() },
    { kind: 'separator' },
    { kind: 'item', label: '查找', enabled: Boolean(context.activeDocument), action: () => executeEditCommand('find') },
    { kind: 'item', label: '替换', enabled: Boolean(context.activeDocument), action: () => executeEditCommand('replace') }
  ];

  if (editorViewMode === 'rendered') {
    items.push(
      { kind: 'separator' },
      { kind: 'item', label: '段落', submenu: buildParagraphContextItemsClean() },
      { kind: 'item', label: '格式', submenu: buildFormatContextItemsClean() }
    );

    if (context.isInTable) {
      items.push({ kind: 'item', label: '表格', submenu: buildTableContextItemsClean() });
    }
  }

  return items;
}

function renderEditorEmptyState(): void {
  void destroyAllMilkdownSessions();
  closeFindReplaceBar();
  clearHeadingMarkerOverlay();
  clearHeadingTargetHighlight();
  content.className = 'viewer-content viewer-content-empty';
  content.replaceChildren();

  const emptyText = document.createElement('p');
  emptyText.className = 'viewer-line viewer-empty-text';
  emptyText.textContent =
    '\u5f53\u524d\u6ca1\u6709\u6fc0\u6d3b\u7684 Markdown \u6587\u6863\u3002';

  const emptyHint = document.createElement('p');
  emptyHint.className = 'viewer-line viewer-empty-text';
  emptyHint.textContent =
    '\u53ef\u4ee5\u901a\u8fc7\u201c\u6587\u4ef6 -> \u65b0\u5efa\u201d\u6216\u201c\u6587\u4ef6 -> \u6253\u5f00\u201d\u5f00\u59cb\u3002';

  content.append(emptyText, emptyHint);
  renderStatusBar();
}

function renderSourceEditor(documentState: DocumentState): void {
  clearHeadingMarkerOverlay();
  clearHeadingTargetHighlight();
  content.className = 'viewer-content viewer-content-source';

  if (sourceEditorShell.parentElement !== content) {
    content.replaceChildren(sourceEditorShell);
  }

  if (sourceTextarea.value !== documentState.content) {
    sourceTextarea.value = documentState.content;
  }

  setSourceHistorySnapshot(documentState.id, documentState.content, { resetStacks: false });
  restoreSourceEditorContext(documentState);
  sourceTextarea.focus();
  renderStatusBar();
}

function createMilkdownHost(documentId: string): HTMLDivElement {
  const host = document.createElement('div');
  host.className = 'milkdown-host';
  host.addEventListener('pointerdown', (event) => {
    handleTrailingCodeBlockPointerDown(event, documentId);
  });
  host.addEventListener('pointerup', () => {
    scheduleHeadingMarkerRefresh(documentId);
  });
  host.addEventListener('click', () => {
    scheduleHeadingMarkerRefresh(documentId);
  });

  return host;
}

function createMilkdownEditorForDocument(documentState: DocumentState, host: HTMLDivElement): Editor {
  const documentId = documentState.id;

  return Editor.make()
    .config(nord)
    .config((ctx) => {
      ctx.set(rootCtx, host);
      ctx.set(defaultValueCtx, documentState.content);
      ctx.update(remarkStringifyOptionsCtx, (options) => ({
        ...options,
        handlers: extendInlineHtmlRemarkHandlers(options.handlers as Record<string, unknown> | undefined)
      }));
      ctx.update(prosePluginsCtx, (plugins) => [
        ...plugins,
        proseHistory(),
        createCodeBlockHighlightPlugin(),
        createTrailingCodeBlockExitPlugin(documentId)
      ]);
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
        const targetDocument = documents.find((item) => item.id === documentId);

        if (!targetDocument || activeDocumentId !== documentId) {
          return;
        }

        applyMilkdownMarkdownUpdate(targetDocument, markdown);
      }).updated(() => {
        if (activeDocumentId === documentId) {
          scheduleOutlineSidebarRefresh(documentId);
          renderHeadingMarkerOverlay(documentId);
        }
      }).selectionUpdated((_ctx, selection) => {
        if (activeDocumentId === documentId) {
          const targetDocument = documents.find((item) => item.id === documentId);

          if (targetDocument) {
            rememberMilkdownSelection(targetDocument, selection);
          }

          renderHeadingMarkerOverlay(documentId);
          scheduleOutlineActiveStateRefresh(documentId);
          scheduleNativeMenuStateSync();
        }
      });
    })
    .use(listener)
    .use(madoInlineHtmlSupport)
    .use(commonmark)
    .use(gfm);
}

async function ensureMilkdownSession(
  documentState: DocumentState
): Promise<MilkdownSessionCreationResult> {
  const existingSession = getMilkdownSession(documentState.id);

  if (existingSession && existingSession.markdownSnapshot === documentState.content) {
    return { kind: 'ready', session: existingSession };
  }

  const staleSession = existingSession ?? null;
  const prepareToken = beginMilkdownSessionPrepare(documentState.id);
  const documentId = documentState.id;
  const surface = createEditorSurface(documentId);
  const host = createMilkdownHost(documentId);
  surface.append(host);

  if (editorSurfaceStack.parentElement === content) {
    editorSurfaceStack.append(surface);
  }

  const editor = createMilkdownEditorForDocument(documentState, host);

  try {
    const createdEditor = await editor.create();

    if (!isCurrentMilkdownSessionPrepare(documentId, prepareToken)) {
      await createdEditor.destroy();
      surface.remove();
      return { kind: 'stale' };
    }

    const marker = createHeadingMarkerOverlay(host, documentId);
    const session: MilkdownSession = {
      documentId,
      editor: createdEditor,
      surface,
      host,
      markdownSnapshot: documentState.content,
      hasPendingChanges: false,
      scrollTop: documentState.editorScrollTop,
      scrollLeft: documentState.editorScrollLeft,
      headingMarkerOverlay: marker.overlay,
      headingMarkerBadge: marker.badge,
      headingMarkerMenu: marker.menu,
      headingMarkerMenuOpen: false,
      activeHeadingMarkerState: null,
      lastUsedAt: Date.now()
    };

    milkdownSessions.set(documentId, session);
    markMilkdownSynchronized(documentId, documentState.content);
    if (staleSession) {
      persistMilkdownSessionState(staleSession);
      staleSession.surface.remove();
      void destroyMilkdownEditorInstance(staleSession.editor);
    }

    return { kind: 'ready', session };
  } catch {
    surface.remove();
    void destroyMilkdownEditorInstance(editor);

    return { kind: 'failed' };
  }
}

async function renderMilkdownEditor(
  documentState: DocumentState,
  activationToken: number = milkdownActivationToken
): Promise<void> {
  if (editorViewMode !== 'rendered') {
    return;
  }

  persistActiveMilkdownSessionState();

  const sessionResult = await ensureMilkdownSession(documentState);

  if (
    editorViewMode !== 'rendered' ||
    !isCurrentMilkdownActivation(activationToken) ||
    activeDocumentId !== documentState.id
  ) {
    return;
  }

  if (sessionResult.kind !== 'ready') {
    if (sessionResult.kind === 'failed') {
      showHeaderNotice('Milkdown \u7f16\u8f91\u5668\u521d\u59cb\u5316\u5931\u8d25\u3002', true);
      renderDocumentHeader();
    }

    return;
  }

  bindMilkdownSession(sessionResult.session);
  setActiveEditorSurface(sessionResult.session);
  restoreMilkdownSessionScroll(sessionResult.session);
  requestSidebarRefreshForCurrentMode();
  scheduleNativeMenuStateSync();
  renderHeadingMarkerOverlay(documentState.id);
  scheduleOutlineActiveStateRefresh(documentState.id);
  pruneMilkdownSessionCache(documentState.id);
  if (findReplaceOpen) {
    recomputeFindReplaceMatches();
    renderFindReplaceBar();
  }
}

function activatePreparedDocument(
  documentState: DocumentState,
  session: MilkdownSession,
  activationToken: number
): void {
  if (!isCurrentMilkdownActivation(activationToken)) {
    return;
  }

  upsertDocument(documentState);
  upsertRecentFile(documentState);
  activeDocumentId = documentState.id;
  touchDocument(documentState);

  if (editorViewMode !== 'rendered') {
    requestRender({ editor: true, activationToken });
    requestSidebarRefreshForCurrentMode();
    renderStatusBar();
    return;
  }

  bindMilkdownSession(session);
  setActiveEditorSurface(session);
  restoreMilkdownSessionScroll(session);
  renderDocumentHeader();
  requestSidebarRefreshForCurrentMode();
  renderHeadingMarkerOverlay(documentState.id);
  scheduleOutlineActiveStateRefresh(documentState.id);
  pruneMilkdownSessionCache(documentState.id);
}

function renderActiveDocument(activationToken: number = milkdownActivationToken): void {
  renderDocumentHeader();

  const activeDocument = getActiveDocument();

  if (!activeDocument) {
    renderEditorEmptyState();
    return;
  }

  if (editorViewMode === 'source') {
    renderSourceEditor(activeDocument);
    return;
  }

  void renderMilkdownEditor(activeDocument, activationToken);
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
  document.sourceSnapshot = createMarkdownSourceSnapshot(opened.content);
  document.headingStyles = [];
  document.isDirty = false;
  document.isUntitled = false;
  document.editorScrollTop = 0;
  document.editorScrollLeft = 0;
  document.editorSelectionFrom = 0;
  document.editorSelectionTo = 0;
  document.sourceSelectionStart = 0;
  document.sourceSelectionEnd = 0;
  document.sourceScrollTop = 0;
  setSourceHistorySnapshot(document.id, opened.content, { resetStacks: true });
}

function createDocumentState(document: OpenedDocument): DocumentState {
  const now = Date.now();

  const state: DocumentState = {
    id: nextDocumentId(),
    fileName: document.fileName,
    filePath: document.filePath,
    directoryPath: document.directoryPath,
    content: document.content,
    savedContent: document.content,
    sourceSnapshot: createMarkdownSourceSnapshot(document.content),
    headingStyles: [],
    isDirty: false,
    isUntitled: false,
    lastViewedAt: now,
    listOrder: nextListOrder(),
    editorScrollTop: 0,
    editorScrollLeft: 0,
    editorSelectionFrom: 0,
    editorSelectionTo: 0,
    sourceSelectionStart: 0,
    sourceSelectionEnd: 0,
    sourceScrollTop: 0
  };

  setSourceHistorySnapshot(state.id, document.content, { resetStacks: true });
  return state;
}

function handleOpenDocumentFailure(filePath: string): void {
  removeRecentFile(filePath);
  showHeaderNotice(
    '\u65e0\u6cd5\u6253\u5f00\u8be5\u6587\u4ef6\uff0c\u5b83\u5df2\u4ece\u5386\u53f2\u5217\u8868\u4e2d\u79fb\u9664\u3002',
    true
  );
}

async function activateDocument(
  documentId: string,
  activationToken: number = beginMilkdownActivation()
): Promise<void> {
  syncActiveDocumentFromEditor();
  closeFindReplaceBar();

  if (!isCurrentMilkdownActivation(activationToken)) {
    return;
  }

  const activeDocument = documents.find((document) => document.id === documentId);

  if (!activeDocument) {
    return;
  }

  activeDocumentId = documentId;
  touchDocument(activeDocument);
  requestRender({ editor: true, activationToken });
}

async function openDocumentFromPath(
  filePath: string,
  options: { reloadExisting?: boolean; updateCurrentDirectory?: boolean } = {}
): Promise<void> {
  const reloadExisting = options.reloadExisting ?? true;
  const updateCurrentDirectory = options.updateCurrentDirectory ?? true;
  const activationToken = beginMilkdownActivation();

  syncActiveDocumentFromEditor();
  closeFindReplaceBar();

  const existingDocument = documents.find((document) => document.filePath === filePath);

  if (existingDocument) {
    if (reloadExisting && !existingDocument.isDirty) {
      try {
        const opened = await invoke<OpenedDocument>('open_markdown_file', { path: filePath });
        if (!isCurrentMilkdownActivation(activationToken)) {
          return;
        }
        applyOpenedDocumentState(existingDocument, opened);
      } catch {
        if (isCurrentMilkdownActivation(activationToken)) {
          handleOpenDocumentFailure(filePath);
        }
        return;
      }
    } else if (reloadExisting && existingDocument.isDirty) {
      if (isCurrentMilkdownActivation(activationToken)) {
        showHeaderNotice(
          '\u8be5\u6587\u4ef6\u5728\u5f53\u524d\u4f1a\u8bdd\u4e2d\u6709\u672a\u4fdd\u5b58\u4fee\u6539\uff0c\u5df2\u4fdd\u7559\u4f1a\u8bdd\u7248\u672c\u3002',
          true
        );
      }
    }

    await activateDocument(existingDocument.id, activationToken);

    if (updateCurrentDirectory) {
      await setCurrentDirectoryFromFilePath(filePath, activationToken);
    }

    if (!isCurrentMilkdownActivation(activationToken)) {
      return;
    }

    upsertRecentFile(existingDocument);

    return;
  }

  try {
    const document = await invoke<OpenedDocument>('open_markdown_file', { path: filePath });
    if (!isCurrentMilkdownActivation(activationToken)) {
      return;
    }

    const documentState = createDocumentState(document);

    if (editorViewMode === 'source') {
      upsertDocument(documentState);
      activeDocumentId = documentState.id;
      touchDocument(documentState);
      upsertRecentFile(documentState);
      requestRender({ editor: true, activationToken });
      requestSidebarRefreshForCurrentMode();

      if (updateCurrentDirectory) {
        await setCurrentDirectoryFromFilePath(filePath, activationToken);
      }

      return;
    }

    const sessionResult = await ensureMilkdownSession(documentState);

    if (sessionResult.kind === 'failed') {
      if (isCurrentMilkdownActivation(activationToken)) {
        showHeaderNotice('Milkdown \u7f16\u8f91\u5668\u521d\u59cb\u5316\u5931\u8d25\u3002', true);
      }

      return;
    }

    if (sessionResult.kind !== 'ready') {
      return;
    }

    if (!isCurrentMilkdownActivation(activationToken)) {
      void destroyMilkdownSession(documentState.id);
      return;
    }

    activatePreparedDocument(documentState, sessionResult.session, activationToken);

    if (updateCurrentDirectory) {
      await setCurrentDirectoryFromFilePath(filePath, activationToken);
    }

    if (!isCurrentMilkdownActivation(activationToken)) {
      return;
    }
  } catch {
    if (isCurrentMilkdownActivation(activationToken)) {
      handleOpenDocumentFailure(filePath);
    }
  }
}

function createUntitledDocument(): void {
  syncActiveDocumentFromEditor();
  closeFindReplaceBar();
  const activationToken = beginMilkdownActivation();

  const now = Date.now();
  const documentState: DocumentState = {
    id: nextDocumentId(),
    fileName: UNTITLED_FILE_NAME,
    filePath: null,
    directoryPath: null,
    content: '',
    savedContent: '',
    sourceSnapshot: createMarkdownSourceSnapshot(''),
    headingStyles: [],
    isDirty: true,
    isUntitled: true,
    lastViewedAt: now,
    listOrder: nextListOrder(),
    editorScrollTop: 0,
    editorScrollLeft: 0,
    editorSelectionFrom: 0,
    editorSelectionTo: 0,
    sourceSelectionStart: 0,
    sourceSelectionEnd: 0,
    sourceScrollTop: 0
  };

  setSourceHistorySnapshot(documentState.id, documentState.content, { resetStacks: true });
  upsertDocument(documentState);
  activeDocumentId = documentState.id;
  requestRender({ editor: true, activationToken });
  requestSidebarRefreshForCurrentMode();
}

function isPathOpenByOtherDocument(filePath: string, currentDocumentId: string | null): boolean {
  return documents.some(
    (document) => document.filePath === filePath && document.id !== currentDocumentId
  );
}

async function validateMarkdownSavePath(filePath: string): Promise<string | null> {
  try {
    return await invoke<string>('validate_markdown_save_path', {
      path: filePath
    });
  } catch (error) {
    showHeaderNotice(
      typeof error === 'string' && error.length > 0 ? error : '保存路径无效。',
      true
    );
    return null;
  }
}

function setRenameDialogValidationState(pending: boolean): void {
  renameDialogValidationPending = pending;
  renameDialogConfirm.disabled = pending;
  renameDialogConfirm.textContent = pending ? '\u68c0\u67e5\u4e2d...' : (renameDialogConfirm.dataset.defaultText ?? renameDialogConfirm.textContent);
}

async function validateSelectedSavePath(filePath: string): Promise<string | null> {
  try {
    return await invoke<string>('validate_markdown_save_path', {
      path: filePath
    });
  } catch (error) {
    showHeaderNotice(
      typeof error === 'string' && error.length > 0 ? error : '保存路径无效。',
      true
    );
    return null;
  }
}

async function validateSavePathFromDialog(filePath: string): Promise<string | null> {
  try {
    return await invoke<string>('validate_markdown_save_path', {
      path: filePath
    });
  } catch (error) {
    showHeaderNotice(
      typeof error === 'string' && error.length > 0 ? error : '保存路径无效。',
      true
    );
    return null;
  }
}

async function submitRenameDialog(): Promise<void> {
  if (renameDialogValidationPending) {
    return;
  }

  const requestToken = ++renameDialogValidationToken;
  renameDialogError.textContent = '';
  setRenameDialogValidationState(true);

  try {
    const normalizeValue =
      renameDialogNormalizeValue ??
      (async (value: string) =>
        await invoke<string>('validate_markdown_file_name', {
          newName: value
        }));
    const normalized = await normalizeValue(renameDialogInput.value);

    if (requestToken !== renameDialogValidationToken || !renameDialogResolver) {
      return;
    }

    closeRenameDialog(normalized);
  } catch (error) {
    if (requestToken !== renameDialogValidationToken || !renameDialogResolver) {
      return;
    }

    renameDialogError.textContent =
      typeof error === 'string' && error.length > 0
        ? error
        : '\u6587\u4ef6\u540d\u6821\u9a8c\u5931\u8d25\u3002';
    renameDialogInput.focus();
    renameDialogInput.select();
  } finally {
    if (requestToken === renameDialogValidationToken) {
      setRenameDialogValidationState(false);
    }
  }
}

function closeRenameDialog(result: string | null): void {
  renameOverlay.classList.add('is-hidden');
  const resolver = renameDialogResolver;
  renameDialogResolver = null;
  renameDialogNormalizeValue = null;
  renameDialogError.textContent = '';
  renameDialogValidationToken += 1;
  setRenameDialogValidationState(false);

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
  renameDialogConfirm.dataset.defaultText = options.confirmText;
  renameDialogNormalizeValue = options.normalizeValue ?? null;
  renameDialogError.textContent = '';
  setRenameDialogValidationState(false);
  renameOverlay.classList.remove('is-hidden');

  return new Promise((resolve) => {
    renameDialogResolver = resolve;

    window.setTimeout(() => {
      renameDialogInput.focus();
      renameDialogInput.select();
    }, 0);
  });
}

function closeDeleteConfirmDialog(result: boolean): void {
  deleteConfirmOverlay.classList.add('is-hidden');
  const resolver = deleteConfirmResolver;
  deleteConfirmResolver = null;

  if (resolver) {
    resolver(result);
  }
}

function showDeleteConfirmDialog(options: DeleteConfirmDialogOptions): Promise<boolean> {
  if (deleteConfirmResolver) {
    closeDeleteConfirmDialog(false);
  }

  deleteConfirmTitle.textContent = options.title;
  deleteConfirmDescription.textContent = options.description;
  deleteConfirmSubmit.textContent = options.confirmText;
  deleteConfirmOverlay.classList.remove('is-hidden');

  return new Promise((resolve) => {
    deleteConfirmResolver = resolve;

    window.setTimeout(() => {
      deleteConfirmCancel.focus();
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
  document.sourceSnapshot = createMarkdownSourceSnapshot(document.content);
  document.isDirty = false;
  document.isUntitled = false;
  document.lastViewedAt = now;
  markMilkdownSynchronized(document.id, document.content);
  setSourceHistorySnapshot(document.id, document.content, { resetStacks: true });
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
    document.sourceSnapshot = createMarkdownSourceSnapshot(renamed.content);
    setSourceHistorySnapshot(document.id, renamed.content, { resetStacks: true });
  }

  upsertRecentFile(document);
}

async function pickSavePath(defaultPath: string): Promise<string | null> {
  const selected = await save({
    filters: SAVE_MARKDOWN_FILTERS,
    defaultPath
  });

  if (!selected) {
    return null;
  }

  return validateSavePathFromDialog(selected);
}

async function handleOpenFileRequest(): Promise<void> {
  const selected = await open({
    directory: false,
    multiple: false,
    filters: OPEN_MARKDOWN_FILTERS
  });

  if (!selected || Array.isArray(selected)) {
    return;
  }

  await openDocumentFromPath(selected);
}

async function handleOpenFolderRequest(): Promise<void> {
  const selected = await open({
    directory: true,
    multiple: false
  });

  if (!selected || Array.isArray(selected)) {
    return;
  }

  const activationToken = beginMilkdownActivation();
  await setCurrentDirectoryPath(selected, activationToken);
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
      if (!syncCurrentDirectoryFileEntry(saved)) {
        await setCurrentDirectoryPath(saved.directoryPath);
      } else {
        requestFilesSidebarRefresh();
      }
      requestRender({ editor: true });
      return;
    }

    const saved = await saveDocumentToPath(activeDocument, activeDocument.filePath);
    applySavedDocumentState(activeDocument, saved);
    syncCurrentDirectoryFileEntry(saved);
    renderDocumentHeader();
    requestFilesSidebarRefresh();
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

    if (activeDocument.isUntitled || !activeDocument.filePath) {
      applySavedDocumentState(activeDocument, saved);
      if (!syncCurrentDirectoryFileEntry(saved)) {
        await setCurrentDirectoryPath(saved.directoryPath);
      } else {
        requestFilesSidebarRefresh();
      }
      requestRender({ editor: true });
      return;
    }

    markMilkdownSynchronized(activeDocument.id, activeDocument.content);
    upsertRecentFromDocumentPayload(saved, activeDocument.content, Date.now());
    showHeaderNotice('\u5df2\u53e6\u5b58\u4e3a\u65b0\u6587\u4ef6\uff0c\u5f53\u524d\u4ecd\u4fdd\u6301\u539f\u6587\u6863\u3002');
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
      if (!syncCurrentDirectoryFileEntry(saved)) {
        await setCurrentDirectoryPath(saved.directoryPath);
      } else {
        requestFilesSidebarRefresh();
      }
      requestRender({ editor: true });
    } catch {
      showHeaderNotice('\u547d\u540d\u5e76\u4fdd\u5b58\u5931\u8d25\u3002', true);
    }

    return;
  }

  if (!activeDocument.filePath) {
    return;
  }

  try {
    const previousPath = activeDocument.filePath;
    const renamed = await invoke<OpenedDocument>('rename_markdown_file', {
      path: activeDocument.filePath,
      newName: renameResult
    });
    applyRenamedDocumentState(activeDocument, renamed);
    if (syncCurrentDirectoryFileEntry(renamed, previousPath)) {
      requestFilesSidebarRefresh();
    } else {
      await setCurrentDirectoryPath(renamed.directoryPath);
    }
    renderDocumentHeader();
  } catch {
    showHeaderNotice('\u91cd\u547d\u540d\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u6587\u4ef6\u540d\u662f\u5426\u5df2\u5b58\u5728\u3002', true);
  }
}

void renderActiveDocument();
renderSidebar();
void syncRecentFilesMenu();

await listen<unknown>(APP_COMMAND_EVENT, async (event) => {
  if (isAppCommandPayload(event.payload)) {
    await dispatchAppCommand(event.payload, 'native-menu');
  }
});

window.setTimeout(async () => {
  if (currentDirectoryPath) {
    void refreshCurrentDirectoryFiles();
  }
}, 0);
