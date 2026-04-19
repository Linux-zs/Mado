import type { MilkdownPlugin } from '@milkdown/ctx';
import { $markSchema, $remark } from '@milkdown/utils';

const INLINE_HTML_NODE_TYPE = 'madoInlineHtml';
const SUPPORTED_INLINE_HTML_TAGS = ['mark', 'sub', 'sup', 'kbd'] as const;

type SupportedInlineHtmlTag = (typeof SUPPORTED_INLINE_HTML_TAGS)[number];

type MarkdownNode = {
  type: string;
  value?: unknown;
  tagName?: unknown;
  children?: MarkdownNode[];
  [key: string]: unknown;
};

type InlineHtmlMarkdownNode = MarkdownNode & {
  type: typeof INLINE_HTML_NODE_TYPE;
  tagName: SupportedInlineHtmlTag;
  children: MarkdownNode[];
};

type HtmlBoundary =
  | {
      kind: 'open';
      tagName: SupportedInlineHtmlTag;
    }
  | {
      kind: 'close';
      tagName: SupportedInlineHtmlTag;
    };

type RemarkStringifyHandler = (
  node: InlineHtmlMarkdownNode,
  parent: unknown,
  state: {
    enter: (name: string) => () => void;
    createTracker: (info: unknown) => {
      move: (value: string) => string;
      current: () => Record<string, unknown>;
    };
    containerPhrasing: (
      node: InlineHtmlMarkdownNode,
      info: Record<string, unknown>
    ) => string;
  },
  info: unknown
) => string;

function isParentNode(node: MarkdownNode): node is MarkdownNode & { children: MarkdownNode[] } {
  return Array.isArray(node.children);
}

function isHtmlNode(node: MarkdownNode): node is MarkdownNode & { value: string } {
  return node.type === 'html' && typeof node.value === 'string';
}

function parseInlineHtmlBoundary(node: MarkdownNode): HtmlBoundary | null {
  if (!isHtmlNode(node)) {
    return null;
  }

  const match = node.value.match(/^<\s*(\/?)\s*(mark|sub|sup|kbd)\s*>$/i);

  if (!match) {
    return null;
  }

  return {
    kind: match[1] === '/' ? 'close' : 'open',
    tagName: match[2].toLowerCase() as SupportedInlineHtmlTag
  };
}

function normalizeMarkdownNode(node: MarkdownNode): MarkdownNode {
  if (!isParentNode(node)) {
    return node;
  }

  node.children = normalizeMarkdownChildren(node.children);
  return node;
}

function normalizeMarkdownChildren(children: MarkdownNode[]): MarkdownNode[] {
  const normalized: MarkdownNode[] = [];

  for (let index = 0; index < children.length; index += 1) {
    const node = children[index];
    const boundary = parseInlineHtmlBoundary(node);

    if (!boundary || boundary.kind !== 'open') {
      normalized.push(normalizeMarkdownNode(node));
      continue;
    }

    const closingIndex = findMatchingClosingBoundary(children, index + 1, boundary.tagName);

    if (closingIndex < 0) {
      normalized.push(normalizeMarkdownNode(node));
      continue;
    }

    const innerChildren = normalizeMarkdownChildren(children.slice(index + 1, closingIndex));
    normalized.push({
      type: INLINE_HTML_NODE_TYPE,
      tagName: boundary.tagName,
      children: innerChildren
    });
    index = closingIndex;
  }

  return normalized;
}

function findMatchingClosingBoundary(
  children: MarkdownNode[],
  startIndex: number,
  tagName: SupportedInlineHtmlTag
): number {
  const stack: SupportedInlineHtmlTag[] = [];

  for (let index = startIndex; index < children.length; index += 1) {
    const boundary = parseInlineHtmlBoundary(children[index]);

    if (!boundary) {
      continue;
    }

    if (boundary.kind === 'open') {
      stack.push(boundary.tagName);
      continue;
    }

    if (stack.length === 0) {
      return boundary.tagName === tagName ? index : -1;
    }

    const expected = stack.at(-1);

    if (expected !== boundary.tagName) {
      return -1;
    }

    stack.pop();
  }

  return -1;
}

function createInlineHtmlMarkSchema(id: string, tagName: SupportedInlineHtmlTag) {
  return $markSchema(id, () => ({
    priority: 45,
    parseDOM: [{ tag: tagName }],
    toDOM: () => [tagName],
    parseMarkdown: {
      match: (node) => node.type === INLINE_HTML_NODE_TYPE && node.tagName === tagName,
      runner: (state, node, markType) => {
        state.openMark(markType);
        state.next(node.children);
        state.closeMark(markType);
      }
    },
    toMarkdown: {
      match: (mark) => mark.type.name === id,
      runner: (state, mark) => {
        state.withMark(mark, INLINE_HTML_NODE_TYPE, undefined, { tagName });
      }
    }
  }));
}

const inlineHtmlRemark = $remark('madoInlineHtmlRemark', () => () => (tree: unknown) => {
  if (!tree || typeof tree !== 'object') {
    return;
  }

  normalizeMarkdownNode(tree as MarkdownNode);
});

const highlightMarkSchema = createInlineHtmlMarkSchema('madoHighlight', 'mark');
const subscriptMarkSchema = createInlineHtmlMarkSchema('madoSubscript', 'sub');
const superscriptMarkSchema = createInlineHtmlMarkSchema('madoSuperscript', 'sup');
const keyboardMarkSchema = createInlineHtmlMarkSchema('madoKeyboard', 'kbd');

export const madoInlineHtmlSupport: MilkdownPlugin[] = [
  inlineHtmlRemark,
  highlightMarkSchema,
  subscriptMarkSchema,
  superscriptMarkSchema,
  keyboardMarkSchema
].flat();

const inlineHtmlStringifyHandler: RemarkStringifyHandler = (node, _parent, state, info) => {
  const openTag = `<${node.tagName}>`;
  const closeTag = `</${node.tagName}>`;
  const exit = state.enter(node.tagName);
  const tracker = state.createTracker(info);
  let value = tracker.move(openTag);

  value += tracker.move(
    state.containerPhrasing(node, {
      before: value,
      after: closeTag,
      ...tracker.current()
    })
  );
  value += tracker.move(closeTag);
  exit();

  return value;
};

export function extendInlineHtmlRemarkHandlers(
  handlers: Record<string, unknown> | undefined
): Record<string, unknown> {
  return {
    ...(handlers ?? {}),
    [INLINE_HTML_NODE_TYPE]: inlineHtmlStringifyHandler
  };
}
