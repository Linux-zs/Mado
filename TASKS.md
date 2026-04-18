# Task Log

## Step 1
- Goal: build the initial Windows desktop window shell with a Typora-like visual style.
- Completed: created the Tauri + TypeScript project skeleton, the main desktop window, and the top-level menu bar with File, Edit, Search, View, Settings, and Help.
- Notes: this step intentionally did not include file I/O, Markdown rendering, or editing.
- Verified: `npm run test`, `cargo check --manifest-path src-tauri/Cargo.toml`, and `npm run dev`.

## Step 2
- Goal: open a local Markdown file from the menu bar and display it as plain text.
- Completed: added `File -> Open`, wired the native menu click to the frontend, opened the system file picker for `.md` and `.markdown`, read the selected file in Rust, and displayed the file name plus plain text content in the main window.
- Out of scope: Markdown formatting, editing, saving, recent files, and drag-and-drop.
- Verified: `npm run test`, `cargo check --manifest-path src-tauri/Cargo.toml`, and startup through `npm run dev`.

## Step 3
- Goal: render Markdown headings while keeping the viewer read-only.
- Completed: replaced the single plain-text block with a minimal line-based renderer that recognizes `#` through `######` headings and keeps all non-heading lines as plain text.
- Out of scope: editing, Setext headings, lists, quotes, code blocks, inline formatting, and any other Markdown syntax.
- Verified: `npm run test`, `npm run build:web`, `cargo check --manifest-path src-tauri/Cargo.toml`, and startup through `npm run dev`.

## Step 4
- Goal: add basic text editing without extending Markdown rendering.
- Completed: enabled native in-place text editing on the rendered document area, including caret placement, text selection, direct typing, and Backspace/Delete behavior through the browser editing engine.
- Out of scope: saving, undo/redo, shortcuts, file persistence, and any new Markdown formatting features.
- Verified: `npm run test`, `npm run build:web`, `cargo check --manifest-path src-tauri/Cargo.toml`, and startup through `npm run dev`.

## Step 5
- Goal: create a new unsaved Markdown document from the File menu.
- Completed: added `File -> New`, wired the menu event to the frontend, and created an empty editable document in the current workspace with an untitled Markdown filename shown in the UI.
- Out of scope: save, save as, path selection, multi-tab documents, and unsaved-change prompts.
- Verified: `npm run test`, `npm run build:web`, `cargo check --manifest-path src-tauri/Cargo.toml`, and startup through `npm run dev`.

## Step 6
- Goal: make the left sidebar act as the file switcher and directory tree for the current workspace.
- Completed: replaced the single-document layout with a left sidebar that shows unsaved files, opened files, and the directory tree of the active saved document; added directory loading, directory-based file creation, and duplicate-open prevention.
- Out of scope: save, save as, rename, close prompts, and any new Markdown rendering features.
- Verified: `npm run test`, `npm run build:web`, `cargo check --manifest-path src-tauri/Cargo.toml`, and startup through `npm run dev`.

## Step 7
- Goal: replace the directory tree with a Typora-style file list and outline panel.
- Completed: removed the directory tree workflow, added `Files / Outline` switching in the left sidebar, rendered recent and current-session Markdown documents as file cards, persisted saved-file history across restarts, and made outline items scroll to their matching headings.
- Out of scope: save, save as, rename, close actions for file cards, and any new Markdown rendering features.
- Verified: `npm run test`, `npm run build:web`, `cargo check --manifest-path src-tauri/Cargo.toml`, and startup through `npm run dev`.

## Step 8
- Goal: add Save, Save As, and Rename to the File menu.
- Completed: added `Save`, `Save As`, and `Rename` menu items; implemented file writing, save-path selection, copy-style Save As behavior, and an in-app rename dialog; updated recent-file history to stay in sync with saves and renames.
- Out of scope: close prompts, overwrite confirmations beyond OS dialogs, and any new Markdown rendering features.
- Verified: `npm run test`, `npm run build:web`, `cargo check --manifest-path src-tauri/Cargo.toml`, and startup through `npm run dev`.

## Step 9
- Goal: render more Markdown syntax while keeping the current document flow intact.
- Completed: expanded the parser and renderer to support paragraphs, GFM-style tables, strong emphasis, italic emphasis, fenced and indented code blocks, and inline code, while continuing to derive file content from Markdown source text; also stabilized sidebar file switching and outline clicks so they continue to work while the editor is focused.
- Out of scope: lists, blockquotes, links, images, syntax highlighting, and any new file-management features.
- Verified: `npm run test`, `npm run build:web`, `cargo check --manifest-path src-tauri/Cargo.toml`, and startup through `npm run dev`.

## Step 10
- Goal: replace whole-document rich-text editing with a Typora-style block editor.
- Completed: rewired the editor so each Markdown block now has its own edit mode; headings and paragraphs switch to raw Markdown text while editing, then re-render on blur or block switch; tables stay as editable tables and code blocks stay as editable code surfaces instead of falling back to raw Markdown fences; added a trailing insert block so new content can be appended without replacing the whole document.
- Notes: heading parsing now accepts `#标题` as well as `# 标题`, which matches the current product expectation for Chinese input. Tables and code blocks keep their structure while editing, but row/column insertion and code language editing are still out of scope.
- Verified: `npm run test`, `npm run build:web`, and `cargo check --manifest-path src-tauri/Cargo.toml`.

## Step 11
- Goal: fix table rendering and stop saves from silently dropping table-like Markdown source.
- Completed: relaxed table detection so single-column pipe tables can render, tightened the table-start guard so plain `title + ---` lines are not misread as tables, added a raw fallback block for malformed table fragments so they stay visible and survive save round-trips even when they cannot be rendered as structured tables, and made explicit reopen actions refresh clean in-session documents from disk.
- Notes: structured table editing still applies only to recognized GFM pipe tables; malformed or unsupported table-like fragments now stay as plain Markdown source blocks instead of being normalized away.
- Verified: `npm run test`, `npm run build:web`, and `cargo check --manifest-path src-tauri/Cargo.toml`.
