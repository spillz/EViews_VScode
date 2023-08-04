# EViews Extension README

A VS Code extension that adds programming language support for EViews, the suite of statistical, time series, forecasting, and modeling tools.

## Features

Provides basic syntax highlighting, intellisense and hover for the EViews scripting language (.prg files).

## Requirements

None required to use the extension although you will obviously need a copy of EViews to be able to run your programs.

## Building the extension from source

To build and test the extension, you need to install VS Code and node.js on your test machine of choice.

In VS Code (or your command line tools of choice) clone the extension github repository (https://github.com/spillz/eviews_vscode) and in a terminal run the following command:

```
cd <location of cloned repository>
npm install -g vsce
npm install
vsce package
```

That should produce a `eviews-language-extensions-<version>.vsix` extension.

You can then either install the extension into your VS code instance by `Ctrl+Shift+P => "Extensions: Install from VSIX..."` or debug the extension in a separate VS Code instance by seleecting the `Start Debugging` option from the Debugging sidebar panel.

## Release Notes

### 0.1.0

Initial release of the extension with basic syntax highlighting support for the EViews scripting language.

### 0.1.1

Improved indentation and folding

### 0.2.0

Intellisense and hover for definitions. Integrates with EViews webhelp but provides short definitions in hover/completion resolvers for offline use

### 0.2.1

Basic signature help for commands, functions and methods  

### 0.2.2

Improvements in command hinting via dynamic snippets and signature help for functions and subroutines. Lots of bugfixes across the board.

### 0.2.3

Added Run in EViews command

### 0.2.4

Improved and more reliable call signature parser for signature help

### 0.2.5

Updates for missing EViews builtins, more hover links to files and definitions, subroutine doc strings on hover, fix broken EViews help links.
