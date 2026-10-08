/**
 * pdf.js bootstrap. Parsing and rendering happen in a Web Worker; all
 * auxiliary assets are served from the app itself (see scripts/copy-pdfjs-assets.mjs).
 */
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const assetBase = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/pdfjs/`;

export { pdfjs };
export type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist';

export class PasswordRequiredError extends Error {
  constructor(public readonly incorrect: boolean) {
    super(incorrect ? 'Incorrect password' : 'Password required');
  }
}

export interface LoadOptions {
  password?: string;
  onProgress?: (fraction: number) => void;
}

/**
 * Parse a PDF from bytes. The bytes are copied before being handed to the
 * worker (pdf.js transfers the buffer), so the caller keeps its own copy.
 */
export interface LoadedPdf {
  pdf: PDFDocumentProxy;
  /** Destroys the worker-side document and frees its memory. */
  destroy: () => Promise<void>;
}

export async function loadPdfDocument(bytes: Uint8Array, options: LoadOptions = {}): Promise<LoadedPdf> {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    password: options.password,
    cMapUrl: `${assetBase}cmaps/`,
    standardFontDataUrl: `${assetBase}standard_fonts/`,
    wasmUrl: `${assetBase}wasm/`,
    iccUrl: `${assetBase}iccs/`,
    disableAutoFetch: true,
    // Needed to read the real font name / serif / monospace flags for style detection.
    fontExtraProperties: true,
  });
  let askedForPassword = false;
  task.onPassword = (_update: (pw: string) => void, reason: number) => {
    askedForPassword = true;
    const incorrect = reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD;
    task.destroy().catch(() => undefined);
    throw new PasswordRequiredError(incorrect);
  };
  if (options.onProgress) {
    task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
      if (total > 0) options.onProgress!(Math.min(1, loaded / total));
    };
  }
  try {
    const pdf = await task.promise;
    return { pdf, destroy: () => task.destroy() };
  } catch (err) {
    if (err instanceof PasswordRequiredError) throw err;
    if (askedForPassword || (err instanceof Error && err.name === 'PasswordException')) {
      throw new PasswordRequiredError(false);
    }
    throw new Error(describeLoadError(err));
  }
}

function describeLoadError(err: unknown): string {
  if (err instanceof Error) {
    switch (err.name) {
      case 'InvalidPDFException':
        return 'This file is not a valid PDF or is too damaged to open.';
      case 'MissingPDFException':
        return 'The file could not be read.';
      case 'UnexpectedResponseException':
        return 'Unexpected response while reading the file.';
    }
    return err.message || 'Failed to open the PDF.';
  }
  return 'Failed to open the PDF.';
}
