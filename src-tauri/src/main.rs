#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
  fs,
  io::Read,
  path::{Path, PathBuf},
  process::Command,
  sync::Mutex,
  time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};
use tauri::{
  menu::{
    CheckMenuItem, CheckMenuItemBuilder, Menu, MenuBuilder, MenuItem, MenuItemBuilder,
    MenuItemKind, PredefinedMenuItem, Submenu, SubmenuBuilder,
  },
  AppHandle, Emitter, Manager, Runtime, State,
};
#[cfg(windows)]
use tauri::webview::PlatformWebview;
#[cfg(windows)]
use windows_core::Interface;
#[cfg(windows)]
use winreg::{enums::HKEY_CURRENT_USER, enums::HKEY_LOCAL_MACHINE, RegKey, HKEY};

const MENU_OPEN_FILE_ID: &str = "file-open";
const MENU_OPEN_FOLDER_ID: &str = "file-open-folder";
const MENU_NEW_FILE_ID: &str = "file-new";
const MENU_SAVE_FILE_ID: &str = "file-save";
const MENU_SAVE_AS_FILE_ID: &str = "file-save-as";
const MENU_RENAME_FILE_ID: &str = "file-rename";
const MENU_CLOSE_FILE_ID: &str = "file-close";
const MENU_EDIT_UNDO_ID: &str = "edit-undo";
const MENU_EDIT_REDO_ID: &str = "edit-redo";
const MENU_EDIT_FIND_ID: &str = "edit-find";
const MENU_EDIT_REPLACE_ID: &str = "edit-replace";
const MENU_CLEAR_RECENT_FILES_ID: &str = "file-clear-recent";
const MENU_RECENT_FILE_PREFIX: &str = "file-recent-open:";
const MENU_APPEARANCE_THEME_SYSTEM_ID: &str = "appearance-theme:system";
const MENU_APPEARANCE_THEME_LIGHT_ID: &str = "appearance-theme:light";
const MENU_APPEARANCE_THEME_DARK_ID: &str = "appearance-theme:dark";
const MENU_APPEARANCE_THEME_ONE_DARK_PRO_ID: &str = "appearance-theme:one-dark-pro";
const MENU_APPEARANCE_THEME_DRACULA_ID: &str = "appearance-theme:dracula";
const MENU_APPEARANCE_THEME_CATPPUCCIN_MOCHA_ID: &str = "appearance-theme:catppuccin-mocha";
const MENU_APPEARANCE_THEME_NIGHT_OWL_ID: &str = "appearance-theme:night-owl";
const MENU_APPEARANCE_THEME_TOKYO_NIGHT_ID: &str = "appearance-theme:tokyo-night";
const MENU_APPEARANCE_THEME_GITHUB_LIGHT_ID: &str = "appearance-theme:github-light";
const MENU_APPEARANCE_FONT_PANEL_OPEN_ID: &str = "appearance-font-panel:open";
const RECENT_FILES_MENU_LIMIT: usize = 10;
const APP_COMMAND_EVENT: &str = "request-app-command";
const EDITOR_COMMAND_MENU_PREFIX: &str = "editor-command:";
const TEXT_FILE_SCAN_MAX_DEPTH: usize = 8;
const TEXT_FILE_SCAN_MAX_FILES: usize = 2000;
const TEXT_FILE_PREVIEW_READ_LIMIT: usize = 16 * 1024;
const IGNORED_TEXT_SCAN_DIRECTORIES: &[&str] = &[
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "target",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".vite",
  ".tauri",
];

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MenuEnabledState {
  id: String,
  enabled: bool,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum AppCommandPayload {
  NewFile,
  OpenFile,
  OpenFolder,
  SaveFile,
  SaveAsFile,
  RenameFile,
  CloseFile,
  ClearRecentFiles,
  OpenRecentFile { path: String },
  OpenPendingExternalFiles,
  EditCommand {
    #[serde(rename = "commandId")]
    command_id: String,
  },
  EditorCommand {
    #[serde(rename = "commandId")]
    command_id: String,
  },
  SetAppearanceTheme {
    theme: String,
  },
  OpenAppearanceFontPanel,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AppearanceMenuState {
  theme: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum DocumentEncoding {
  Utf8,
  Utf8Bom,
  Utf16Le,
  Utf16Be,
  Lossy8Bit,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedDocument {
  file_name: String,
  file_path: String,
  directory_path: String,
  content: String,
  encoding: DocumentEncoding,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TextFileEntry {
  file_name: String,
  file_path: String,
  directory_path: String,
  relative_directory: String,
  modified_at: u64,
  preview: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryEntry {
  name: String,
  path: String,
  parent_path: String,
  relative_path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TextFileListResult {
  files: Vec<TextFileEntry>,
  directories: Vec<DirectoryEntry>,
  is_truncated: bool,
}

struct DecodedTextDocument {
  content: String,
  encoding: DocumentEncoding,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentMenuEntry {
  file_name: String,
  file_path: String,
}

struct RecentFileMenuState(Mutex<Vec<RecentMenuEntry>>);
struct PendingOpenPaths(Mutex<Vec<String>>);

#[derive(Clone, Copy)]
struct TextFileScanLimits {
  max_depth: usize,
  max_files: usize,
  preview_bytes: usize,
}

struct TextFileScanState {
  files: Vec<TextFileEntry>,
  directories: Vec<DirectoryEntry>,
  is_truncated: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PathEntryPayload {
  name: String,
  path: String,
  parent_path: String,
  is_directory: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RenamedDirectoryPayload {
  old_path: String,
  new_path: String,
  name: String,
  parent_path: String,
}

#[tauri::command]
fn open_markdown_file(path: String) -> Result<OpenedDocument, String> {
  let file_path = Path::new(&path);
  read_markdown_document(file_path)
}

#[tauri::command]
fn list_text_files(root_path: String) -> Result<TextFileListResult, String> {
  let root = PathBuf::from(root_path);

  if !root.is_dir() {
    return Err("The selected path is not a directory.".to_string());
  }

  Ok(list_text_files_with_limits(
    &root,
    TextFileScanLimits {
      max_depth: TEXT_FILE_SCAN_MAX_DEPTH,
      max_files: TEXT_FILE_SCAN_MAX_FILES,
      preview_bytes: TEXT_FILE_PREVIEW_READ_LIMIT,
    },
  ))
}

#[tauri::command]
fn update_recent_files_menu(
  app: AppHandle,
  state: State<RecentFileMenuState>,
  entries: Vec<RecentMenuEntry>,
) -> Result<(), String> {
  update_recent_file_menu_items(&app, &entries).map_err(|error| error.to_string())?;

  let mut cached_entries = state
    .0
    .lock()
    .map_err(|_| "Failed to lock recent files menu state.".to_string())?;
  *cached_entries = entries;
  Ok(())
}

#[tauri::command]
fn update_menu_enabled_states(app: AppHandle, states: Vec<MenuEnabledState>) -> Result<(), String> {
  let Some(menu) = app.menu() else {
    return Ok(());
  };

  let menu_items = menu.items().map_err(|error| error.to_string())?;

  for state in states {
    let Some(item) =
      find_menu_item_by_id(menu_items.clone(), &state.id).map_err(|error| error.to_string())?
    else {
      continue;
    };

    item
      .set_enabled(state.enabled)
      .map_err(|error| error.to_string())?;
  }

  Ok(())
}

#[tauri::command]
fn update_appearance_menu_state(app: AppHandle, state: AppearanceMenuState) -> Result<(), String> {
  sync_appearance_menu_state(&app, &state).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_installed_font_families() -> Result<Vec<String>, String> {
  Ok(list_installed_font_families_internal())
}

#[tauri::command]
fn validate_markdown_file_name(new_name: String) -> Result<String, String> {
  normalize_markdown_file_name(&new_name)
}

#[tauri::command]
fn validate_markdown_save_path(path: String) -> Result<String, String> {
  normalize_markdown_save_path(&path)
}

#[tauri::command]
fn save_markdown_file(
  path: String,
  content: String,
  encoding: DocumentEncoding,
) -> Result<OpenedDocument, String> {
  let normalized_path = normalize_markdown_save_path(&path)?;
  let file_path = Path::new(&normalized_path);
  let encoded = encode_text_content(&content, encoding)?;
  fs::write(file_path, encoded).map_err(|error| format!("Failed to save file: {error}"))?;
  read_markdown_document(file_path)
}

#[tauri::command]
fn rename_markdown_file(path: String, new_name: String) -> Result<OpenedDocument, String> {
  let file_path = Path::new(&path);
  let parent_directory = file_path
    .parent()
    .ok_or_else(|| "Could not resolve parent directory.".to_string())?;

  let normalized_name = normalize_markdown_file_name(&new_name)?;
  let target_path = parent_directory.join(normalized_name);

  if target_path == file_path {
    return read_markdown_document(file_path);
  }

  if target_path.exists() && !is_same_existing_path(file_path, &target_path) {
    return Err("The target file already exists.".to_string());
  }

  fs::rename(file_path, &target_path).map_err(|error| format!("Failed to rename file: {error}"))?;
  read_markdown_document(&target_path)
}

#[tauri::command]
fn create_markdown_file_in_directory(
  directory_path: String,
  file_name: String,
) -> Result<OpenedDocument, String> {
  let directory = Path::new(&directory_path);

  if !directory.is_dir() {
    return Err("The selected directory does not exist.".to_string());
  }

  let normalized_name = normalize_markdown_file_name(&file_name)?;
  let file_path = directory.join(normalized_name);

  if file_path.exists() {
    return Err("The target file already exists.".to_string());
  }

  fs::write(&file_path, b"").map_err(|error| format!("Failed to create file: {error}"))?;
  read_markdown_document(&file_path)
}

#[tauri::command]
fn create_folder_in_directory(
  directory_path: String,
  folder_name: String,
) -> Result<PathEntryPayload, String> {
  let directory = Path::new(&directory_path);

  if !directory.is_dir() {
    return Err("The selected directory does not exist.".to_string());
  }

  let normalized_name = normalize_file_name_component(&folder_name)?;
  let folder_path = directory.join(&normalized_name);

  if folder_path.exists() {
    return Err("The target folder already exists.".to_string());
  }

  fs::create_dir(&folder_path).map_err(|error| format!("Failed to create folder: {error}"))?;
  build_path_entry_payload(&folder_path)
}

#[tauri::command]
fn duplicate_fs_entry(path: String) -> Result<PathEntryPayload, String> {
  let source_path = Path::new(&path);

  if !source_path.exists() {
    return Err("The selected path does not exist.".to_string());
  }

  if fs::symlink_metadata(source_path)
    .map_err(|error| format!("Failed to read path metadata: {error}"))?
    .file_type()
    .is_symlink()
  {
    return Err("Cannot duplicate symbolic links or reparse points.".to_string());
  }

  let target_path = next_available_duplicate_path(source_path)?;

  if source_path.is_dir() {
    copy_directory_recursive(source_path, &target_path)?;
  } else {
    fs::copy(source_path, &target_path).map_err(|error| format!("Failed to duplicate file: {error}"))?;
  }

  build_path_entry_payload(&target_path)
}

#[tauri::command]
fn rename_directory(path: String, new_name: String) -> Result<RenamedDirectoryPayload, String> {
  let directory_path = Path::new(&path);

  if !directory_path.is_dir() {
    return Err("The selected path is not a directory.".to_string());
  }

  let parent_directory = directory_path
    .parent()
    .ok_or_else(|| "Could not resolve parent directory.".to_string())?;
  let normalized_name = normalize_file_name_component(&new_name)?;
  let target_path = parent_directory.join(&normalized_name);

  if target_path == directory_path {
    return Ok(RenamedDirectoryPayload {
      old_path: directory_path.to_string_lossy().into_owned(),
      new_path: target_path.to_string_lossy().into_owned(),
      name: normalized_name,
      parent_path: parent_directory.to_string_lossy().into_owned(),
    });
  }

  if target_path.exists() && !is_same_existing_path(directory_path, &target_path) {
    return Err("The target folder already exists.".to_string());
  }

  fs::rename(directory_path, &target_path)
    .map_err(|error| format!("Failed to rename folder: {error}"))?;

  Ok(RenamedDirectoryPayload {
    old_path: directory_path.to_string_lossy().into_owned(),
    new_path: target_path.to_string_lossy().into_owned(),
    name: normalized_name,
    parent_path: parent_directory.to_string_lossy().into_owned(),
  })
}

#[tauri::command]
fn move_path_to_recycle_bin(path: String) -> Result<(), String> {
  let target_path = Path::new(&path);

  if !target_path.exists() {
    return Err("The selected path does not exist.".to_string());
  }

  trash::delete(target_path).map_err(|error| format!("Failed to move item to recycle bin: {error}"))
}

#[tauri::command]
fn reveal_path_in_explorer(path: String) -> Result<(), String> {
  let target_path = Path::new(&path);

  if !target_path.exists() {
    return Err("The selected path does not exist.".to_string());
  }

  #[cfg(windows)]
  {
    let status = if target_path.is_dir() {
      Command::new("explorer")
        .arg(target_path.as_os_str())
        .status()
        .map_err(|error| format!("Failed to open Explorer: {error}"))?
    } else {
      Command::new("explorer")
        .arg(format!("/select,{}", target_path.to_string_lossy()))
        .status()
        .map_err(|error| format!("Failed to open Explorer: {error}"))?
    };

    if !status.success() {
      return Err("Explorer could not open the selected path.".to_string());
    }

    return Ok(());
  }

  #[cfg(not(windows))]
  {
    let _ = target_path;
    Err("This action is currently only supported on Windows.".to_string())
  }
}

fn read_markdown_document(file_path: &Path) -> Result<OpenedDocument, String> {
  let decoded = read_text_file(file_path)?;

  let file_name = file_path
    .file_name()
    .and_then(|name| name.to_str())
    .ok_or_else(|| "Could not resolve file name.".to_string())?
    .to_string();

  let directory_path = file_path
    .parent()
    .and_then(Path::to_str)
    .ok_or_else(|| "Could not resolve parent directory.".to_string())?
    .to_string();

  Ok(OpenedDocument {
    file_name,
    file_path: file_path.to_string_lossy().to_string(),
    directory_path,
    content: decoded.content,
    encoding: decoded.encoding,
  })
}

fn decode_utf16_bytes(bytes: &[u8], little_endian: bool) -> String {
  let mut units = Vec::with_capacity(bytes.len() / 2);
  let mut chunks = bytes.chunks_exact(2);

  for chunk in &mut chunks {
    let unit = if little_endian {
      u16::from_le_bytes([chunk[0], chunk[1]])
    } else {
      u16::from_be_bytes([chunk[0], chunk[1]])
    };
    units.push(unit);
  }

  String::from_utf16_lossy(&units)
}

fn encode_text_content(content: &str, encoding: DocumentEncoding) -> Result<Vec<u8>, String> {
  match encoding {
    DocumentEncoding::Utf8 => Ok(content.as_bytes().to_vec()),
    DocumentEncoding::Utf8Bom => {
      let mut bytes = vec![0xEF, 0xBB, 0xBF];
      bytes.extend_from_slice(content.as_bytes());
      Ok(bytes)
    }
    DocumentEncoding::Utf16Le => {
      let mut bytes = vec![0xFF, 0xFE];
      for unit in content.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
      }
      Ok(bytes)
    }
    DocumentEncoding::Utf16Be => {
      let mut bytes = vec![0xFE, 0xFF];
      for unit in content.encode_utf16() {
        bytes.extend_from_slice(&unit.to_be_bytes());
      }
      Ok(bytes)
    }
    DocumentEncoding::Lossy8Bit => Err(
      "This file uses an unknown legacy encoding and cannot be safely saved.".to_string(),
    ),
  }
}

fn build_path_entry_payload(path: &Path) -> Result<PathEntryPayload, String> {
  let metadata = fs::metadata(path).map_err(|error| format!("Failed to read path metadata: {error}"))?;
  let name = path
    .file_name()
    .and_then(|name| name.to_str())
    .ok_or_else(|| "Could not resolve file name.".to_string())?
    .to_string();
  let parent_path = path
    .parent()
    .and_then(Path::to_str)
    .unwrap_or("")
    .to_string();

  Ok(PathEntryPayload {
    name,
    path: path.to_string_lossy().into_owned(),
    parent_path,
    is_directory: metadata.is_dir(),
  })
}

fn next_available_duplicate_path(path: &Path) -> Result<PathBuf, String> {
  let parent_directory = path
    .parent()
    .ok_or_else(|| "Could not resolve parent directory.".to_string())?;
  let file_name = path
    .file_name()
    .and_then(|value| value.to_str())
    .ok_or_else(|| "Could not resolve file name.".to_string())?;

  if path.is_dir() {
    for index in 1..10_000 {
      let suffix = if index == 1 {
        " copy".to_string()
      } else {
        format!(" copy {index}")
      };
      let candidate = parent_directory.join(format!("{file_name}{suffix}"));

      if !candidate.exists() {
        return Ok(candidate);
      }
    }
  } else {
    let stem = path
      .file_stem()
      .and_then(|value| value.to_str())
      .ok_or_else(|| "Could not resolve file name.".to_string())?;
    let extension = path.extension().and_then(|value| value.to_str());

    for index in 1..10_000 {
      let suffix = if index == 1 {
        " copy".to_string()
      } else {
        format!(" copy {index}")
      };
      let candidate_name = match extension {
        Some(extension) => format!("{stem}{suffix}.{extension}"),
        None => format!("{stem}{suffix}"),
      };
      let candidate = parent_directory.join(candidate_name);

      if !candidate.exists() {
        return Ok(candidate);
      }
    }
  }

  Err("Could not find an available duplicate path.".to_string())
}

fn copy_directory_recursive(source: &Path, target: &Path) -> Result<(), String> {
  fs::create_dir(target).map_err(|error| format!("Failed to create duplicate folder: {error}"))?;

  if let Err(error) = copy_directory_recursive_inner(source, target) {
    let _ = fs::remove_dir_all(target);
    return Err(error);
  }

  Ok(())
}

fn copy_directory_recursive_inner(source: &Path, target: &Path) -> Result<(), String> {
  for entry in fs::read_dir(source).map_err(|error| format!("Failed to read directory: {error}"))? {
    let entry = entry.map_err(|error| format!("Failed to read directory entry: {error}"))?;
    let source_path = entry.path();
    let target_path = target.join(entry.file_name());
    let file_type = entry
      .file_type()
      .map_err(|error| format!("Failed to read entry type: {error}"))?;

    if file_type.is_symlink() {
      return Err("Cannot duplicate directories containing symbolic links or reparse points.".to_string());
    }

    if file_type.is_dir() {
      fs::create_dir(&target_path)
        .map_err(|error| format!("Failed to create duplicate folder: {error}"))?;
      copy_directory_recursive_inner(&source_path, &target_path)?;
    } else {
      fs::copy(&source_path, &target_path)
        .map_err(|error| format!("Failed to duplicate file: {error}"))?;
    }
  }

  Ok(())
}

fn list_text_files_with_limits(root: &Path, limits: TextFileScanLimits) -> TextFileListResult {
  let mut state = TextFileScanState {
    files: Vec::new(),
    directories: Vec::new(),
    is_truncated: false,
  };

  collect_text_files(root, root, 0, limits, &mut state);
  state
    .files
    .sort_by(|left, right| left.file_path.cmp(&right.file_path));
  state
    .directories
    .sort_by(|left, right| left.path.cmp(&right.path));

  TextFileListResult {
    files: state.files,
    directories: state.directories,
    is_truncated: state.is_truncated,
  }
}

fn collect_sorted_directory_entries(directory: &Path) -> Vec<fs::DirEntry> {
  let Ok(entries) = fs::read_dir(directory) else {
    return Vec::new();
  };

  let mut collected = entries.flatten().collect::<Vec<_>>();
  collected.sort_by(|left, right| {
    left
      .path()
      .to_string_lossy()
      .cmp(&right.path().to_string_lossy())
  });
  collected
}

fn collect_text_files(
  root: &Path,
  directory: &Path,
  depth: usize,
  limits: TextFileScanLimits,
  state: &mut TextFileScanState,
) {
  if depth > limits.max_depth {
    state.is_truncated = true;
    return;
  }

  for entry in collect_sorted_directory_entries(directory) {
    let path = entry.path();
    let Ok(file_type) = entry.file_type() else {
      continue;
    };

    if file_type.is_symlink() {
      continue;
    }

    if file_type.is_dir() {
      if should_skip_text_scan_directory(&path) {
        continue;
      }

      if depth + 1 > limits.max_depth {
        state.is_truncated = true;
        continue;
      }

      if let Some(directory) = build_directory_entry(root, &path) {
        state.directories.push(directory);
      }

      collect_text_files(root, &path, depth + 1, limits, state);
      continue;
    }

    if !file_type.is_file() || !is_supported_text_file(&path) {
      continue;
    }

    if state.files.len() >= limits.max_files {
      state.is_truncated = true;
      continue;
    }

    if let Some(file) = build_text_file_entry_with_preview_limit(root, &path, limits.preview_bytes)
    {
      state.files.push(file);
    }
  }
}

fn build_text_file_entry_with_preview_limit(
  root: &Path,
  file_path: &Path,
  preview_bytes: usize,
) -> Option<TextFileEntry> {
  let file_name = file_path.file_name()?.to_str()?.to_string();
  let directory = file_path.parent()?;
  let directory_path = directory.to_string_lossy().to_string();
  let relative_directory = directory
    .strip_prefix(root)
    .ok()
    .map(format_relative_directory)
    .filter(|label| !label.is_empty())
    .unwrap_or_else(|| ".".to_string());
  let modified_at = fs::metadata(file_path)
    .and_then(|metadata| metadata.modified())
    .ok()
    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
    .map(|duration| duration.as_millis() as u64)
    .unwrap_or(0);
  let preview = read_limited_text(file_path, preview_bytes)
    .map(|content| build_text_preview(&content))
    .unwrap_or_else(|_| String::new());

  Some(TextFileEntry {
    file_name,
    file_path: file_path.to_string_lossy().to_string(),
    directory_path,
    relative_directory,
    modified_at,
    preview,
  })
}

fn build_directory_entry(root: &Path, directory_path: &Path) -> Option<DirectoryEntry> {
  let name = directory_path.file_name()?.to_str()?.to_string();
  let parent_path = directory_path.parent()?.to_string_lossy().to_string();
  let relative_path = directory_path
    .strip_prefix(root)
    .ok()
    .map(format_relative_directory)
    .filter(|label| !label.is_empty() && label != ".")?;

  Some(DirectoryEntry {
    name,
    path: directory_path.to_string_lossy().to_string(),
    parent_path,
    relative_path,
  })
}

fn decode_text_bytes(bytes: &[u8]) -> DecodedTextDocument {
  const UTF8_BOM: &[u8; 3] = &[0xEF, 0xBB, 0xBF];
  const UTF16_LE_BOM: &[u8; 2] = &[0xFF, 0xFE];
  const UTF16_BE_BOM: &[u8; 2] = &[0xFE, 0xFF];

  if let Some(content) = bytes.strip_prefix(UTF8_BOM) {
    return DecodedTextDocument {
      content: String::from_utf8_lossy(content).into_owned(),
      encoding: DocumentEncoding::Utf8Bom,
    };
  }

  if let Some(content) = bytes.strip_prefix(UTF16_LE_BOM) {
    return DecodedTextDocument {
      content: decode_utf16_bytes(content, true),
      encoding: DocumentEncoding::Utf16Le,
    };
  }

  if let Some(content) = bytes.strip_prefix(UTF16_BE_BOM) {
    return DecodedTextDocument {
      content: decode_utf16_bytes(content, false),
      encoding: DocumentEncoding::Utf16Be,
    };
  }

  match String::from_utf8(bytes.to_vec()) {
    Ok(content) => DecodedTextDocument {
      content,
      encoding: DocumentEncoding::Utf8,
    },
    Err(_) => DecodedTextDocument {
      content: String::from_utf8_lossy(bytes).into_owned(),
      encoding: DocumentEncoding::Lossy8Bit,
    },
  }
}

fn read_text_file(file_path: &Path) -> Result<DecodedTextDocument, String> {
  let bytes = fs::read(file_path).map_err(|error| format!("Failed to read file: {error}"))?;
  Ok(decode_text_bytes(&bytes))
}

fn read_limited_text(file_path: &Path, byte_limit: usize) -> std::io::Result<String> {
  let file = fs::File::open(file_path)?;
  let mut reader = file.take(byte_limit as u64);
  let mut buffer = Vec::new();
  reader.read_to_end(&mut buffer)?;

  Ok(decode_text_bytes(&buffer).content)
}

fn should_skip_text_scan_directory(path: &Path) -> bool {
  let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
    return false;
  };

  IGNORED_TEXT_SCAN_DIRECTORIES
    .iter()
    .any(|ignored| name.eq_ignore_ascii_case(ignored))
}

fn format_relative_directory(path: &Path) -> String {
  let label = path.to_string_lossy().to_string();

  if label.is_empty() {
    ".".to_string()
  } else {
    label
  }
}

fn build_text_preview(content: &str) -> String {
  content
    .lines()
    .map(str::trim)
    .filter(|line| !line.is_empty())
    .take(2)
    .collect::<Vec<_>>()
    .join(" ")
}

fn is_supported_text_file(file_path: &Path) -> bool {
  let Some(extension) = file_path.extension().and_then(|extension| extension.to_str()) else {
    return false;
  };

  matches!(
    extension.to_ascii_lowercase().as_str(),
    "md" | "markdown" | "txt"
  )
}

fn normalize_file_name_component(file_name: &str) -> Result<String, String> {
  let trimmed = file_name.trim().trim_end_matches([' ', '.']);

  if trimmed.is_empty() {
    return Err("The file name cannot be empty.".to_string());
  }

  if trimmed.contains(['\\', '/']) {
    return Err("The file name cannot include path separators.".to_string());
  }

  if trimmed.contains(['<', '>', ':', '"', '|', '?', '*']) {
    return Err("The file name contains characters not allowed on Windows.".to_string());
  }

  let stem = trimmed.trim_start_matches('.');

  if stem.is_empty() {
    return Err("The file name must include a name before the extension.".to_string());
  }

  if matches!(trimmed.rfind('.'), Some(0)) {
    return Err("The file name must include a name before the extension.".to_string());
  }

  let reserved_stem = trimmed
    .rsplit_once('.')
    .map(|(name, _)| name)
    .unwrap_or(trimmed)
    .trim_end_matches([' ', '.'])
    .to_ascii_uppercase();

  if matches!(
    reserved_stem.as_str(),
    "CON"
      | "PRN"
      | "AUX"
      | "NUL"
      | "COM1"
      | "COM2"
      | "COM3"
      | "COM4"
      | "COM5"
      | "COM6"
      | "COM7"
      | "COM8"
      | "COM9"
      | "LPT1"
      | "LPT2"
      | "LPT3"
      | "LPT4"
      | "LPT5"
      | "LPT6"
      | "LPT7"
      | "LPT8"
      | "LPT9"
  ) {
    return Err("The file name is reserved by Windows and cannot be used.".to_string());
  }

  Ok(trimmed.to_string())
}

fn is_same_existing_path(source_path: &Path, target_path: &Path) -> bool {
  #[cfg(windows)]
  {
    source_path
      .to_string_lossy()
      .to_lowercase()
      == target_path.to_string_lossy().to_lowercase()
  }

  #[cfg(not(windows))]
  {
    source_path == target_path
  }
}

fn is_supported_save_extension(extension: &str) -> bool {
  matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown" | "txt")
}

fn normalize_markdown_file_name(new_name: &str) -> Result<String, String> {
  let trimmed = normalize_file_name_component(new_name)?;
  let dot_index = trimmed.rfind('.');

  let normalized = match dot_index {
    Some(index) if index > 0 && index < trimmed.len() - 1 => {
      let extension = trimmed[index + 1..].to_ascii_lowercase();

      if extension == "md" || extension == "markdown" || extension == "txt" {
        trimmed
      } else {
        return Err("The file name must end with .md, .markdown or .txt.".to_string());
      }
    }
    _ => format!("{trimmed}.md"),
  };

  Ok(normalized)
}

fn normalize_markdown_save_path(path: &str) -> Result<String, String> {
  let trimmed = path.trim();

  if trimmed.is_empty() {
    return Err("The save path cannot be empty.".to_string());
  }

  let mut normalized_path = PathBuf::from(trimmed);
  let file_name = normalized_path
    .file_name()
    .ok_or_else(|| "The save path must include a file name.".to_string())?
    .to_str()
    .ok_or_else(|| "The save path contains characters that are not supported.".to_string())?;
  let normalized_file_name = normalize_file_name_component(file_name)?;
  let normalized_name = match normalized_file_name.rfind('.') {
    Some(index) if index > 0 && index < normalized_file_name.len() - 1 => {
      let extension = &normalized_file_name[index + 1..];

      if is_supported_save_extension(extension) {
        normalized_file_name
      } else {
        return Err("The file name must end with .md, .markdown or .txt.".to_string());
      }
    }
    _ => format!("{normalized_file_name}.md"),
  };
  normalized_path.set_file_name(normalized_name);

  Ok(normalized_path.to_string_lossy().into_owned())
}

fn menu_item<R: Runtime>(
  app: &AppHandle<R>,
  id: &str,
  text: &str,
  accelerator: Option<&str>,
) -> tauri::Result<MenuItem<R>> {
  let mut builder = MenuItemBuilder::with_id(id, text);

  if let Some(accelerator) = accelerator {
    builder = builder.accelerator(accelerator);
  }

  builder.build(app)
}

fn editor_command_menu_item<R: Runtime>(
  app: &AppHandle<R>,
  command_id: &str,
  text: &str,
  accelerator: Option<&str>,
) -> tauri::Result<MenuItem<R>> {
  menu_item(
    app,
    &format!("{EDITOR_COMMAND_MENU_PREFIX}{command_id}"),
    text,
    accelerator,
  )
}

fn check_menu_item<R: Runtime>(
  app: &AppHandle<R>,
  id: &str,
  text: &str,
  checked: bool,
) -> tauri::Result<CheckMenuItem<R>> {
  CheckMenuItemBuilder::with_id(id, text)
    .checked(checked)
    .build(app)
}

fn appearance_font_panel_menu_item_id() -> &'static str {
  MENU_APPEARANCE_FONT_PANEL_OPEN_ID
}

fn normalize_windows_font_menu_label(value_name: &str) -> Option<String> {
  let trimmed = value_name.trim();

  if trimmed.is_empty() || trimmed.starts_with('@') {
    return None;
  }

  let normalized = trimmed
    .strip_suffix(" (TrueType)")
    .or_else(|| trimmed.strip_suffix(" (OpenType)"))
    .or_else(|| trimmed.strip_suffix(" (All res)"))
    .or_else(|| trimmed.strip_suffix(" (Variable TrueType)"))
    .unwrap_or(trimmed)
    .trim();

  if normalized.is_empty() {
    return None;
  }

  Some(normalized.to_string())
}

fn normalize_windows_font_family_name(value_name: &str) -> Option<String> {
  let label = normalize_windows_font_menu_label(value_name)?;
  let mut tokens = label
    .split_whitespace()
    .map(str::to_string)
    .collect::<Vec<String>>();
  let removable_suffixes = [
    "thin",
    "extralight",
    "ultralight",
    "light",
    "normal",
    "regular",
    "medium",
    "semilight",
    "demilight",
    "semibold",
    "demibold",
    "bold",
    "extrabold",
    "ultrabold",
    "black",
    "heavy",
    "italic",
    "oblique",
  ];

  while let Some(last) = tokens.last() {
    let normalized = last
      .chars()
      .filter(|character| character.is_ascii_alphanumeric())
      .collect::<String>()
      .to_lowercase();

    if !removable_suffixes.contains(&normalized.as_str()) {
      break;
    }

    tokens.pop();
  }

  if tokens.is_empty() {
    return Some(label);
  }

  Some(tokens.join(" "))
}

#[cfg(windows)]
fn extend_installed_font_names_from_registry(root: HKEY, fonts: &mut Vec<String>) {
  let hive = RegKey::predef(root);
  let Ok(key) = hive.open_subkey("Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts") else {
    return;
  };

  for value_name in key.enum_values().flatten().map(|entry| entry.0) {
    if let Some(label) = normalize_windows_font_family_name(&value_name) {
      fonts.push(label);
    }
  }
}

#[cfg(not(windows))]
fn extend_installed_font_names_from_registry(_root: usize, _fonts: &mut Vec<String>) {}

fn list_installed_font_families_internal() -> Vec<String> {
  let mut fonts = Vec::new();

  #[cfg(windows)]
  {
    extend_installed_font_names_from_registry(HKEY_LOCAL_MACHINE, &mut fonts);
    extend_installed_font_names_from_registry(HKEY_CURRENT_USER, &mut fonts);
  }

  fonts.sort_by_key(|name| name.to_lowercase());
  fonts.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
  fonts
}

fn build_appearance_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
  let theme_menu = SubmenuBuilder::new(app, "\u{4e3b}\u{9898}")
    .item(&check_menu_item(
      app,
      MENU_APPEARANCE_THEME_SYSTEM_ID,
      "\u{8ddf}\u{968f}\u{7cfb}\u{7edf}",
      true,
    )?)
    .item(&check_menu_item(
      app,
      MENU_APPEARANCE_THEME_LIGHT_ID,
      "\u{6d45}\u{8272}",
      false,
    )?)
    .item(&check_menu_item(
      app,
      MENU_APPEARANCE_THEME_DARK_ID,
      "\u{6df1}\u{8272}",
      false,
    )?)
    .item(&PredefinedMenuItem::separator(app)?)
    .item(&check_menu_item(
      app,
      MENU_APPEARANCE_THEME_ONE_DARK_PRO_ID,
      "One Dark Pro",
      false,
    )?)
    .item(&check_menu_item(
      app,
      MENU_APPEARANCE_THEME_DRACULA_ID,
      "Dracula",
      false,
    )?)
    .item(&check_menu_item(
      app,
      MENU_APPEARANCE_THEME_CATPPUCCIN_MOCHA_ID,
      "Catppuccin Mocha",
      false,
    )?)
    .item(&check_menu_item(
      app,
      MENU_APPEARANCE_THEME_NIGHT_OWL_ID,
      "Night Owl",
      false,
    )?)
    .item(&check_menu_item(
      app,
      MENU_APPEARANCE_THEME_TOKYO_NIGHT_ID,
      "Tokyo Night",
      false,
    )?)
    .item(&check_menu_item(
      app,
      MENU_APPEARANCE_THEME_GITHUB_LIGHT_ID,
      "GitHub Light",
      false,
    )?)
    .build()?;

  SubmenuBuilder::new(app, "\u{5916}\u{89c2}(&A)")
    .item(&theme_menu)
    .item(&menu_item(
      app,
      appearance_font_panel_menu_item_id(),
      "\u{5b57}\u{4f53}...",
      None,
    )?)
    .build()
}

fn recent_file_menu_item_id(index: usize) -> String {
  format!("{MENU_RECENT_FILE_PREFIX}{index}")
}

fn disabled_recent_file_label(index: usize) -> String {
  format!("{}  -", index + 1)
}

fn find_menu_item_by_id<R: Runtime>(
  items: Vec<MenuItemKind<R>>,
  target_id: &str,
) -> tauri::Result<Option<MenuItem<R>>> {
  for item in items {
    match item {
      MenuItemKind::MenuItem(menu_item) if menu_item.id().as_ref() == target_id => {
        return Ok(Some(menu_item));
      }
      MenuItemKind::Submenu(submenu) => {
        if let Some(found) = find_menu_item_by_id(submenu.items()?, target_id)? {
          return Ok(Some(found));
        }
      }
      _ => {}
    }
  }

  Ok(None)
}

fn find_check_menu_item_by_id<R: Runtime>(
  items: Vec<MenuItemKind<R>>,
  target_id: &str,
) -> tauri::Result<Option<CheckMenuItem<R>>> {
  for item in items {
    match item {
      MenuItemKind::Check(check_item) if check_item.id().as_ref() == target_id => {
        return Ok(Some(check_item));
      }
      MenuItemKind::Submenu(submenu) => {
        if let Some(found) = find_check_menu_item_by_id(submenu.items()?, target_id)? {
          return Ok(Some(found));
        }
      }
      _ => {}
    }
  }

  Ok(None)
}

fn set_check_menu_item_checked<R: Runtime>(
  menu_items: &[MenuItemKind<R>],
  target_id: &str,
  checked: bool,
) -> tauri::Result<()> {
  let Some(item) = find_check_menu_item_by_id(menu_items.to_vec(), target_id)? else {
    return Ok(());
  };

  item.set_checked(checked)
}

fn sync_appearance_menu_state<R: Runtime>(
  app: &AppHandle<R>,
  state: &AppearanceMenuState,
) -> tauri::Result<()> {
  let Some(menu) = app.menu() else {
    return Ok(());
  };

  let menu_items = menu.items()?;
  let theme = match state.theme.as_str() {
    "light" => MENU_APPEARANCE_THEME_LIGHT_ID,
    "dark" => MENU_APPEARANCE_THEME_DARK_ID,
    "one-dark-pro" => MENU_APPEARANCE_THEME_ONE_DARK_PRO_ID,
    "dracula" => MENU_APPEARANCE_THEME_DRACULA_ID,
    "catppuccin-mocha" => MENU_APPEARANCE_THEME_CATPPUCCIN_MOCHA_ID,
    "night-owl" => MENU_APPEARANCE_THEME_NIGHT_OWL_ID,
    "tokyo-night" => MENU_APPEARANCE_THEME_TOKYO_NIGHT_ID,
    "github-light" => MENU_APPEARANCE_THEME_GITHUB_LIGHT_ID,
    _ => MENU_APPEARANCE_THEME_SYSTEM_ID,
  };

  for (menu_id, is_checked) in [
    (
      MENU_APPEARANCE_THEME_SYSTEM_ID,
      theme == MENU_APPEARANCE_THEME_SYSTEM_ID,
    ),
    (
      MENU_APPEARANCE_THEME_LIGHT_ID,
      theme == MENU_APPEARANCE_THEME_LIGHT_ID,
    ),
    (
      MENU_APPEARANCE_THEME_DARK_ID,
      theme == MENU_APPEARANCE_THEME_DARK_ID,
    ),
    (
      MENU_APPEARANCE_THEME_ONE_DARK_PRO_ID,
      theme == MENU_APPEARANCE_THEME_ONE_DARK_PRO_ID,
    ),
    (
      MENU_APPEARANCE_THEME_DRACULA_ID,
      theme == MENU_APPEARANCE_THEME_DRACULA_ID,
    ),
    (
      MENU_APPEARANCE_THEME_CATPPUCCIN_MOCHA_ID,
      theme == MENU_APPEARANCE_THEME_CATPPUCCIN_MOCHA_ID,
    ),
    (
      MENU_APPEARANCE_THEME_NIGHT_OWL_ID,
      theme == MENU_APPEARANCE_THEME_NIGHT_OWL_ID,
    ),
    (
      MENU_APPEARANCE_THEME_TOKYO_NIGHT_ID,
      theme == MENU_APPEARANCE_THEME_TOKYO_NIGHT_ID,
    ),
    (
      MENU_APPEARANCE_THEME_GITHUB_LIGHT_ID,
      theme == MENU_APPEARANCE_THEME_GITHUB_LIGHT_ID,
    ),
  ] {
    set_check_menu_item_checked(&menu_items, menu_id, is_checked)?;
  }

  Ok(())
}

fn update_recent_file_menu_items<R: Runtime>(
  app: &AppHandle<R>,
  entries: &[RecentMenuEntry],
) -> tauri::Result<()> {
  let Some(menu) = app.menu() else {
    return Ok(());
  };

  let menu_items = menu.items()?;

  for index in 0..RECENT_FILES_MENU_LIMIT {
    let id = recent_file_menu_item_id(index);
    let Some(item) = find_menu_item_by_id(menu_items.clone(), &id)? else {
      continue;
    };

    if let Some(entry) = entries.get(index) {
      item.set_text(format!("{}  {}", index + 1, entry.file_name))?;
      item.set_enabled(true)?;
    } else {
      item.set_text(disabled_recent_file_label(index))?;
      item.set_enabled(false)?;
    }
  }

  Ok(())
}

fn build_recent_files_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
  let mut builder = SubmenuBuilder::new(app, "\u{6253}\u{5f00}\u{6700}\u{8fd1}\u{6587}\u{4ef6}");

  for index in 0..RECENT_FILES_MENU_LIMIT {
    builder = builder.item(
      &MenuItemBuilder::with_id(recent_file_menu_item_id(index), disabled_recent_file_label(index))
        .enabled(false)
        .build(app)?,
    );
  }

  builder
    .separator()
    .item(&menu_item(
      app,
      MENU_CLEAR_RECENT_FILES_ID,
      "\u{6e05}\u{9664}\u{6700}\u{8fd1}\u{6587}\u{4ef6}",
      None,
    )?)
    .build()
}

fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
  let recent_menu = build_recent_files_menu(app)?;
  let table_menu = SubmenuBuilder::new(app, "\u{8868}\u{683c}")
    .item(&editor_command_menu_item(
      app,
      "table-insert",
      "\u{63d2}\u{5165}\u{8868}\u{683c}",
      Some("Ctrl+T"),
    )?)
    .separator()
    .item(&editor_command_menu_item(
      app,
      "table-row-above",
      "\u{4e0a}\u{65b9}\u{63d2}\u{5165}\u{884c}",
      None,
    )?)
    .item(&editor_command_menu_item(
      app,
      "table-row-below",
      "\u{4e0b}\u{65b9}\u{63d2}\u{5165}\u{884c}",
      Some("Ctrl+Enter"),
    )?)
    .separator()
    .item(&editor_command_menu_item(
      app,
      "table-col-left",
      "\u{5de6}\u{4fa7}\u{63d2}\u{5165}\u{5217}",
      None,
    )?)
    .item(&editor_command_menu_item(
      app,
      "table-col-right",
      "\u{53f3}\u{4fa7}\u{63d2}\u{5165}\u{5217}",
      None,
    )?)
    .separator()
    .item(&editor_command_menu_item(
      app,
      "table-row-up",
      "\u{4e0a}\u{79fb}\u{8be5}\u{884c}",
      Some("Alt+Up"),
    )?)
    .item(&editor_command_menu_item(
      app,
      "table-row-down",
      "\u{4e0b}\u{79fb}\u{8be5}\u{884c}",
      Some("Alt+Down"),
    )?)
    .item(&editor_command_menu_item(
      app,
      "table-col-move-left",
      "\u{5de6}\u{79fb}\u{8be5}\u{5217}",
      Some("Alt+Left"),
    )?)
    .item(&editor_command_menu_item(
      app,
      "table-col-move-right",
      "\u{53f3}\u{79fb}\u{8be5}\u{5217}",
      Some("Alt+Right"),
    )?)
    .separator()
    .item(&editor_command_menu_item(
      app,
      "table-delete-row",
      "\u{5220}\u{9664}\u{884c}",
      None,
    )?)
    .item(&editor_command_menu_item(
      app,
      "table-delete-col",
      "\u{5220}\u{9664}\u{5217}",
      None,
    )?)
    .item(&editor_command_menu_item(
      app,
      "table-delete",
      "\u{5220}\u{9664}\u{8868}\u{683c}",
      None,
    )?)
    .build()?;

  let file_menu = SubmenuBuilder::new(app, "\u{6587}\u{4ef6}(&F)")
    .item(&menu_item(app, MENU_NEW_FILE_ID, "\u{65b0}\u{5efa}", Some("Ctrl+N"))?)
    .item(&menu_item(app, MENU_OPEN_FILE_ID, "\u{6253}\u{5f00}...", Some("Ctrl+O"))?)
    .item(&menu_item(
      app,
      MENU_OPEN_FOLDER_ID,
      "\u{6253}\u{5f00}\u{6587}\u{4ef6}\u{5939}...",
      None,
    )?)
    .separator()
    .item(&recent_menu)
    .separator()
    .item(&menu_item(app, MENU_SAVE_FILE_ID, "\u{4fdd}\u{5b58}", Some("Ctrl+S"))?)
    .item(&menu_item(
      app,
      MENU_SAVE_AS_FILE_ID,
      "\u{53e6}\u{5b58}\u{4e3a}...",
      Some("Ctrl+Shift+S"),
    )?)
    .item(&menu_item(app, MENU_RENAME_FILE_ID, "\u{91cd}\u{547d}\u{540d}", None)?)
    .separator()
    .item(&menu_item(app, MENU_CLOSE_FILE_ID, "\u{5173}\u{95ed}", Some("Ctrl+W"))?)
    .build()?;
  let edit_menu = SubmenuBuilder::new(app, "\u{7f16}\u{8f91}(&E)")
    .item(&menu_item(app, MENU_EDIT_UNDO_ID, "\u{64a4}\u{9500}", Some("Ctrl+Z"))?)
    .item(&menu_item(app, MENU_EDIT_REDO_ID, "\u{6062}\u{590d}", Some("Ctrl+Y"))?)
    .separator()
    .item(&PredefinedMenuItem::cut(app, Some("\u{526a}\u{5207}"))?)
    .item(&PredefinedMenuItem::copy(app, Some("\u{590d}\u{5236}"))?)
    .item(&PredefinedMenuItem::paste(app, Some("\u{7c98}\u{8d34}"))?)
    .separator()
    .item(&menu_item(app, MENU_EDIT_FIND_ID, "\u{67e5}\u{627e}", Some("Ctrl+F"))?)
    .item(&menu_item(app, MENU_EDIT_REPLACE_ID, "\u{66ff}\u{6362}", Some("Ctrl+H"))?)
    .separator()
    .item(&PredefinedMenuItem::select_all(app, Some("\u{5168}\u{9009}"))?)
    .build()?;
  let paragraph_menu = SubmenuBuilder::new(app, "\u{6bb5}\u{843d}(&P)")
    .item(&editor_command_menu_item(
      app,
      "heading-1",
      "\u{4e00}\u{7ea7}\u{6807}\u{9898}",
      Some("Ctrl+1"),
    )?)
    .item(&editor_command_menu_item(
      app,
      "heading-2",
      "\u{4e8c}\u{7ea7}\u{6807}\u{9898}",
      Some("Ctrl+2"),
    )?)
    .item(&editor_command_menu_item(
      app,
      "heading-3",
      "\u{4e09}\u{7ea7}\u{6807}\u{9898}",
      Some("Ctrl+3"),
    )?)
    .item(&editor_command_menu_item(
      app,
      "heading-4",
      "\u{56db}\u{7ea7}\u{6807}\u{9898}",
      Some("Ctrl+4"),
    )?)
    .item(&editor_command_menu_item(
      app,
      "heading-5",
      "\u{4e94}\u{7ea7}\u{6807}\u{9898}",
      Some("Ctrl+5"),
    )?)
    .item(&editor_command_menu_item(
      app,
      "heading-6",
      "\u{516d}\u{7ea7}\u{6807}\u{9898}",
      Some("Ctrl+6"),
    )?)
    .separator()
    .item(&editor_command_menu_item(
      app,
      "paragraph",
      "\u{6bb5}\u{843d}",
      Some("Ctrl+0"),
    )?)
    .separator()
    .item(&editor_command_menu_item(
      app,
      "heading-promote",
      "\u{63d0}\u{5347}\u{6807}\u{9898}\u{7ea7}\u{522b}",
      Some("Ctrl+="),
    )?)
    .item(&editor_command_menu_item(
      app,
      "heading-demote",
      "\u{964d}\u{4f4e}\u{6807}\u{9898}\u{7ea7}\u{522b}",
      Some("Ctrl+-"),
    )?)
    .separator()
    .item(&table_menu)
    .separator()
    .item(&editor_command_menu_item(
      app,
      "blockquote",
      "\u{5f15}\u{7528}",
      Some("Ctrl+Shift+Q"),
    )?)
    .item(&editor_command_menu_item(
      app,
      "ordered-list",
      "\u{6709}\u{5e8f}\u{5217}\u{8868}",
      Some("Ctrl+Shift+["),
    )?)
    .item(&editor_command_menu_item(
      app,
      "bullet-list",
      "\u{65e0}\u{5e8f}\u{5217}\u{8868}",
      Some("Ctrl+Shift+]"),
    )?)
    .item(&editor_command_menu_item(
      app,
      "code-block",
      "\u{4ee3}\u{7801}\u{5757}",
      Some("Ctrl+Shift+K"),
    )?)
    .build()?;
  let format_menu = SubmenuBuilder::new(app, "\u{683c}\u{5f0f}(&O)")
    .item(&editor_command_menu_item(
      app,
      "inline-strong",
      "\u{7c97}\u{4f53}",
      Some("Ctrl+B"),
    )?)
    .item(&editor_command_menu_item(
      app,
      "inline-emphasis",
      "\u{659c}\u{4f53}",
      Some("Ctrl+I"),
    )?)
    .item(&editor_command_menu_item(
      app,
      "inline-strike",
      "\u{5220}\u{9664}\u{7ebf}",
      Some("Alt+Shift+5"),
    )?)
    .item(&editor_command_menu_item(
      app,
      "inline-code",
      "\u{884c}\u{5185}\u{4ee3}\u{7801}",
      Some("Ctrl+Shift+`"),
    )?)
    .separator()
    .item(&editor_command_menu_item(
      app,
      "inline-highlight",
      "\u{9ad8}\u{4eae}",
      None,
    )?)
    .item(&editor_command_menu_item(
      app,
      "inline-superscript",
      "\u{4e0a}\u{6807}",
      None,
    )?)
    .item(&editor_command_menu_item(
      app,
      "inline-subscript",
      "\u{4e0b}\u{6807}",
      None,
    )?)
    .item(&editor_command_menu_item(
      app,
      "inline-kbd",
      "\u{6309}\u{952e}",
      None,
    )?)
    .build()?;
  let appearance_menu = build_appearance_menu(app)?;

  MenuBuilder::new(app)
    .items(&[
      &file_menu,
      &edit_menu,
      &paragraph_menu,
      &format_menu,
      &appearance_menu,
    ])
    .build()
}

fn emit_app_command<R: Runtime>(app: &AppHandle<R>, payload: AppCommandPayload) {
  if let Err(error) = app.emit_to("main", APP_COMMAND_EVENT, payload) {
    eprintln!("Failed to emit app command to main webview: {error}");
  }
}

#[cfg(windows)]
fn disable_windows_browser_accelerator_keys<R: Runtime>(app: &AppHandle<R>) {
  let Some(main_webview) = app.get_webview_window("main") else {
    eprintln!("Failed to resolve main webview while configuring browser accelerator keys.");
    return;
  };

  if let Err(error) = main_webview.with_webview(|webview: PlatformWebview| unsafe {
    let result = webview.controller().CoreWebView2().and_then(|core_webview| {
      core_webview.Settings().and_then(|settings| {
        settings
          .cast::<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3>()?
          .SetAreBrowserAcceleratorKeysEnabled(false)
      })
    });

    if let Err(error) = result {
      eprintln!("Failed to disable WebView2 browser accelerator keys: {error}");
    }
  }) {
    eprintln!("Failed to access main webview while configuring accelerator keys: {error}");
  }
}

#[cfg(not(windows))]
fn disable_windows_browser_accelerator_keys<R: Runtime>(_app: &AppHandle<R>) {}

fn resolve_external_open_path(argument: &str, cwd: Option<&Path>) -> Option<String> {
  let trimmed = argument.trim();

  if trimmed.is_empty() {
    return None;
  }

  let path = PathBuf::from(trimmed);
  let resolved = if path.is_absolute() {
    path
  } else if let Some(cwd) = cwd {
    cwd.join(path)
  } else {
    path
  };

  if !resolved.is_file() {
    return None;
  }

  Some(resolved.to_string_lossy().into_owned())
}

fn collect_external_open_paths<I, S>(arguments: I, cwd: Option<&Path>) -> Vec<String>
where
  I: IntoIterator<Item = S>,
  S: AsRef<str>,
{
  arguments
    .into_iter()
    .filter_map(|argument| resolve_external_open_path(argument.as_ref(), cwd))
    .collect()
}

fn enqueue_pending_open_paths<R: Runtime>(app: &AppHandle<R>, paths: Vec<String>) -> bool {
  if paths.is_empty() {
    return false;
  }

  let Some(state) = app.try_state::<PendingOpenPaths>() else {
    eprintln!("Pending external open path state is unavailable.");
    return false;
  };

  let Ok(mut pending) = state.0.lock() else {
    eprintln!("Failed to lock pending external open path state.");
    return false;
  };

  pending.extend(paths);
  true
}

fn reveal_main_window<R: Runtime>(app: &AppHandle<R>) {
  let Some(main_window) = app.get_webview_window("main") else {
    eprintln!("Failed to resolve main webview while revealing the app for an external file open.");
    return;
  };

  let _ = main_window.unminimize();
  let _ = main_window.show();
  let _ = main_window.set_focus();
}

fn emit_open_pending_external_files<R: Runtime>(app: &AppHandle<R>) {
  emit_app_command(app, AppCommandPayload::OpenPendingExternalFiles);
}

#[tauri::command]
fn take_pending_open_paths(state: State<'_, PendingOpenPaths>) -> Result<Vec<String>, String> {
  let Ok(mut pending) = state.0.lock() else {
    return Err("Failed to access pending external open paths.".to_string());
  };

  Ok(std::mem::take(&mut *pending))
}

fn app_command_for_menu_id(menu_id: &str) -> Option<AppCommandPayload> {
  match menu_id {
    MENU_NEW_FILE_ID => Some(AppCommandPayload::NewFile),
    MENU_OPEN_FILE_ID => Some(AppCommandPayload::OpenFile),
    MENU_OPEN_FOLDER_ID => Some(AppCommandPayload::OpenFolder),
    MENU_SAVE_FILE_ID => Some(AppCommandPayload::SaveFile),
    MENU_SAVE_AS_FILE_ID => Some(AppCommandPayload::SaveAsFile),
    MENU_RENAME_FILE_ID => Some(AppCommandPayload::RenameFile),
    MENU_CLOSE_FILE_ID => Some(AppCommandPayload::CloseFile),
    MENU_EDIT_UNDO_ID => Some(AppCommandPayload::EditCommand {
      command_id: "undo".to_string(),
    }),
    MENU_EDIT_REDO_ID => Some(AppCommandPayload::EditCommand {
      command_id: "redo".to_string(),
    }),
    MENU_EDIT_FIND_ID => Some(AppCommandPayload::EditCommand {
      command_id: "find".to_string(),
    }),
    MENU_EDIT_REPLACE_ID => Some(AppCommandPayload::EditCommand {
      command_id: "replace".to_string(),
    }),
    MENU_APPEARANCE_THEME_SYSTEM_ID => Some(AppCommandPayload::SetAppearanceTheme {
      theme: "system".to_string(),
    }),
    MENU_APPEARANCE_THEME_LIGHT_ID => Some(AppCommandPayload::SetAppearanceTheme {
      theme: "light".to_string(),
    }),
    MENU_APPEARANCE_THEME_DARK_ID => Some(AppCommandPayload::SetAppearanceTheme {
      theme: "dark".to_string(),
    }),
    MENU_APPEARANCE_THEME_ONE_DARK_PRO_ID => Some(AppCommandPayload::SetAppearanceTheme {
      theme: "one-dark-pro".to_string(),
    }),
    MENU_APPEARANCE_THEME_DRACULA_ID => Some(AppCommandPayload::SetAppearanceTheme {
      theme: "dracula".to_string(),
    }),
    MENU_APPEARANCE_THEME_CATPPUCCIN_MOCHA_ID => Some(AppCommandPayload::SetAppearanceTheme {
      theme: "catppuccin-mocha".to_string(),
    }),
    MENU_APPEARANCE_THEME_NIGHT_OWL_ID => Some(AppCommandPayload::SetAppearanceTheme {
      theme: "night-owl".to_string(),
    }),
    MENU_APPEARANCE_THEME_TOKYO_NIGHT_ID => Some(AppCommandPayload::SetAppearanceTheme {
      theme: "tokyo-night".to_string(),
    }),
    MENU_APPEARANCE_THEME_GITHUB_LIGHT_ID => Some(AppCommandPayload::SetAppearanceTheme {
      theme: "github-light".to_string(),
    }),
    MENU_APPEARANCE_FONT_PANEL_OPEN_ID => Some(AppCommandPayload::OpenAppearanceFontPanel),
    MENU_CLEAR_RECENT_FILES_ID => Some(AppCommandPayload::ClearRecentFiles),
    _ => None,
  }
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
      let current_directory = Path::new(&cwd);
      let paths = collect_external_open_paths(args.iter().skip(1).map(String::as_str), Some(current_directory));

      if enqueue_pending_open_paths(app, paths) {
        reveal_main_window(app);
        emit_open_pending_external_files(app);
      }
    }))
    .manage(RecentFileMenuState(Mutex::new(Vec::new())))
    .manage(PendingOpenPaths(Mutex::new(Vec::new())))
    .invoke_handler(tauri::generate_handler![
      open_markdown_file,
      list_text_files,
      save_markdown_file,
      rename_markdown_file,
      create_markdown_file_in_directory,
      create_folder_in_directory,
      duplicate_fs_entry,
      rename_directory,
      move_path_to_recycle_bin,
      reveal_path_in_explorer,
      validate_markdown_file_name,
      validate_markdown_save_path,
      take_pending_open_paths,
      list_installed_font_families,
      update_recent_files_menu,
      update_menu_enabled_states,
      update_appearance_menu_state
    ])
    .setup(|app| {
      let menu = build_app_menu(app.handle())?;
      app.set_menu(menu)?;
      disable_windows_browser_accelerator_keys(app.handle());

      let current_directory = std::env::current_dir().ok();
      let initial_paths = collect_external_open_paths(std::env::args().skip(1), current_directory.as_deref());
      enqueue_pending_open_paths(app.handle(), initial_paths);
      Ok(())
    })
    .on_menu_event(|app, event| {
      let menu_id = event.id().as_ref();

      if let Some(payload) = app_command_for_menu_id(menu_id) {
        emit_app_command(app, payload);
        return;
      }

      if let Some(command_id) = menu_id.strip_prefix(EDITOR_COMMAND_MENU_PREFIX) {
        emit_app_command(
          app,
          AppCommandPayload::EditorCommand {
            command_id: command_id.to_string(),
          },
        );
        return;
      }

      if let Some(index) = menu_id.strip_prefix(MENU_RECENT_FILE_PREFIX) {
        let Ok(index) = index.parse::<usize>() else {
          return;
        };

        let Some(state) = app.try_state::<RecentFileMenuState>() else {
          return;
        };

        let Ok(entries) = state.0.lock() else {
          return;
        };

        if let Some(entry) = entries.get(index) {
          emit_app_command(
            app,
            AppCommandPayload::OpenRecentFile {
              path: entry.file_path.clone(),
            },
          );
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("failed to run Mado");
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;
  use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
  };

  fn create_test_dir(name: &str) -> PathBuf {
    let unique = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .expect("system time should be valid")
      .as_nanos();
    let path = std::env::temp_dir().join(format!("tias-{name}-{unique}"));
    fs::create_dir_all(&path).expect("test directory should be created");
    path
  }

  fn write_file(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent).expect("parent directory should be created");
    }

    fs::write(path, content).expect("test file should be written");
  }

  fn write_file_bytes(path: &Path, content: &[u8]) {
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent).expect("parent directory should be created");
    }

    fs::write(path, content).expect("test file bytes should be written");
  }

  fn write_utf16_le_with_bom(path: &Path, content: &str) {
    let mut bytes = vec![0xFF, 0xFE];
    for unit in content.encode_utf16() {
      bytes.extend_from_slice(&unit.to_le_bytes());
    }
    write_file_bytes(path, &bytes);
  }

  fn write_utf16_be_with_bom(path: &Path, content: &str) {
    let mut bytes = vec![0xFE, 0xFF];
    for unit in content.encode_utf16() {
      bytes.extend_from_slice(&unit.to_be_bytes());
    }
    write_file_bytes(path, &bytes);
  }

  #[test]
  fn list_text_files_marks_result_truncated_at_file_limit() {
    let root = create_test_dir("limit");
    write_file(&root.join("a.md"), "a");
    write_file(&root.join("b.md"), "b");

    let result = list_text_files_with_limits(
      &root,
      TextFileScanLimits {
        max_depth: 8,
        max_files: 1,
        preview_bytes: 1024,
      },
    );

    assert_eq!(result.files.len(), 1);
    assert!(result.is_truncated);

    fs::remove_dir_all(root).expect("test directory should be removed");
  }

  #[test]
  fn list_text_files_uses_stable_sorted_prefix_when_truncated() {
    let root = create_test_dir("stable-prefix");
    write_file(&root.join("z.md"), "z");
    write_file(&root.join("a.md"), "a");
    write_file(&root.join("m.md"), "m");

    let result = list_text_files_with_limits(
      &root,
      TextFileScanLimits {
        max_depth: 8,
        max_files: 1,
        preview_bytes: 1024,
      },
    );

    assert_eq!(result.files.len(), 1);
    assert_eq!(result.files[0].file_name, "a.md");
    assert!(result.is_truncated);

    fs::remove_dir_all(root).expect("test directory should be removed");
  }

  #[test]
  fn list_text_files_keeps_directories_after_file_limit() {
    let root = create_test_dir("directories-after-limit");
    write_file(&root.join("a.md"), "a");
    write_file(&root.join("b.md"), "b");
    fs::create_dir_all(root.join("zeta").join("nested")).expect("directories should be created");

    let result = list_text_files_with_limits(
      &root,
      TextFileScanLimits {
        max_depth: 8,
        max_files: 1,
        preview_bytes: 1024,
      },
    );

    let directories = result
      .directories
      .iter()
      .map(|directory| directory.relative_path.replace('\\', "/"))
      .collect::<Vec<_>>();

    assert_eq!(result.files.len(), 1);
    assert!(directories.iter().any(|directory| directory == "zeta"));
    assert!(directories.iter().any(|directory| directory == "zeta/nested"));
    assert!(result.is_truncated);

    fs::remove_dir_all(root).expect("test directory should be removed");
  }

  #[test]
  fn list_text_files_skips_directories_beyond_depth_limit() {
    let root = create_test_dir("depth");
    write_file(&root.join("visible.md"), "visible");
    write_file(&root.join("one").join("visible.txt"), "visible child");
    write_file(&root.join("one").join("two").join("hidden.md"), "hidden");

    let result = list_text_files_with_limits(
      &root,
      TextFileScanLimits {
        max_depth: 1,
        max_files: 10,
        preview_bytes: 1024,
      },
    );

    let names = result
      .files
      .iter()
      .map(|file| file.file_name.as_str())
      .collect::<Vec<_>>();

    assert!(names.contains(&"visible.md"));
    assert!(names.contains(&"visible.txt"));
    assert!(!names.contains(&"hidden.md"));
    let directories = result
      .directories
      .iter()
      .map(|directory| directory.relative_path.as_str())
      .collect::<Vec<_>>();
    assert!(directories.contains(&"one"));
    assert!(!directories.contains(&"one/two"));
    assert!(result.is_truncated);

    fs::remove_dir_all(root).expect("test directory should be removed");
  }

  #[test]
  fn list_text_files_skips_known_heavy_directories() {
    let root = create_test_dir("ignored");
    write_file(&root.join("note.md"), "note");
    write_file(&root.join("node_modules").join("package.md"), "ignored");
    write_file(&root.join(".git").join("commit.txt"), "ignored");

    let result = list_text_files_with_limits(
      &root,
      TextFileScanLimits {
        max_depth: 8,
        max_files: 10,
        preview_bytes: 1024,
      },
    );

    let names = result
      .files
      .iter()
      .map(|file| file.file_name.as_str())
      .collect::<Vec<_>>();

    assert_eq!(names, vec!["note.md"]);
    assert!(result.directories.is_empty());
    assert!(!result.is_truncated);

    fs::remove_dir_all(root).expect("test directory should be removed");
  }

  #[test]
  fn list_text_files_includes_empty_directories() {
    let root = create_test_dir("directories");
    fs::create_dir_all(root.join("empty").join("nested")).expect("directories should be created");
    write_file(&root.join("notes").join("visible.md"), "visible");

    let result = list_text_files_with_limits(
      &root,
      TextFileScanLimits {
        max_depth: 8,
        max_files: 10,
        preview_bytes: 1024,
      },
    );

    let directories = result
      .directories
      .iter()
      .map(|directory| directory.relative_path.replace('\\', "/"))
      .collect::<Vec<_>>();

    assert!(directories.iter().any(|directory| directory == "empty"));
    assert!(directories.iter().any(|directory| directory == "empty/nested"));
    assert!(directories.iter().any(|directory| directory == "notes"));
    assert!(!result.is_truncated);

    fs::remove_dir_all(root).expect("test directory should be removed");
  }

  #[test]
  fn build_text_file_entry_reads_only_preview_limit() {
    let root = create_test_dir("preview");
    let path = root.join("large.md");
    write_file(&path, "first line\nsecond line\nthird line");

    let entry = build_text_file_entry_with_preview_limit(&root, &path, 18)
      .expect("entry should be created");

    assert_eq!(entry.preview, "first line second");

    fs::remove_dir_all(root).expect("test directory should be removed");
  }

  #[test]
  fn read_markdown_document_reads_lossy_non_utf8_content() {
    let root = create_test_dir("lossy-open");
    let path = root.join("legacy.txt");
    write_file_bytes(&path, &[0x80, 0x81, b'a', b'b']);

    let opened = read_markdown_document(&path).expect("document should open with lossy decoding");

    assert_eq!(opened.file_name, "legacy.txt");
    assert!(opened.content.ends_with("ab"));
    assert_eq!(opened.encoding, DocumentEncoding::Lossy8Bit);

    fs::remove_dir_all(root).expect("test directory should be removed");
  }

  #[test]
  fn read_markdown_document_detects_utf8_bom_encoding() {
    let root = create_test_dir("utf8-bom-open");
    let path = root.join("bom.md");
    write_file_bytes(&path, &[0xEF, 0xBB, 0xBF, b'a', b'b', b'c']);

    let opened = read_markdown_document(&path).expect("document should open");

    assert_eq!(opened.content, "abc");
    assert_eq!(opened.encoding, DocumentEncoding::Utf8Bom);

    fs::remove_dir_all(root).expect("test directory should be removed");
  }

  #[test]
  fn read_markdown_document_detects_utf16le_encoding() {
    let root = create_test_dir("utf16le-open");
    let path = root.join("utf16le.txt");
    write_utf16_le_with_bom(&path, "hello");

    let opened = read_markdown_document(&path).expect("document should open");

    assert_eq!(opened.content, "hello");
    assert_eq!(opened.encoding, DocumentEncoding::Utf16Le);

    fs::remove_dir_all(root).expect("test directory should be removed");
  }

  #[test]
  fn read_markdown_document_detects_utf16be_encoding() {
    let root = create_test_dir("utf16be-open");
    let path = root.join("utf16be.txt");
    write_utf16_be_with_bom(&path, "hello");

    let opened = read_markdown_document(&path).expect("document should open");

    assert_eq!(opened.content, "hello");
    assert_eq!(opened.encoding, DocumentEncoding::Utf16Be);

    fs::remove_dir_all(root).expect("test directory should be removed");
  }

  #[test]
  fn save_markdown_file_preserves_utf8_bom_encoding() {
    let root = create_test_dir("utf8-bom-save");
    let path = root.join("bom.md");

    let saved = save_markdown_file(
      path.to_string_lossy().into_owned(),
      "hello".to_string(),
      DocumentEncoding::Utf8Bom,
    )
    .expect("save should succeed");

    let bytes = fs::read(&path).expect("saved bytes should be readable");

    assert_eq!(&bytes[..3], &[0xEF, 0xBB, 0xBF]);
    assert_eq!(saved.encoding, DocumentEncoding::Utf8Bom);

    fs::remove_dir_all(root).expect("test directory should be removed");
  }

  #[test]
  fn save_markdown_file_preserves_utf16le_encoding() {
    let root = create_test_dir("utf16le-save");
    let path = root.join("utf16le.txt");

    let saved = save_markdown_file(
      path.to_string_lossy().into_owned(),
      "hello".to_string(),
      DocumentEncoding::Utf16Le,
    )
    .expect("save should succeed");

    let bytes = fs::read(&path).expect("saved bytes should be readable");

    assert_eq!(&bytes[..2], &[0xFF, 0xFE]);
    assert_eq!(saved.encoding, DocumentEncoding::Utf16Le);

    fs::remove_dir_all(root).expect("test directory should be removed");
  }

  #[test]
  fn save_markdown_file_rejects_lossy_8bit_encoding() {
    let root = create_test_dir("lossy-save");
    let path = root.join("legacy.txt");

    let error = save_markdown_file(
      path.to_string_lossy().into_owned(),
      "hello".to_string(),
      DocumentEncoding::Lossy8Bit,
    )
    .expect_err("lossy encoding should be rejected");

    assert_eq!(
      error,
      "This file uses an unknown legacy encoding and cannot be safely saved."
    );

    fs::remove_dir_all(root).expect("test directory should be removed");
  }

  #[cfg(unix)]
  #[test]
  fn duplicate_fs_entry_rejects_symlink_directory_and_rolls_back() {
    use std::os::unix::fs::symlink;

    let root = create_test_dir("duplicate-symlink");
    let source = root.join("source");
    let target_file = root.join("target.txt");
    fs::create_dir_all(&source).expect("source directory should be created");
    write_file(&target_file, "target");
    symlink(&target_file, source.join("link.txt")).expect("symlink should be created");

    let error = duplicate_fs_entry(source.to_string_lossy().into_owned())
      .expect_err("directory duplicate should reject symlinks");

    assert_eq!(
      error,
      "Cannot duplicate directories containing symbolic links or reparse points."
    );
    assert!(!root.join("source copy").exists());

    fs::remove_dir_all(root).expect("test directory should be removed");
  }

  #[cfg(windows)]
  #[test]
  fn rename_markdown_file_allows_case_only_rename() {
    let root = create_test_dir("case-file");
    let path = root.join("Note.md");
    write_file(&path, "note");

    let renamed = rename_markdown_file(
      path.to_string_lossy().into_owned(),
      "note.md".to_string(),
    )
    .expect("case-only file rename should succeed");

    assert_eq!(renamed.file_name, "note.md");
    assert!(root.join("note.md").exists() || root.join("Note.md").exists());

    fs::remove_dir_all(root).expect("test directory should be removed");
  }

  #[cfg(windows)]
  #[test]
  fn rename_directory_allows_case_only_rename() {
    let root = create_test_dir("case-dir");
    let path = root.join("Docs");
    fs::create_dir_all(&path).expect("directory should be created");

    let renamed = rename_directory(
      path.to_string_lossy().into_owned(),
      "docs".to_string(),
    )
    .expect("case-only directory rename should succeed");

    assert_eq!(renamed.name, "docs");
    assert!(root.join("docs").exists() || root.join("Docs").exists());

    fs::remove_dir_all(root).expect("test directory should be removed");
  }

  #[test]
  fn normalize_markdown_file_name_fixes_trailing_dot() {
    let normalized =
      normalize_markdown_file_name("notes.").expect("trailing dot should normalize to .md");

    assert_eq!(normalized, "notes.md");
  }

  #[test]
  fn normalize_markdown_file_name_rejects_extension_only_name() {
    let error = normalize_markdown_file_name(".md").expect_err("extension-only names should fail");

    assert_eq!(error, "The file name must include a name before the extension.");
  }

  #[test]
  fn normalize_markdown_file_name_rejects_windows_reserved_name() {
    let error = normalize_markdown_file_name("CON").expect_err("reserved names should fail");

    assert_eq!(error, "The file name is reserved by Windows and cannot be used.");
  }

  #[test]
  fn normalize_markdown_file_name_accepts_supported_extensions() {
    assert_eq!(
      normalize_markdown_file_name("notes.markdown").expect("markdown extension should pass"),
      "notes.markdown"
    );
    assert_eq!(
      normalize_markdown_file_name("notes.txt").expect("txt extension should pass"),
      "notes.txt"
    );
  }

  #[test]
  fn normalize_markdown_file_name_rejects_unsupported_extension() {
    let error =
      normalize_markdown_file_name("notes.exe").expect_err("unsupported extension should fail");

    assert_eq!(error, "The file name must end with .md, .markdown or .txt.");
  }

  #[test]
  fn normalize_markdown_file_name_rejects_additional_windows_reserved_name() {
    let error = normalize_markdown_file_name("NUL").expect_err("reserved names should fail");

    assert_eq!(error, "The file name is reserved by Windows and cannot be used.");
  }

  #[test]
  fn normalize_markdown_save_path_appends_md_when_missing_extension() {
    let path = Path::new("notes");
    let normalized = normalize_markdown_save_path(path.to_string_lossy().as_ref())
      .expect("save path without extension should normalize");

    assert_eq!(PathBuf::from(normalized), Path::new("notes.md"));
  }

  #[test]
  fn normalize_markdown_save_path_fixes_trailing_dot() {
    let path = Path::new("folder").join("notes.");
    let normalized = normalize_markdown_save_path(path.to_string_lossy().as_ref())
      .expect("save path with trailing dot should normalize");

    assert_eq!(PathBuf::from(normalized), Path::new("folder").join("notes.md"));
  }

  #[test]
  fn normalize_markdown_save_path_accepts_supported_extensions() {
    let markdown_dot_md_path = Path::new("folder").join("notes.md");
    let markdown_path = Path::new("folder").join("notes.markdown");
    let text_path = Path::new("folder").join("notes.txt");
    let executable_markdown_path = Path::new("folder").join("notes.exe.md");

    assert_eq!(
      PathBuf::from(
        normalize_markdown_save_path(markdown_dot_md_path.to_string_lossy().as_ref())
          .expect("md path should pass")
      ),
      markdown_dot_md_path
    );
    assert_eq!(
      PathBuf::from(
        normalize_markdown_save_path(markdown_path.to_string_lossy().as_ref())
          .expect("markdown path should pass")
      ),
      markdown_path
    );
    assert_eq!(
      PathBuf::from(
        normalize_markdown_save_path(text_path.to_string_lossy().as_ref())
          .expect("text path should pass")
      ),
      text_path
    );
    assert_eq!(
      PathBuf::from(
        normalize_markdown_save_path(executable_markdown_path.to_string_lossy().as_ref())
          .expect("save path ending in markdown extension should pass")
      ),
      executable_markdown_path
    );
  }

  #[test]
  fn normalize_markdown_save_path_rejects_reserved_name() {
    let path = Path::new("folder").join("CON");
    let error = normalize_markdown_save_path(path.to_string_lossy().as_ref())
      .expect_err("reserved save name should fail");

    assert_eq!(error, "The file name is reserved by Windows and cannot be used.");
  }

  #[test]
  fn normalize_markdown_save_path_rejects_unsupported_extension() {
    let path = Path::new("folder").join("notes.exe");
    let error = normalize_markdown_save_path(path.to_string_lossy().as_ref())
      .expect_err("unsupported save extension should fail");

    assert_eq!(error, "The file name must end with .md, .markdown or .txt.");
  }

  #[test]
  fn app_command_payload_serializes_command_id_in_camel_case() {
    let payload = AppCommandPayload::EditorCommand {
      command_id: "inline-strong".to_string(),
    };

    let value = serde_json::to_value(payload).expect("payload should serialize");

    assert_eq!(
      value,
      json!({
        "type": "editorCommand",
        "commandId": "inline-strong"
      })
    );
  }

  #[test]
  fn app_command_payload_serializes_appearance_commands_in_camel_case() {
    let theme_value = serde_json::to_value(AppCommandPayload::SetAppearanceTheme {
      theme: "dark".to_string(),
    })
    .expect("theme payload should serialize");
    let panel_value = serde_json::to_value(AppCommandPayload::OpenAppearanceFontPanel)
      .expect("panel payload should serialize");
    let pending_open_value = serde_json::to_value(AppCommandPayload::OpenPendingExternalFiles)
      .expect("pending external open payload should serialize");

    assert_eq!(
      theme_value,
      json!({
        "type": "setAppearanceTheme",
        "theme": "dark"
      })
    );
    assert_eq!(
      panel_value,
      json!({
        "type": "openAppearanceFontPanel"
      })
    );
    assert_eq!(
      pending_open_value,
      json!({
        "type": "openPendingExternalFiles"
      })
    );
  }

  #[test]
  fn collect_external_open_paths_keeps_existing_files_and_resolves_relative_paths() {
    let root = create_test_dir("external-open");
    let existing_file = root.join("notes.md");
    let missing_file = root.join("missing.md");
    write_file(&existing_file, "# external open");

    let paths = collect_external_open_paths(
      vec![
        "notes.md".to_string(),
        missing_file.to_string_lossy().into_owned(),
        "".to_string(),
        "--flag".to_string(),
      ],
      Some(root.as_path()),
    );

    assert_eq!(paths, vec![existing_file.to_string_lossy().into_owned()]);

    fs::remove_dir_all(root).expect("test directory should be removed");
  }

  #[test]
  fn app_command_for_menu_id_maps_file_and_edit_commands() {
    assert!(matches!(
      app_command_for_menu_id(MENU_SAVE_FILE_ID),
      Some(AppCommandPayload::SaveFile)
    ));

    assert!(matches!(
      app_command_for_menu_id(MENU_EDIT_UNDO_ID),
      Some(AppCommandPayload::EditCommand { command_id }) if command_id == "undo"
    ));

    assert!(matches!(
      app_command_for_menu_id(MENU_EDIT_FIND_ID),
      Some(AppCommandPayload::EditCommand { command_id }) if command_id == "find"
    ));

    assert!(matches!(
      app_command_for_menu_id(MENU_EDIT_REPLACE_ID),
      Some(AppCommandPayload::EditCommand { command_id }) if command_id == "replace"
    ));
    assert!(matches!(
      app_command_for_menu_id(MENU_APPEARANCE_THEME_SYSTEM_ID),
      Some(AppCommandPayload::SetAppearanceTheme { theme }) if theme == "system"
    ));
    assert!(matches!(
      app_command_for_menu_id(MENU_APPEARANCE_THEME_DARK_ID),
      Some(AppCommandPayload::SetAppearanceTheme { theme }) if theme == "dark"
    ));
    assert!(matches!(
      app_command_for_menu_id(MENU_APPEARANCE_THEME_CATPPUCCIN_MOCHA_ID),
      Some(AppCommandPayload::SetAppearanceTheme { theme }) if theme == "catppuccin-mocha"
    ));
    assert!(matches!(
      app_command_for_menu_id(MENU_APPEARANCE_THEME_GITHUB_LIGHT_ID),
      Some(AppCommandPayload::SetAppearanceTheme { theme }) if theme == "github-light"
    ));
    assert!(matches!(
      app_command_for_menu_id(MENU_APPEARANCE_FONT_PANEL_OPEN_ID),
      Some(AppCommandPayload::OpenAppearanceFontPanel)
    ));

    assert!(app_command_for_menu_id("missing-menu-id").is_none());
  }

  #[test]
  fn appearance_font_panel_menu_item_id_matches_open_id() {
    assert_eq!(appearance_font_panel_menu_item_id(), MENU_APPEARANCE_FONT_PANEL_OPEN_ID);
  }

  #[test]
  fn normalize_windows_font_menu_label_strips_font_backend_suffix() {
    assert_eq!(
      normalize_windows_font_menu_label("Arial (TrueType)").as_deref(),
      Some("Arial")
    );
    assert_eq!(
      normalize_windows_font_menu_label("@Malgun Gothic").as_deref(),
      None
    );
  }

  #[test]
  fn normalize_windows_font_family_name_strips_style_suffixes() {
    assert_eq!(
      normalize_windows_font_family_name("Maple Mono Normal ExtraBold").as_deref(),
      Some("Maple Mono")
    );
    assert_eq!(
      normalize_windows_font_family_name("Microsoft YaHei UI Light").as_deref(),
      Some("Microsoft YaHei UI")
    );
    assert_eq!(
      normalize_windows_font_family_name("Microsoft New Tai Lue").as_deref(),
      Some("Microsoft New Tai Lue")
    );
  }
}
