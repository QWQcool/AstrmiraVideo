import {
  buildDeliverableFileName,
  buildDeliverableManifest,
  buildDeliverablePackageName,
  presetWarnings,
  type DeliverableManifest,
  type PlatformPreset,
  type TaskProgress,
} from '@astrmira/shared';
import { resolveMediaUrl } from './api';
import { getLanguage, translate } from './i18n';
import { transcodeToPreset } from './presetTranscode';
import { buildZipStore, downloadBytes, type ZipEntry } from './zipStore';

/**
 * 交付包组装（V2.13 / 台账 B49，契约 §14）。
 *
 * ## 为什么在浏览器端组装
 * 包里装的是**同源**的成片与封面（`/media/*` 就在浏览器手边），而部署机器是 4 核小服务器；
 * 让它在内存里拼几十 MB 的 zip 是拿服务器换客户的本机 CPU —— 与 Step 7「渲染在浏览器」同一取向。
 * 代价与收益都说清楚：单条成片要**已经下载到浏览器**才能进包（本来也要下载才能交付）。
 *
 * ## 分两层：`plan*` 是纯函数（可单测），`build*` 才碰网络与 DOM
 * 命名、清单、规格告警全部在 `planDeliverablePackage` 里算完 —— 这些是最容易写错、
 * 又最值得用单测钉住的部分；`buildDeliverableZip` 只负责"按计划取字节、拼包、下载"。
 */

export interface DeliverableOptions {
  preset: PlatformPreset;
  projectName: string;
  projectId: string;
  /** 把成片本身装进包（关掉就是"只交付清单"） */
  includeVideo: boolean;
  /** 剪辑产物的工程 JSON（可复现的关键；非剪辑产物没有） */
  includeProject: boolean;
  /** 封面图（若有） */
  includeCover: boolean;
  /** 归档清单（默认开；关掉就没有"这包是什么"的说明书） */
  includeManifest: boolean;
  /**
   * 按预设**重新渲染**成目标画幅（V2.14 / 片 B）。
   * 关掉 = 原文件进包（快，但画幅与预设不一致时平台会自己裁/压）；开 = 浏览器内渲染一遍（慢，但规格对齐）。
   */
  transcode: boolean;
  date?: Date;
}

export interface DeliverablePlanItem {
  task: TaskProgress;
  /** 成片在包内的文件名 */
  videoFileName: string;
  /** 工程 JSON 在包内的文件名 */
  projectFileName: string;
  /** 封面在包内的文件名（无封面 / 不勾选时为空串） */
  coverFileName: string;
  /** 规格对齐告警（**只提示不阻断**） */
  warnings: string[];
}

export interface DeliverablePlan {
  packageName: string;
  manifestFileName: string;
  items: DeliverablePlanItem[];
  manifest: DeliverableManifest;
  /** 计划里总条目数（含清单与封面），给界面显示"包里有几个文件" */
  plannedEntryCount: number;
}

function durationOf(task: TaskProgress): number {
  return task.requestSnapshot.params?.durationSec ?? 0;
}

/**
 * 纯函数：把选中的任务排成一份**交付计划**（文件名 + 清单 + 告警）。
 *
 * 顺序 = 传入顺序（界面按当前排序传入）—— 交付包的序号就该跟用户看到的顺序一致。
 */
