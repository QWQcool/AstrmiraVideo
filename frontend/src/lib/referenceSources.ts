import { taskOutput, type AssetListEntry, type TaskProgress } from '@astrmira/shared';

/**
 * S5-Ab：引用来源的**唯一适配层**。
 *
 * 首页 `@` 与画布资产选择器此前各拼一套数组：上传资产一套、任务产物一套，
 * 来源标签、搜索、类型过滤三处分叉。这里把它们收成同一种可渲染条目，
 * 并明确保留 `source`（上传 / 首页 / 画布）——**不把画布产物混进首页历史**。
 */
export type ReferenceSource = 'upload' | 'home' | 'canvas';
export type ReferenceKind = 'image' | 'video' | 'audio';

export interface ReferenceSourceItem {
  /** React key / 选择键；引用本身用 `ref` */
  key: string;
  /** 进入请求的稳定引用：assetId 或 `task:<taskId>` */
  ref: string;
  kind: ReferenceKind;
  source: ReferenceSource;
  label: string;
  /** 真实文件地址（视频是 mp4、音频是音频文件）；画布添加节点用它 */
  url: string;
  /** 只给 `<img>` 用的安全预览；视频/音频没有封面时缺省，不能把 mp4 塞进 img */
  previewUrl?: string;
  createdAt: number;
  /** 原始记录供调用方复用（画布添加节点需要 url/name） */
  asset?: AssetListEntry;
  task?: TaskProgress;
}

function assetItem(asset: AssetListEntry): ReferenceSourceItem {
  return {
    key: `upload:${asset.assetId}`,
    ref: asset.assetId,
    kind: asset.kind,
    source: 'upload',
    label: asset.name ?? asset.assetId.slice(0, 10),
    url: asset.url,
    ...(asset.kind === 'image' ? { previewUrl: asset.url } : {}),
    createdAt: asset.createdAt,
    asset,
  };
}

function taskItem(task: TaskProgress, source: Exclude<ReferenceSource, 'upload'>): ReferenceSourceItem | null {
  const output = taskOutput(task);
  if (output.kind !== 'image' && output.kind !== 'video') return null;
  return {
    key: `${source}:${task.taskId}`,
    ref: `task:${task.taskId}`,
    kind: output.kind,
    source,
    label: task.requestSnapshot.prompt.slice(0, 24) || task.taskId.slice(0, 8),
    url: output.url,
    ...(task.thumbnailUrl !== undefined
      ? { previewUrl: task.thumbnailUrl }
      : output.kind === 'image'
        ? { previewUrl: output.url }
        : {}),
    createdAt: task.createdAt,
    task,
  };
}

export function referenceSourcesFromAssets(
  assets: readonly AssetListEntry[],
): ReferenceSourceItem[] {
  return assets.map(assetItem);
}

export function referenceSourcesFromTasks(
  tasks: readonly TaskProgress[],
  source: Exclude<ReferenceSource, 'upload'>,
): ReferenceSourceItem[] {
  return tasks
    .map((task) => taskItem(task, source))
    .filter((item): item is ReferenceSourceItem => item !== null);
}

/**
 * 画布资产选择器与首页 `@` 共用搜索：名称/提示词/assetId 子串，大小写不敏感。
 * 空关键词返回全部（由调用方决定默认上限）。
 */
export function filterReferenceSources(
  items: readonly ReferenceSourceItem[],
  query: string,
  kinds?: readonly ReferenceKind[],
): ReferenceSourceItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (kinds !== undefined && !kinds.includes(item.kind)) return false;
    if (needle === '') return true;
    return (
      item.label.toLowerCase().includes(needle) || item.ref.toLowerCase().includes(needle)
    );
  });
}

/** 源文案键由界面映射，纯函数只给 source 枚举（不在 lib 里持有文案） */
export function referenceSourceLabelKey(source: ReferenceSource):
  | 'create.source.upload'
  | 'create.source.home'
  | 'create.source.canvas' {
  if (source === 'upload') return 'create.source.upload';
  if (source === 'home') return 'create.source.home';
  return 'create.source.canvas';
}

/** 画布资产选择器可添加的 kind（图/视频/音频；文本产物没有文件，不入选择器） */
export function referenceKindsForCanvas(): ReferenceKind[] {
  return ['image', 'video', 'audio'];
}
