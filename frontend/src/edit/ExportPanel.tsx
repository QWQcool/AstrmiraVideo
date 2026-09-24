import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eyebrow } from '../components/Eyebrow';
import { uploadAssets } from '../lib/api';
import { navigate } from '../lib/router';
import { formatBytes } from '../lib/overviewStats';
import { exportDurationFrames, exportFileName } from './exportMeta';
import type { EditExportProgress } from './exporter';
import type { EditStore } from './store';
import { useEditStore } from './store';
import { formatTimecode } from './time';

/**
 * 导出面板（B34 · P2）：浏览器端渲染成片。
 *
 * 架构要点：
 * - **重桥接走动态 import**（`loadExporter`）：web-renderer 只在点「导出成片」时加载，
 *   打开剪辑台不付这份下载成本（`exporter.ts` 是它唯一的 import 边界）；
 * - 导出 = 与预览**同一个 composition**，且时长取内容精确结束帧（不含预览的 1s 编辑余量）；
 * - 产物是**本机文件**（下载）；产物入库 / 与生成的闭环在 P4 接（这里如实标注，不假装已入库）。
 *
 * 状态机：idle → preflight（能力预检）→ rendering（可取消）→ done / error / cancelled。
 */

type ExportState =
  | { kind: 'idle' }
  | { kind: 'preflight' }
  | {
      kind: 'rendering';
      progress: number;
      renderedFrames: number;
      encodedFrames: number;
      totalFrames: number;
    }
  | {
      kind: 'done';
      url: string;
      name: string;
      sizeBytes: number;
      elapsedMs: number;
      durationFrames: number;
    }
  | { kind: 'error'; message: string }
  | { kind: 'cancelled' };

type ExporterModule = typeof import('./exporter');
const loadExporter = (): Promise<ExporterModule> => import('./exporter');

