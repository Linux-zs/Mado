export type InlineStyleId =
  | 'strong'
  | 'emphasis'
  | 'strike'
  | 'inlineCode'
  | 'highlight'
  | 'superscript'
  | 'subscript'
  | 'kbd';

export type InlineFormatState = Record<InlineStyleId, boolean>;

export const INLINE_FORMAT_STYLE_ORDER: readonly InlineStyleId[] = [
  'strong',
  'emphasis',
  'strike',
  'inlineCode',
  'highlight',
  'superscript',
  'subscript',
  'kbd'
];

const INLINE_FORMAT_BADGES: Record<InlineStyleId, string> = {
  strong: 'B',
  emphasis: 'I',
  strike: 'S',
  inlineCode: '<>',
  highlight: 'H',
  superscript: 'Sup',
  subscript: 'Sub',
  kbd: 'Key'
};

export function createEmptyInlineFormatState(): InlineFormatState {
  return {
    strong: false,
    emphasis: false,
    strike: false,
    inlineCode: false,
    highlight: false,
    superscript: false,
    subscript: false,
    kbd: false
  };
}

export function hasAnyInlineFormat(state: InlineFormatState): boolean {
  return INLINE_FORMAT_STYLE_ORDER.some((style) => state[style]);
}

export function getInlineFormatBadgeText(state: InlineFormatState | null): string {
  if (!state || !hasAnyInlineFormat(state)) {
    return 'Fmt';
  }

  if (state.inlineCode) {
    return INLINE_FORMAT_BADGES.inlineCode;
  }

  return INLINE_FORMAT_STYLE_ORDER
    .filter((style) => style !== 'inlineCode' && state[style])
    .map((style) => INLINE_FORMAT_BADGES[style])
    .join('+');
}

export function toggleInlineFormatState(
  state: InlineFormatState,
  style: InlineStyleId
): InlineFormatState {
  const next: InlineFormatState = { ...state };

  if (style === 'inlineCode') {
    return state.inlineCode
      ? createEmptyInlineFormatState()
      : {
          ...createEmptyInlineFormatState(),
          inlineCode: true
        };
  }

  next.inlineCode = false;
  next[style] = !state[style];

  if (style === 'superscript' && next.superscript) {
    next.subscript = false;
  }

  if (style === 'subscript' && next.subscript) {
    next.superscript = false;
  }

  return next;
}
