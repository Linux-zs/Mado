#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::Path};

use serde::Serialize;
use tauri::{
  menu::{MenuBuilder, SubmenuBuilder},
  Emitter,
};

const MENU_OPEN_FILE_ID: &str = "file-open";
const MENU_NEW_FILE_ID: &str = "file-new";
const MENU_SAVE_FILE_ID: &str = "file-save";
const MENU_SAVE_AS_FILE_ID: &str = "file-save-as";
const MENU_RENAME_FILE_ID: &str = "file-rename";
const OPEN_FILE_EVENT: &str = "request-open-markdown-file";
const NEW_FILE_EVENT: &str = "request-new-markdown-file";
const SAVE_FILE_EVENT: &str = "request-save-markdown-file";
const SAVE_AS_FILE_EVENT: &str = "request-save-as-markdown-file";
const RENAME_FILE_EVENT: &str = "request-rename-markdown-file";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedDocument {
  file_name: String,
  file_path: String,
  directory_path: String,
  content: String,
}

#[tauri::command]
fn open_markdown_file(path: String) -> Result<OpenedDocument, String> {
  let file_path = Path::new(&path);
  read_markdown_document(file_path)
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

      if extension == "md" || extension == "markdown" {
        trimmed.to_string()
      } else {
        return Err("The file name must end with .md or .markdown.".to_string());
      }
    }
    _ => format!("{trimmed}.md"),
  };

  Ok(normalized)
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      open_markdown_file,
      save_markdown_file,
      rename_markdown_file
    ])
    .setup(|app| {
      let file_menu = SubmenuBuilder::new(app, "\u{6587}\u{4ef6}")
        .text(MENU_NEW_FILE_ID, "\u{65b0}\u{5efa}")
        .text(MENU_OPEN_FILE_ID, "\u{6253}\u{5f00}")
        .text(MENU_SAVE_FILE_ID, "\u{4fdd}\u{5b58}")
        .text(MENU_SAVE_AS_FILE_ID, "\u{53e6}\u{5b58}\u{4e3a}")
        .text(MENU_RENAME_FILE_ID, "\u{91cd}\u{547d}\u{540d}")
        .build()?;
      let edit_menu = SubmenuBuilder::new(app, "\u{7f16}\u{8f91}").build()?;
      let search_menu = SubmenuBuilder::new(app, "\u{641c}\u{7d22}").build()?;
      let view_menu = SubmenuBuilder::new(app, "\u{89c6}\u{56fe}").build()?;
      let settings_menu = SubmenuBuilder::new(app, "\u{8bbe}\u{7f6e}").build()?;
      let help_menu = SubmenuBuilder::new(app, "\u{5e2e}\u{52a9}").build()?;

      let menu = MenuBuilder::new(app)
        .items(&[
          &file_menu,
          &edit_menu,
          &search_menu,
          &view_menu,
          &settings_menu,
          &help_menu,
        ])
        .build()?;

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

      if event.id() == MENU_SAVE_FILE_ID {
        let _ = app.emit_to("main", SAVE_FILE_EVENT, ());
      }

      if event.id() == MENU_SAVE_AS_FILE_ID {
        let _ = app.emit_to("main", SAVE_AS_FILE_EVENT, ());
      }

      if event.id() == MENU_RENAME_FILE_ID {
        let _ = app.emit_to("main", RENAME_FILE_EVENT, ());
      }
    })
    .run(tauri::generate_context!())
    .expect("failed to run Tias");
}
