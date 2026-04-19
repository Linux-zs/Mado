#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
  fs,
  io::Read,
  path::{Path, PathBuf},
  sync::Mutex,
  time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};
use tauri::{
  menu::{
    Menu, MenuBuilder, MenuItem, MenuItemBuilder, MenuItemKind, Submenu, SubmenuBuilder,
  },
  AppHandle, Emitter, Manager, Runtime, State,
};

const MENU_OPEN_FILE_ID: &str = "file-open";
const MENU_OPEN_FOLDER_ID: &str = "file-open-folder";
const MENU_NEW_FILE_ID: &str = "file-new";
const MENU_SAVE_FILE_ID: &str = "file-save";
const MENU_SAVE_AS_FILE_ID: &str = "file-save-as";
const MENU_RENAME_FILE_ID: &str = "file-rename";
const MENU_CLOSE_FILE_ID: &str = "file-close";
const MENU_CLEAR_RECENT_FILES_ID: &str = "file-clear-recent";
const MENU_RECENT_FILE_PREFIX: &str = "file-recent-open:";
const RECENT_FILES_MENU_LIMIT: usize = 10;
const OPEN_FILE_EVENT: &str = "request-open-markdown-file";
const OPEN_FOLDER_EVENT: &str = "request-open-markdown-folder";
const NEW_FILE_EVENT: &str = "request-new-markdown-file";
const SAVE_FILE_EVENT: &str = "request-save-markdown-file";
const SAVE_AS_FILE_EVENT: &str = "request-save-as-markdown-file";
const RENAME_FILE_EVENT: &str = "request-rename-markdown-file";
const CLOSE_FILE_EVENT: &str = "request-close-markdown-file";
const CLEAR_RECENT_FILES_EVENT: &str = "request-clear-recent-files";
const OPEN_RECENT_FILE_EVENT: &str = "request-open-recent-file";
const EDITOR_COMMAND_EVENT: &str = "request-editor-command";
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

