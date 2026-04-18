# Repository Guidelines

## Project Structure & Module Organization
This repository is expected to stay small and split by runtime:
- `src/` for the TypeScript UI and Milkdown editor integration.
- `src-tauri/` for Rust commands, file I/O, and native window behavior.
- `assets/` for icons, sample markdown, and other static files.
- `tests/` for integration or end-to-end checks if they are added.

Keep editor logic in the frontend unless it needs native access. Put filesystem and platform-specific code in Rust.

## Build, Test, and Development Commands
Use the project scripts in the root package manifest once they exist:
- `npm install` to install JavaScript dependencies.
- `npm run dev` to start the Tauri app in development mode.
- `npm run build` to produce a release-ready frontend and desktop bundle.
- `npm run test` to run the main test suite, if defined.
- `cargo test` to exercise Rust-side logic in `src-tauri/`.

Prefer the smallest command that verifies the change you made.

## Coding Style & Naming Conventions
Use TypeScript for UI code and Rust for native code. Follow the existing formatting tools if they are added, and keep diffs minimal.
- Use `camelCase` for variables and functions.
- Use `PascalCase` for React components and types.
- Use `snake_case` only where Rust conventions require it.
- Name files by feature, such as `editor-toolbar.tsx` or `markdown_import.rs`.

## Testing Guidelines
Add tests close to the code they verify. Name tests after behavior, not implementation.
- Frontend tests should cover editor actions, file loading, and keyboard shortcuts.
- Rust tests should cover commands, path handling, and error returns.
- If a change is visual, include a screenshot or a short manual verification note.

## Commit & Pull Request Guidelines
Use short, imperative commit messages, for example: `editor: add file open flow`.
PRs should include what changed, why it changed, and how it was verified. Link related issues when available and attach screenshots for UI work.

## Agent-Specific Instructions
Work only inside `D:\\codes\\Tias`.
Do one task at a time, and wait for the next instruction before starting the next task.
Avoid extra abstraction and do not touch unrelated files.