export function planDeliverablePackage(
  tasks: TaskProgress[],
  options: DeliverableOptions,
): DeliverablePlan {
  const date = options.date ?? new Date();
  const total = tasks.length;

  const items: DeliverablePlanItem[] = tasks.map((task, position) => {
    const nameInput = {
      preset: options.preset,
      projectName: options.projectName,
      semantic: task.requestSnapshot.prompt,
      taskId: task.taskId,
      index: position + 1,
      total,
      date,
    };
    const base = buildDeliverableFileName({ ...nameInput, ext: 'mp4' });
    const stem = base.slice(0, -'.mp4'.length);
    return {
      task,
      videoFileName: base,
      projectFileName: `${stem}.project.json`,
      coverFileName: task.thumbnailUrl === undefined ? '' : `${stem}.cover.jpg`,
      warnings: presetWarnings(
        {
          aspectRatio: task.requestSnapshot.aspectRatio,
          durationSec: durationOf(task),
        },
        options.preset,
      ),
    };
  });

  const manifest = buildDeliverableManifest({
    project: { projectId: options.projectId, name: options.projectName },
    preset: options.preset,
    generatedAt: date.getTime(),
    items: items.map((item) => ({
      taskId: item.task.taskId,
      fileName: item.videoFileName,
      prompt: item.task.requestSnapshot.prompt,
      mode: item.task.requestSnapshot.mode,
      aspectRatio: item.task.requestSnapshot.aspectRatio,
      durationSec: durationOf(item.task),
      createdAt: item.task.createdAt,
      packaged: options.includeVideo,
      projectIncluded: options.includeProject && item.task.origin?.kind === 'edit',
      // 这里是**意图**；`buildDeliverableZip` 会按渲染结果把实际值写回清单再入包
      transcoded: options.transcode,
      assets: Object.values(item.task.requestSnapshot.assets ?? {}),
      extractedAssetCount: item.task.extractedAssetIds?.length ?? 0,
      ...(item.task.cost === undefined ? {} : { costYuan: item.task.cost.yuan }),
      warnings: item.warnings,
    })),
  });

  const covers = options.includeCover
    ? items.filter((item) => item.coverFileName !== '').length
    : 0;
  const projects = options.includeProject
    ? items.filter((item) => item.task.origin?.kind === 'edit').length
    : 0;

  return {
    packageName: buildDeliverablePackageName({
      projectName: options.projectName,
      preset: options.preset,
      count: total,
      date,
    }),
    // 这是**产物内容**（zip 里的那个文件名），不是界面文案 —— 与包名前缀同一口径：
    // 客户拿到的包**不该因为界面语言变了就换文件名**。界面上的复选框标签另有字典键
    // （`library.deliver.includeManifest`）—— 同一句话，两个命运。
    // i18n-exempt: 交付包内的清单文件名（产物内容，理由见上三行）
    manifestFileName: '交付清单.json',
    items,
    manifest,
    plannedEntryCount:
      (options.includeVideo ? total : 0) + covers + projects + (options.includeManifest ? 1 : 0),
  };
}

export interface DeliverableProgress {
  done: number;
  total: number;
  label: string;
}

export interface BuiltDeliverable {
  bytes: Uint8Array;
  packageName: string;
  /** 包里真实的条目名（给界面/冒烟断言用） */
  entryNames: string[];
}

/**
 * 按计划取字节并拼包。**任一条取不到就整体失败**并说清是哪一条 ——
 * 交付包最糟糕的形态是"少了一条但没人知道"（客户拿去投放才发现缺片）。
 */
