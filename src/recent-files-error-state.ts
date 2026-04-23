export type RecentFilesErrorKind = 'storage' | 'menu-sync';

export const RECENT_FILES_STORAGE_ERROR_NOTICE = '最近文件列表无法写入本地存储。';
export const RECENT_FILES_MENU_SYNC_ERROR_NOTICE = '最近文件菜单同步失败。';

export type RecentFilesErrorReportDecision = {
  nextShown: boolean;
  notice: string | null;
};

export type RecentFilesErrorResetDecision = {
  nextShown: false;
};

export function resolveRecentFilesErrorReport(
  kind: RecentFilesErrorKind,
  alreadyShown: boolean
): RecentFilesErrorReportDecision {
  if (alreadyShown) {
    return {
      nextShown: true,
      notice: null
    };
  }

  return {
    nextShown: true,
    notice:
      kind === 'storage'
        ? RECENT_FILES_STORAGE_ERROR_NOTICE
        : RECENT_FILES_MENU_SYNC_ERROR_NOTICE
  };
}

export function resolveRecentFilesErrorReset(): RecentFilesErrorResetDecision {
  return {
    nextShown: false
  };
}
