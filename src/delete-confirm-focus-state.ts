export type DeleteConfirmRestoreTarget =
  | {
      kind: 'source-editor';
    }
  | {
      kind: 'rendered-editor';
    }
  | {
      kind: 'files-search';
    }
  | {
      kind: 'files-view';
    }
  | {
      kind: 'outline-view';
    }
  | {
      kind: 'fallback-editor';
    }
  | {
      kind: 'files-row';
      documentId: string | null;
      filePath: string | null;
      relativePath: string | null;
    }
  | {
      kind: 'outline-item';
      pos: number | null;
    };

export type DeleteConfirmDialogResult = {
  confirmed: boolean;
  restoreTarget: DeleteConfirmRestoreTarget;
};

export type DeleteConfirmActiveContext =
  | {
      kind: 'source-editor';
    }
  | {
      kind: 'rendered-editor';
    }
  | {
      kind: 'files-search';
    }
  | {
      kind: 'files-view';
    }
  | {
      kind: 'outline-view';
    }
  | {
      kind: 'files-row';
      documentId?: string | null;
      filePath?: string | null;
      relativePath?: string | null;
    }
  | {
      kind: 'outline-item';
      pos?: number | null;
    }
  | {
      kind: 'unknown';
    };

export function createDeleteConfirmDialogResult(
  confirmed: boolean,
  restoreTarget: DeleteConfirmRestoreTarget
): DeleteConfirmDialogResult {
  return {
    confirmed,
    restoreTarget
  };
}

export function createDeleteConfirmRestoreTargetFromContext(
  context: DeleteConfirmActiveContext
): DeleteConfirmRestoreTarget {
  switch (context.kind) {
    case 'source-editor':
    case 'rendered-editor':
    case 'files-search':
    case 'files-view':
    case 'outline-view':
      return { kind: context.kind };
    case 'files-row':
      return {
        kind: 'files-row',
        documentId: context.documentId ?? null,
        filePath: context.filePath ?? null,
        relativePath: context.relativePath ?? null
      };
    case 'outline-item':
      return {
        kind: 'outline-item',
        pos: context.pos ?? null
      };
    default:
      return { kind: 'fallback-editor' };
  }
}

export function getDeleteConfirmRestoreCandidateKinds(
  target: DeleteConfirmRestoreTarget
): DeleteConfirmRestoreTarget['kind'][] {
  switch (target.kind) {
    case 'files-row':
      return ['files-row', 'files-view', 'fallback-editor'];
    case 'files-search':
      return ['files-search', 'files-view', 'fallback-editor'];
    case 'files-view':
      return ['files-view', 'fallback-editor'];
    case 'outline-item':
      return ['outline-item', 'outline-view', 'fallback-editor'];
    case 'outline-view':
      return ['outline-view', 'fallback-editor'];
    case 'source-editor':
      return ['source-editor', 'fallback-editor'];
    case 'rendered-editor':
      return ['rendered-editor', 'fallback-editor'];
    default:
      return ['fallback-editor'];
  }
}
