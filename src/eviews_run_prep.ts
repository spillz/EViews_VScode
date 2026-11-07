/**
 * The EViews process executes a program from disk. This helper prepares it before
 * launching so that EViews sees the same contents as the VS Code editor.
 */
export type ProgramDocument = {
  readonly uri: { readonly scheme: string; readonly fsPath: string };
  readonly isDirty: boolean;
  save(): PromiseLike<boolean>;
};

export type PreparedProgram =
  | { ready: true; filePath: string }
  | { ready: false; reason: 'not-file' | 'save-failed' };

export async function prepareProgramForRun(
  document: ProgramDocument
): Promise<PreparedProgram> {
  // Untitled and virtual documents do not have a runnable filesystem path.
  if (document.uri.scheme !== 'file' || !document.uri.fsPath) {
    return { ready: false, reason: 'not-file' };
  }

  if (document.isDirty) {
    try {
      if (!await document.save()) {
        return { ready: false, reason: 'save-failed' };
      }
    } catch {
      return { ready: false, reason: 'save-failed' };
    }
  }

  return { ready: true, filePath: document.uri.fsPath };
}