export async function buildDeliverableZip(
  plan: DeliverablePlan,
  options: Pick<
    DeliverableOptions,
    'includeVideo' | 'includeProject' | 'includeCover' | 'includeManifest' | 'transcode'
  > & { preset: PlatformPreset },
  onProgress?: (progress: DeliverableProgress) => void,
): Promise<BuiltDeliverable> {
  const entries: ZipEntry[] = [];
  const total = plan.plannedEntryCount;
  let done = 0;
  /** 逐条的**实际**转码结果（写回清单用；意图 ≠ 事实 —— 已对齐的片子会被跳过） */
  const actualTranscoded = new Map<string, boolean>();

  const fetchBytes = async (url: string, what: string): Promise<Uint8Array> => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
    translate(getLanguage(), 'library.deliver.fetchFailed', {
      what,
      status: response.status,
      url,
    }),
  );
    }
    return new Uint8Array(await response.arrayBuffer());
  };

  for (const item of plan.items) {
    if (options.includeVideo) {
      if (options.transcode) {
        // 转码输出 = 目标画幅的新文件（画幅 cover 裁切、帧率归一到工程帧率、时长不动）
        const result = await transcodeToPreset(
          { url: mediaUrlOf(item.task), taskId: item.task.taskId },
          options.preset,
          {
            onProgress: (message, ratio) =>
              onProgress?.({
                done,
                total,
                label: `${message}（${Math.round(ratio * 100)}%）`,
              }),
          },
        );
        actualTranscoded.set(item.task.taskId, result.transcoded);
        entries.push({
          name: item.videoFileName,
          data: new Uint8Array(await result.blob.arrayBuffer()),
        });
      } else {
        onProgress?.({
    done,
    total,
    label: translate(getLanguage(), 'library.deliver.progress.readVideo', {
      name: item.videoFileName,
    }),
  });
        entries.push({
          name: item.videoFileName,
          data: await fetchBytes(
      mediaUrlOf(item.task),
      translate(getLanguage(), 'library.deliver.whatVideo'),
    ),
        });
      }
      done += 1;
    }
    if (options.includeProject && item.task.origin?.kind === 'edit') {
      onProgress?.({
    done,
    total,
    label: translate(getLanguage(), 'library.deliver.progress.writeProject', {
      name: item.projectFileName,
    }),
  });
      entries.push({
        name: item.projectFileName,
        data: new TextEncoder().encode(JSON.stringify(item.task.origin.project, null, 2)),
      });
      done += 1;
    }
    if (options.includeCover && item.coverFileName !== '') {
      onProgress?.({
    done,
    total,
    label: translate(getLanguage(), 'library.deliver.progress.readCover', {
      name: item.coverFileName,
    }),
  });
      const coverUrl = resolveMediaUrl(item.task.thumbnailUrl);
      if (coverUrl !== null) {
        entries.push({
    name: item.coverFileName,
    data: await fetchBytes(coverUrl, translate(getLanguage(), 'library.deliver.whatCover')),
  });
        done += 1;
      }
    }
  }

  if (options.includeManifest) {
    onProgress?.({
    done,
    total,
    label: translate(getLanguage(), 'library.deliver.progress.writeManifest'),
  });
    // 清单里的 `transcoded` 用**实际结果**覆盖计划里的意图：已对齐的片子不写"转过"（不谎报）
    const manifest = {
      ...plan.manifest,
      items: plan.manifest.items.map((item) => ({
        ...item,
        transcoded: actualTranscoded.get(item.taskId) ?? item.transcoded,
      })),
    };
    entries.push({
      name: plan.manifestFileName,
      // 缩进两格：客户可能直接打开看，JSON 也要"能读"
      data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
    });
    done += 1;
  }

  // 包内时间戳用"打包时刻"（命名里的日期来自 plan，两者刻意分开：命名是交付语义，时间戳是文件系统元信息）
  const bytes = buildZipStore(entries, new Date());
  const entryNames = entries.map((entry) => entry.name);
  onProgress?.({ done, total: done, label: translate(getLanguage(), 'library.deliver.progress.done') });
  return { bytes, packageName: plan.packageName, entryNames };
}

/** 成片直链（`/media/<taskId>.mp4`）；没有产物时如实抛错，不猜路径 */
function mediaUrlOf(task: TaskProgress): string {
  const url = resolveMediaUrl(task.outputVideoUrl);
  if (url === null) {
    throw new Error(
      translate(getLanguage(), 'library.deliver.noDownloadable', {
        id: task.taskId.slice(0, 8),
      }),
    );
  }
  return url;
}

/** 生成并触发浏览器下载（唯一碰 DOM 的出口） */
export function saveDeliverable(built: BuiltDeliverable): void {
  downloadBytes(built.bytes, built.packageName);
}
