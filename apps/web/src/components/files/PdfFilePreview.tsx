import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { LoaderCircle, Minus, Plus } from "lucide-react";
import {
  getDocument,
  GlobalWorkerOptions,
  PasswordException,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { Button } from "~/components/ui/button";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;
const PAGE_GAP_PX = 12;
const PAGE_PADDING_PX = 16;
// Pages this far outside the viewport keep their bitmap; farther ones release it.
const PAGE_RENDER_MARGIN = "1200px 0px";
// Re-rasterize only after a resize settles; CSS scales the old bitmap meanwhile.
const RESIZE_SETTLE_MS = 150;

type PdfState =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Failure"; readonly message: string }
  | {
      readonly _tag: "Ready";
      readonly document: PDFDocumentProxy;
      readonly pageAspectRatio: number;
    };

function PdfError(props: { readonly children: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs leading-relaxed text-destructive">
      {props.children}
    </div>
  );
}

function PdfPage(props: {
  readonly document: PDFDocumentProxy;
  readonly pageNumber: number;
  readonly cssWidth: number;
  readonly renderWidth: number;
  readonly estimatedAspectRatio: number;
  readonly scrollRoot: HTMLElement;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { root: props.scrollRoot, rootMargin: PAGE_RENDER_MARGIN },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [props.scrollRoot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!visible || props.renderWidth <= 0) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }

    let cancelled = false;
    let renderTask: RenderTask | null = null;
    void (async () => {
      try {
        const page = await props.document.getPage(props.pageNumber);
        if (cancelled) return;
        const baseViewport = page.getViewport({ scale: 1 });
        setAspectRatio(baseViewport.height / baseViewport.width);
        const outputScale = window.devicePixelRatio || 1;
        const viewport = page.getViewport({
          scale: (props.renderWidth / baseViewport.width) * outputScale,
        });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        renderTask = page.render({ canvas, viewport });
        await renderTask.promise;
      } catch (error) {
        if (!cancelled) console.error("Failed to render PDF page", error);
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [props.document, props.pageNumber, props.renderWidth, visible]);

  return (
    <div
      ref={containerRef}
      className="relative shrink-0 bg-white shadow-sm ring-1 ring-black/10"
      style={{
        width: props.cssWidth,
        height: props.cssWidth * (aspectRatio ?? props.estimatedAspectRatio),
      }}
    >
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}

function PdfDocumentView(props: {
  readonly document: PDFDocumentProxy;
  readonly pageAspectRatio: number;
}) {
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [settledWidth, setSettledWidth] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(ZOOM_STEPS.indexOf(1));
  const zoom = ZOOM_STEPS[zoomIndex] ?? 1;

  useEffect(() => {
    if (!scrollRoot) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailableWidth(Math.max(0, entry.contentRect.width - PAGE_PADDING_PX * 2));
    });
    observer.observe(scrollRoot);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    const timeout = setTimeout(() => setSettledWidth(availableWidth), RESIZE_SETTLE_MS);
    return () => clearTimeout(timeout);
  }, [availableWidth]);

  const pageNumbers = Array.from({ length: props.document.numPages }, (_, index) => index + 1);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-end gap-1 border-b border-border px-3 py-1 text-xs text-muted-foreground">
        <span className="mr-auto">
          {props.document.numPages} {props.document.numPages === 1 ? "page" : "pages"}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Zoom out"
          disabled={zoomIndex === 0}
          onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}
        >
          <Minus />
        </Button>
        <button
          type="button"
          className="w-11 text-center tabular-nums hover:text-foreground"
          aria-label="Fit to width"
          onClick={() => setZoomIndex(ZOOM_STEPS.indexOf(1))}
        >
          {Math.round(zoom * 100)}%
        </button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Zoom in"
          disabled={zoomIndex === ZOOM_STEPS.length - 1}
          onClick={() => setZoomIndex((index) => Math.min(ZOOM_STEPS.length - 1, index + 1))}
        >
          <Plus />
        </Button>
      </div>
      <div ref={setScrollRoot} className="min-h-0 flex-1 overflow-auto bg-muted/40">
        {scrollRoot && availableWidth > 0 ? (
          <div
            className="flex w-max min-w-full flex-col items-center"
            style={{ gap: PAGE_GAP_PX, padding: PAGE_PADDING_PX }}
          >
            {pageNumbers.map((pageNumber) => (
              <PdfPage
                key={pageNumber}
                document={props.document}
                pageNumber={pageNumber}
                cssWidth={availableWidth * zoom}
                renderWidth={settledWidth * zoom}
                estimatedAspectRatio={props.pageAspectRatio}
                scrollRoot={scrollRoot}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Renders a workspace PDF inline with pdf.js, rasterizing only pages near the viewport. */
export default function PdfFilePreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly absolutePath: string;
}) {
  const assetUrl = useAssetUrlState(props.environmentId, {
    _tag: "workspace-file",
    threadId: props.threadRef.threadId,
    path: props.absolutePath,
  });
  const url = assetUrl._tag === "Success" ? assetUrl.url : null;
  const [state, setState] = useState<PdfState>({ _tag: "Loading" });

  useEffect(() => {
    if (url === null) return;
    const abort = new AbortController();
    let loadingTask: PDFDocumentLoadingTask | null = null;

    void (async () => {
      try {
        const response = await fetch(url, { signal: abort.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = new Uint8Array(await response.arrayBuffer());
        if (abort.signal.aborted) return;
        loadingTask = getDocument({ data });
        const document = await loadingTask.promise;
        const firstPage = await document.getPage(1);
        if (abort.signal.aborted) return;
        const viewport = firstPage.getViewport({ scale: 1 });
        setState({
          _tag: "Ready",
          document,
          pageAspectRatio: viewport.height / viewport.width,
        });
      } catch (error) {
        if (abort.signal.aborted) return;
        setState({
          _tag: "Failure",
          message:
            error instanceof PasswordException
              ? "This PDF is password protected."
              : "Unable to load this PDF.",
        });
      }
    })();

    return () => {
      abort.abort();
      // Destroying the loading task also destroys its document and worker.
      void loadingTask?.destroy();
    };
  }, [url]);

  if (assetUrl._tag === "Failure") {
    return <PdfError>Unable to load this PDF.</PdfError>;
  }
  if (state._tag === "Failure") {
    return <PdfError>{state.message}</PdfError>;
  }
  if (state._tag === "Loading") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );
  }
  return <PdfDocumentView document={state.document} pageAspectRatio={state.pageAspectRatio} />;
}
