import { exportDurationFrames } from './exportMeta';
import type { EditProject } from './model';
import { EditComposition } from './Composition';

/**
 * 浏览器端导出桥接（B34 · P2）：`@remotion/web-renderer` 的**唯一 import 边界**。
 *
 * 本模块由 UI 用**动态 import** 加载（见 ExportPanel 的 loadExporter），
 * 因此 web-renderer（含 mediabunny）只在用户点「导出成片」时才进浏览器。
 *
 * 三条 P0 实测结论的落地处：
 * 1. **同一套 composition**：导出传入的就是预览用 `EditComposition`（预览即所得）；
 * 2. **绝对 URL**：`mediaBaseUrl` 由调用方传 `window.location.origin`；
 * 3. **遥测已短路**：`@remotion/web-renderer` 经 pnpm `patchedDependencies` 打过补丁
 *    （见 `patches/`、`docs/UPSTREAM.md` #13、`webRendererPatch.test.ts` 守卫）。
 */

export interface EditExportIssue {
  type: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface EditExportPreflight {
  canRender: boolean;
  issues: EditExportIssue[];
}

export interface EditExportProgress {
  /** 0~1 */
  progress: number;
  renderedFrames: number;
  encodedFrames: number;
  /** 全部帧编码完成后的总耗时（ms）；进行中为 null */
  doneInMs: number | null;
}

export interface EditExportResult {
  blob: Blob;
  elapsedMs: number;
  durationFrames: number;
}

/** 能力预检（WebCodecs / 编码器 / WebGL）：诚实回答「这台浏览器能不能渲染」，而不是点了才炸 */
export async function preflightEditExport(project: EditProject): Promise<EditExportPreflight> {
  const { canRenderMediaOnWeb } = await import('@remotion/web-renderer');
  const result = await canRenderMediaOnWeb({
    width: project.width,
    height: project.height,
  });
  return {
    canRender: result.canRender,
    issues: result.issues.map((issue) => ({
      type: issue.type,
      message: issue.message,
      severity: issue.severity,
    })),
  };
}

export interface RenderEditOptions {
  project: EditProject;
  mediaBaseUrl: string;
  signal?: AbortSignal;
  onProgress?: (progress: EditExportProgress) => void;
}

export async function renderEditProject(options: RenderEditOptions): Promise<EditExportResult> {
  const { renderMediaOnWeb } = await import('@remotion/web-renderer');
  const { project, mediaBaseUrl, signal, onProgress } = options;
  const durationFrames = exportDurationFrames(project);
  const started = performance.now();
  const inputProps = { project, mediaBaseUrl };

  const result = await renderMediaOnWeb({
    composition: {
      id: 'AstrmiraEdit',
      component: EditComposition,
      width: project.width,
      height: project.height,
      fps: project.fps,
      durationInFrames: durationFrames,
      // 显式 composition 路径要求 defaultProps（与 inputProps 同源；组件两个 props 都必填）
      defaultProps: inputProps,
    },
    inputProps,
    // 免费资格声明（≤3 人小团队、非商业化；合规边界见 docs/UPSTREAM.md #13）。
    // 遥测已被 pnpm 补丁短路为 no-op，这条声明不会被外发到 remotion.pro。
    licenseKey: 'free-license',
    logLevel: 'warn',
    signal: signal ?? null,
    onProgress: (progress) => {
      onProgress?.({
        progress: progress.progress,
        renderedFrames: progress.renderedFrames,
        encodedFrames: progress.encodedFrames,
        doneInMs: progress.doneIn,
      });
    },
  });

  const blob = await result.getBlob();
  return { blob, elapsedMs: performance.now() - started, durationFrames };
}
