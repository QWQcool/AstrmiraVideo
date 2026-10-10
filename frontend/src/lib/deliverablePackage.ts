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
  options: Pick<DeliverableOptions, 'includeVideo' | 'includeProject' | 'includeCover' | 'includeManifest'>,
  onProgress?: (progress: DeliverableProgress) => void,
): Promise<BuiltDeliverable> {
  const entries: ZipEntry[] = [];
  const total = plan.plannedEntryCount;
  let done = 0;

  const fetchBytes = async (url: string, what: string): Promise<Uint8Array> => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`取 ${what} 失败（HTTP ${response.status}）：${url}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  };

  for (const item of plan.items) {
    if (options.includeVideo) {
      onProgress?.({ done, total, label: `读取成片 ${item.videoFileName}` });
      entries.push({
        name: item.videoFileName,
        data: await fetchBytes(mediaUrlOf(item.task), '成片'),
      });
      done += 1;
    }
    if (options.includeProject && item.task.origin?.kind === 'edit') {
      onProgress?.({ done, total, label: `写入工程 ${item.projectFileName}` });
      entries.push({
        name: item.projectFileName,
        data: new TextEncoder().encode(JSON.stringify(item.task.origin.project, null, 2)),
      });
      done += 1;
    }
    if (options.includeCover && item.coverFileName !== '') {
      onProgress?.({ done, total, label: `读取封面 ${item.coverFileName}` });
      const coverUrl = resolveMediaUrl(item.task.thumbnailUrl);
      if (coverUrl !== null) {
        entries.push({ name: item.coverFileName, data: await fetchBytes(coverUrl, '封面') });
        done += 1;
      }
    }
  }

  if (options.includeManifest) {
    onProgress?.({ done, total, label: '写入交付清单' });
    entries.push({
      name: plan.manifestFileName,
      // 缩进两格：客户可能直接打开看，JSON 也要"能读"
      data: new TextEncoder().encode(JSON.stringify(plan.manifest, null, 2)),
    });
    done += 1;
  }

  // 包内时间戳用"打包时刻"（命名里的日期来自 plan，两者刻意分开：命名是交付语义，时间戳是文件系统元信息）
  const bytes = buildZipStore(entries, new Date());
  const entryNames = entries.map((entry) => entry.name);
  onProgress?.({ done, total: done, label: '完成' });
  return { bytes, packageName: plan.packageName, entryNames };
}

/** 成片直链（`/media/<taskId>.mp4`）；没有产物时如实抛错，不猜路径 */
function mediaUrlOf(task: TaskProgress): string {
  const url = resolveMediaUrl(task.outputVideoUrl);
  if (url === null) throw new Error(`任务 ${task.taskId.slice(0, 8)} 没有可下载的成片`);
  return url;
}

/** 生成并触发浏览器下载（唯一碰 DOM 的出口） */
export function saveDeliverable(built: BuiltDeliverable): void {
  downloadBytes(built.bytes, built.packageName);
}
