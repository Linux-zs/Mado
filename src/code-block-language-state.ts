export const DEFAULT_CODE_BLOCK_LANGUAGE_BADGE_TEXT = 'text';
export const DEFAULT_CODE_BLOCK_HIGHLIGHT_LANGUAGE = 'plaintext';

const CODE_BLOCK_LANGUAGE_ALIASES: Record<string, string> = {
  shell: 'bash',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
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

export function normalizeCodeBlockLanguageInput(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().toLowerCase();

  if (trimmed.length === 0) {
    return null;
  }

  return CODE_BLOCK_LANGUAGE_ALIASES[trimmed] ?? trimmed;
}

export function resolveCodeBlockHighlightLanguage(
  language: string | null,
  isSupportedLanguage: (language: string) => boolean
): string {
  if (!language) {
    return DEFAULT_CODE_BLOCK_HIGHLIGHT_LANGUAGE;
  }

  return isSupportedLanguage(language) ? language : DEFAULT_CODE_BLOCK_HIGHLIGHT_LANGUAGE;
}

export function getCodeBlockLanguageBadgeText(language: string | null): string {
  return language ?? DEFAULT_CODE_BLOCK_LANGUAGE_BADGE_TEXT;
}
