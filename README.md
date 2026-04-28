# Mado

Mado 是一个基于 Tauri、TypeScript 和 Milkdown 构建的桌面 Markdown 编辑器。项目目标是提供接近原生桌面软件的 Markdown 编辑体验，同时保留源码视图、文件目录、大纲、表格工具和代码块语法高亮等常用能力。

## 功能概览

- Milkdown 渲染编辑器，支持常见 Markdown 语法和 GFM 表格。
- 文件侧栏显示当前目录及子目录中的文本类文件。
- 大纲侧栏基于标题生成，可点击跳转。
- 渲染视图和源码视图可切换，状态栏显示行数、字符数和缩放比例。
- 支持标题、引用、列表、代码块、表格、粗体、斜体、删除线、行内代码、高亮、上下标和按键样式。
- 代码块支持语言标签编辑，并按 fenced language 做语法高亮。
- 表格选中后显示工具栏，可插入、移动、删除行列，并设置表格大小和对齐方式。
- 支持主题和字体设置，默认主题为 GitHub Light。
- Tauri 打包配置包含 `md` 文件关联和应用图标配置。

## 技术栈

- 前端：TypeScript、Vite
- 编辑器：Milkdown、ProseMirror
- Markdown：remark、GFM
- 代码高亮：highlight.js
- 桌面端：Tauri 2、Rust

## 开发环境

需要先安装：

- Node.js
- npm
- Rust 工具链
- Tauri 所需系统依赖

安装 JavaScript 依赖：

```powershell
npm install
```

启动 Tauri 开发模式：

```powershell
npm run dev
```

只启动前端开发服务器：

```powershell
npm run dev:web
```

## 构建

构建前端资源：

```powershell
npm run build:web
```

构建桌面应用：

```powershell
npm run build
```

构建输出由 Tauri 处理，前端产物位于 `dist/`。

## 测试

运行 TypeScript 检查和前端逻辑测试：

```powershell
npm run test
```

运行 Rust 测试：

```powershell
cd src-tauri
cargo test
```

## 项目结构

```text
src/          TypeScript UI、Milkdown 集成和编辑器状态逻辑
src-tauri/    Rust 命令、文件 I/O、原生菜单和 Tauri 配置
tests/        前端逻辑和样式约束测试
public/       静态资源
dist/         前端构建输出
```

## 说明

- 当前项目主要面向 Windows 桌面使用场景。
- 文件扫描、保存、重命名、删除、打开所在位置等系统相关能力由 Rust 侧实现。
- `src-tauri/icons/icon.ico` 是应用图标来源，打包时会被 Tauri 配置引用。
- 默认窗口大小为 `1280x820`，最小窗口大小为 `960x640`。
