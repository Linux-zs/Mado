export type ShortcutTargetKind =
  | 'none'
  | 'source'
  | 'milkdown'
  | 'input'
  | 'textarea'
  | 'select'
  | 'contentEditable'
  | 'other';

export function shouldBlockGlobalShortcutTarget(options: {
  renameDialogOpen: boolean;
  targetKind: ShortcutTargetKind;
}): boolean {
  if (options.renameDialogOpen) {
    return true;
  }

  switch (options.targetKind) {
    case 'source':
    case 'milkdown':
    case 'none':
    case 'other':
      return false;
    case 'input':
    case 'textarea':
    case 'select':
    case 'contentEditable':
      return true;
  }
}