struct RecentFileMenuState(Mutex<Vec<String>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedDocument {
  file_name: String,
  file_path: String,
  directory_path: String,
  content: String,
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
struct TextFileListResult {
  files: Vec<TextFileEntry>,
  is_truncated: bool,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentMenuEntry {
  file_name: String,
  file_path: String,
}

#[derive(Clone, Copy)]
struct TextFileScanLimits {
  max_depth: usize,
  max_files: usize,
  preview_bytes: usize,
}

struct TextFileScanState {
  files: Vec<TextFileEntry>,
  is_truncated: bool,
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
  {
    let mut paths = state
      .0
      .lock()
      .map_err(|_| "Failed to lock recent files menu state.".to_string())?;
    *paths = entries.iter().map(|entry| entry.file_path.clone()).collect();
  }

  update_recent_file_menu_items(&app, &entries).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_markdown_file(path: String, content: String) -> Result<OpenedDocument, String> {
  let file_path = Path::new(&path);
  fs::write(file_path, content).map_err(|error| format!("Failed to save file: {error}"))?;
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

  if target_path.exists() {
    return Err("The target file already exists.".to_string());
  }

  fs::rename(file_path, &target_path).map_err(|error| format!("Failed to rename file: {error}"))?;
  read_markdown_document(&target_path)
}

fn read_markdown_document(file_path: &Path) -> Result<OpenedDocument, String> {
  let content =
    fs::read_to_string(file_path).map_err(|error| format!("Failed to read file: {error}"))?;

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
    content,
  })
}

fn list_text_files_with_limits(root: &Path, limits: TextFileScanLimits) -> TextFileListResult {
  let mut state = TextFileScanState {
    files: Vec::new(),
    is_truncated: false,
  };

  collect_text_files(root, root, 0, limits, &mut state);
  state
    .files
    .sort_by(|left, right| left.file_path.cmp(&right.file_path));

  TextFileListResult {
    files: state.files,
    is_truncated: state.is_truncated,
  }
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

  let Ok(entries) = fs::read_dir(directory) else {
    return;
  };

  for entry in entries.flatten() {
    if state.files.len() >= limits.max_files {
      state.is_truncated = true;
      return;
    }

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

      collect_text_files(root, &path, depth + 1, limits, state);
      continue;
    }

    if !file_type.is_file() || !is_supported_text_file(&path) {
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

fn read_limited_text(file_path: &Path, byte_limit: usize) -> std::io::Result<String> {
  let file = fs::File::open(file_path)?;
  let mut reader = file.take(byte_limit as u64);
  let mut buffer = Vec::new();
  reader.read_to_end(&mut buffer)?;

  Ok(String::from_utf8_lossy(&buffer).to_string())
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

fn normalize_markdown_file_name(new_name: &str) -> Result<String, String> {
  let trimmed = new_name.trim();

  if trimmed.is_empty() {
    return Err("The file name cannot be empty.".to_string());
  }

  if trimmed.contains(['\\', '/']) {
    return Err("The file name cannot include path separators.".to_string());
  }

  if trimmed.contains(['<', '>', ':', '"', '|', '?', '*']) {
    return Err("The file name contains characters not allowed on Windows.".to_string());
  }

  let dot_index = trimmed.rfind('.');

  let normalized = match dot_index {
    Some(index) if index > 0 && index < trimmed.len() - 1 => {
      let extension = trimmed[index + 1..].to_ascii_lowercase();

      if extension == "md" || extension == "markdown" || extension == "txt" {
        trimmed.to_string()
      } else {
        return Err("The file name must end with .md, .markdown or .txt.".to_string());
      }
    }
    _ => format!("{trimmed}.md"),
  };

  Ok(normalized)
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
  let edit_menu = SubmenuBuilder::new(app, "\u{7f16}\u{8f91}(&E)").build()?;
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
  let view_menu = SubmenuBuilder::new(app, "\u{89c6}\u{56fe}(&V)").build()?;
  let theme_menu = SubmenuBuilder::new(app, "\u{4e3b}\u{9898}(&T)").build()?;
  let help_menu = SubmenuBuilder::new(app, "\u{5e2e}\u{52a9}(&H)").build()?;

  MenuBuilder::new(app)
    .items(&[
      &file_menu,
      &edit_menu,
      &paragraph_menu,
      &format_menu,
      &view_menu,
      &theme_menu,
      &help_menu,
    ])
    .build()
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(RecentFileMenuState(Mutex::new(Vec::new())))
    .invoke_handler(tauri::generate_handler![
      open_markdown_file,
      list_text_files,
      save_markdown_file,
      rename_markdown_file,
      update_recent_files_menu
    ])
    .setup(|app| {
      let menu = build_app_menu(app.handle())?;
      app.set_menu(menu)?;
      Ok(())
    })
    .on_menu_event(|app, event| {
      if event.id() == MENU_NEW_FILE_ID {
        let _ = app.emit_to("main", NEW_FILE_EVENT, ());
      }

      if event.id() == MENU_OPEN_FILE_ID {
        let _ = app.emit_to("main", OPEN_FILE_EVENT, ());
      }

      if event.id() == MENU_OPEN_FOLDER_ID {
        let _ = app.emit_to("main", OPEN_FOLDER_EVENT, ());
      }

      if event.id() == MENU_SAVE_FILE_ID {
        let _ = app.emit_to("main", SAVE_FILE_EVENT, ());
      }

      if event.id() == MENU_SAVE_AS_FILE_ID {
        let _ = app.emit_to("main", SAVE_AS_FILE_EVENT, ());
      }

      if event.id() == MENU_RENAME_FILE_ID {
        let _ = app.emit_to("main", RENAME_FILE_EVENT, ());
      }

      if event.id() == MENU_CLOSE_FILE_ID {
        let _ = app.emit_to("main", CLOSE_FILE_EVENT, ());
      }

      if event.id() == MENU_CLEAR_RECENT_FILES_ID {
        let _ = app.emit_to("main", CLEAR_RECENT_FILES_EVENT, ());
      }

      let menu_id = event.id().as_ref();

      if let Some(command_id) = menu_id.strip_prefix(EDITOR_COMMAND_MENU_PREFIX) {
        let _ = app.emit_to("main", EDITOR_COMMAND_EVENT, command_id.to_string());
        return;
      }

      if let Some(index) = menu_id.strip_prefix(MENU_RECENT_FILE_PREFIX) {
        let Ok(index) = index.parse::<usize>() else {
          return;
        };

        let Some(state) = app.try_state::<RecentFileMenuState>() else {
          return;
        };

        let Ok(paths) = state.0.lock() else {
          return;
        };

        if let Some(path) = paths.get(index) {
          let _ = app.emit_to("main", OPEN_RECENT_FILE_EVENT, path);
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("failed to run Tias");
}

#[cfg(test)]
mod tests {
  use super::*;
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
}