function describeFailure(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

export const ExportPanel: React.FC<{ store: EditStore; sourceTaskId: string | null }> = ({
  store,
  sourceTaskId,
}) => {
  const project = useEditStore(store, (s) => s.project);
  const [state, setState] = useState<ExportState>({ kind: 'idle' });
  const [archiving, setArchiving] = useState(false);
  const [archivedTaskId, setArchivedTaskId] = useState<string | null>(null);
  const [frameBusy, setFrameBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  /** 导出得到的 Blob（入库要重传它；object URL 只是展示用的门面） */
  const blobRef = useRef<Blob | null>(null);

  const revokeUrl = useCallback((): void => {
    if (urlRef.current !== null) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  // 离开剪辑台 / 重新导出时释放上一个 blob URL（否则内存里挂着整个成片）
  useEffect(() => revokeUrl, [revokeUrl]);

  const handleExport = useCallback(async (): Promise<void> => {
    revokeUrl();
    setState({ kind: 'preflight' });
    try {
      const exporter = await loadExporter();
      const preflight = await exporter.preflightEditExport(project);
      if (!preflight.canRender) {
        const reasons = preflight.issues.map((issue) => issue.message).join('；');
        setState({
          kind: 'error',
          message: `这台浏览器当前无法渲染：${reasons === '' ? '未知原因' : reasons}（需要支持 WebCodecs 的现代浏览器）`,
        });
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      const totalFrames = exportDurationFrames(project);
      setState({ kind: 'rendering', progress: 0, renderedFrames: 0, encodedFrames: 0, totalFrames });

      const result = await exporter.renderEditProject({
        project,
        mediaBaseUrl: window.location.origin,
        signal: controller.signal,
        onProgress: (progress: EditExportProgress) => {
          setState({
            kind: 'rendering',
            progress: progress.progress,
            renderedFrames: progress.renderedFrames,
            encodedFrames: progress.encodedFrames,
            totalFrames,
          });
        },
      });

      const url = URL.createObjectURL(result.blob);
      urlRef.current = url;
      blobRef.current = result.blob;
      setArchivedTaskId(null);
      setState({
        kind: 'done',
        url,
        name: exportFileName(sourceTaskId, Date.now()),
        sizeBytes: result.blob.size,
        elapsedMs: result.elapsedMs,
        durationFrames: result.durationFrames,
      });
    } catch (caught) {
      // AbortError = 用户主动取消，与故障区分（不吓唬人）
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setState({ kind: 'cancelled' });
        return;
      }
      setState({ kind: 'error', message: describeFailure(caught) });
    } finally {
      abortRef.current = null;
    }
  }, [project, revokeUrl, sourceTaskId]);

  const handleCancel = useCallback((): void => {
    abortRef.current?.abort();
  }, []);

  /** 入库（CONTRACT §11-2）：把渲染好的 MP4 + 工程 JSON 传回服务端归档，成为一条剪辑产物 */
  const handleArchive = useCallback(async (): Promise<void> => {
    const blob = blobRef.current;
    if (blob === null || sourceTaskId === null) return;
    setArchiving(true);
    setActionError(null);
    try {
      const { submitEditRender } = await import('../lib/api');
      const created = await submitEditRender({ file: blob, sourceTaskId, project });
      setArchivedTaskId(created.taskId);
    } catch (caught) {
      setActionError(describeFailure(caught));
    } finally {
      setArchiving(false);
    }
  }, [project, sourceTaskId]);

  /**
   * 抽帧 → 参考资产（D38 闭环）：渲染**播放头那一帧**（与预览同构图，含字幕/转场）→
   * 走既有 `POST /api/upload` 落成资产 → 交棒给工作台（首帧槽 + I2V 模式）。
   */
  const handleExtractFrame = useCallback(async (): Promise<void> => {
    setFrameBusy(true);
    setActionError(null);
    try {
      const exporter = await loadExporter();
      const still = await exporter.renderEditStill({
        project,
        mediaBaseUrl: window.location.origin,
        frame: store.getState().playheadFrame,
      });
      const file = new File([still.blob], `frame-${still.frame}.png`, { type: 'image/png' });
      const uploaded = await uploadAssets([file]);
      const asset = uploaded.assets[0];
      if (asset === undefined) {
        setActionError('抽帧上传未返回任何资产');
        return;
      }
      // 扩展名用**上传响应的清洗产物事实**（透明保 PNG、其余转 JPEG），不猜
      const ext = asset.mime === 'image/png' ? 'png' : 'jpg';
      navigate(`#/workbench?frameAsset=${encodeURIComponent(asset.assetId)}&frameExt=${ext}`);
    } catch (caught) {
      setActionError(describeFailure(caught));
    } finally {
      setFrameBusy(false);
    }
  }, [project, store]);

  const exportFrames = exportDurationFrames(project);

  return (
    <section className="wb-panel ed-side-panel">
      <div className="wb-field-head">
        <Eyebrow index={2} tone="gold" as="h2">
          导出
        </Eyebrow>
        <span className="wb-note">
          {formatTimecode(exportFrames, project.fps)} · {project.width}×{project.height}
        </span>
      </div>

      {state.kind === 'idle' || state.kind === 'preflight' ? (
        <p className="wb-note">浏览器端渲染（WebCodecs 硬件编码）：不占服务器算力，产物直接下载到本机。</p>
      ) : null}

      {state.kind === 'rendering' ? (
        <div className="ed-export-progress">
          <div className="ed-export-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.progress * 100)}>
            <div className="ed-export-bar-fill" style={{ width: `${Math.round(state.progress * 100)}%` }} />
          </div>
          <span className="wb-note">
            渲染中 {Math.round(state.progress * 100)}% · 已渲染 {state.renderedFrames}/{state.totalFrames} 帧 · 已编码{' '}
            {state.encodedFrames} 帧
          </span>
        </div>
      ) : null}

      {state.kind === 'done' ? (
        <div className="ed-export-result">
          <video className="ed-export-video" src={state.url} controls preload="metadata" />
          <p className="wb-note">
            {formatBytes(state.sizeBytes)} · {formatTimecode(state.durationFrames, project.fps)} · 渲染耗时{' '}
            {(state.elapsedMs / 1000).toFixed(1)}s
          </p>
          <div className="ed-export-actions">
            <a className="wb-btn wb-btn-gold" href={state.url} download={state.name}>
              ⤓ 下载 MP4
            </a>
            {archivedTaskId === null ? (
              <button
                type="button"
                className="wb-btn"
                disabled={archiving || sourceTaskId === null}
                title="把成片与多轨工程一起归档到服务端（出现在「本片剪辑历史」，可继续编辑 / 抽帧）"
                onClick={() => void handleArchive()}
              >
                {archiving ? '入库中…' : '📥 入库'}
              </button>
            ) : (
              <span className="wb-note">
                已入库 {archivedTaskId.slice(0, 8)}（下方「本片剪辑历史」可继续编辑）
              </span>
            )}
          </div>
        </div>
      ) : null}

      {state.kind === 'error' ? (
        <div className="wb-uncertain" style={{ marginBottom: 10 }}>
          <span className="wb-uncertain-title">导出失败</span>
          <span className="wb-uncertain-body">{state.message}</span>
        </div>
      ) : null}

      {state.kind === 'cancelled' ? <p className="wb-note">已取消导出（未产生文件）。</p> : null}

      {actionError === null ? null : (
        <div className="wb-uncertain" style={{ marginBottom: 10 }}>
          <span className="wb-uncertain-title">操作失败</span>
          <span className="wb-uncertain-body">{actionError}</span>
        </div>
      )}

      <div className="ed-export-actions">
        {state.kind === 'rendering' || state.kind === 'preflight' ? (
          <button type="button" className="wb-btn" onClick={handleCancel}>
            取消
          </button>
        ) : (
          <button
            type="button"
            className="wb-btn wb-btn-gold"
            onClick={() => void handleExport()}
            title="用浏览器硬件编码渲染 MP4（与预览同一套合成）"
          >
            🎬 导出成片（浏览器渲染）
          </button>
        )}
        <button
          type="button"
          className="wb-btn"
          disabled={frameBusy}
          title="渲染播放头那一帧（与预览同构图，含字幕/转场）→ 落为参考资产并切到 I2V 首帧"
          onClick={() => void handleExtractFrame()}
        >
          {frameBusy ? '抽帧中…' : '📸 抽帧为参考资产'}
        </button>
      </div>
      <p className="wb-note ed-export-note">
        渲染在你的浏览器里完成（不占服务器算力）；「入库」才会上传到服务端归档 · 渲染期间请保持本页在前台
      </p>
    </section>
  );
};
