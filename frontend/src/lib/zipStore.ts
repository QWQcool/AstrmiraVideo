/**
 * 最小 ZIP 写入器（store-only，**不压缩**）—— 交付包用（V2.13 / 台账 B49）。
 *
 * ## 为什么不引 zip 库、也不压缩
 * 1. **包里装的是 MP4 / JPEG / JSON** —— MP4 与 JPEG 自己已经是压缩格式，deflate 一遍几乎不缩小，
 *    只换来 CPU 与一个第三方依赖；"store" 是正确的压缩方法，而不是偷懒；
 * 2. 交付包要**在浏览器端组装**（与 Step 7 的"渲染在浏览器"同一取向：4 核小机器不该替客户
 *    去打包几十 MB 的视频）；
 * 3. 手写 ZIP 的格式部分只有几十行，且**可被单测逐字节钉住**（CRC32 / 偏移 / 目录）。
 *
 * ## 格式要点（本文件只做最小可用子集）
 * - 文件名用 **UTF-8 且带 flag 0x0800**（否则 Windows 资源管理器会按 CP437 解出乱码）；
 * - 时间戳用 DOS 格式（本地时区，1980~2107 之外夹紧）—— 交付包里"文件日期"是给人看的元信息；
 * - 单文件与总量都**不许超 4GB**（ZIP64 不做；超了如实报错，而不是写一个坏包）。
 */

import { getLanguage, translate } from './i18n';

export interface ZipEntry {
  /** 包内路径（可带 `/` 层级）。同名会被自动去重（见 `uniqueName`） */
  name: string;
  data: Uint8Array;
}

const MAX_UINT32 = 0xffff_ffff;
const DOS_TIME_FLOOR = Date.UTC(1980, 0, 1);

/** CRC32（IEEE 802.3，反射实现）——ZIP 的校验字段 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

/** DOS 日期/时间（本地时区；早于 1980 或晚于 2107 一律夹紧 —— 坏字段会让解压器报错） */
function dosDateTime(date: Date): { time: number; date: number } {
  const clamped = date.getTime() < DOS_TIME_FLOOR ? new Date(DOS_TIME_FLOOR) : date;
  const year = Math.min(2107, Math.max(1980, clamped.getFullYear()));
  return {
    time:
      (clamped.getHours() << 11) | (clamped.getMinutes() << 5) | (clamped.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((clamped.getMonth() + 1) << 5) | clamped.getDate(),
  };
}

/** 同名去重：`a.mp4` → `a (2).mp4`（交付包里两个同名条目会让解压器互相覆盖） */
export function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot <= 0 ? name : name.slice(0, dot);
  const ext = dot <= 0 ? '' : name.slice(dot);
  for (let seq = 2; ; seq += 1) {
    const candidate = `${stem} (${seq})${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

interface PreparedEntry extends ZipEntry {
  crc: number;
  offset: number;
  time: number;
  date: number;
  nameBytes: Uint8Array;
}

export function buildZipStore(entries: ZipEntry[], modifiedAt: Date = new Date()): Uint8Array {
  const used = new Set<string>();
  let total = 0;
  const prepared: PreparedEntry[] = entries.map((entry) => {
    const name = uniqueName(entry.name, used);
    const nameBytes = new TextEncoder().encode(name);
    const { time, date } = dosDateTime(modifiedAt);
    total += entry.data.length;
    return { ...entry, name, nameBytes, crc: crc32(entry.data), offset: 0, time, date };
  });

  if (total > MAX_UINT32) {
    throw new Error(translate(getLanguage(), 'library.zip.tooLarge'));
  }

  const localSize = prepared.reduce((sum, item) => sum + 30 + item.nameBytes.length + item.data.length, 0);
  const centralSize = prepared.reduce((sum, item) => sum + 46 + item.nameBytes.length, 0);
  const buffer = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(buffer.buffer);
  let cursor = 0;

  for (const item of prepared) {
    item.offset = cursor;
    view.setUint32(cursor, 0x0403_4b50, true); // local file header
    view.setUint16(cursor + 4, 20, true); // version needed
    view.setUint16(cursor + 6, 0x0800, true); // flags: UTF-8 文件名
    view.setUint16(cursor + 8, 0, true); // method: store
    view.setUint16(cursor + 10, item.time, true);
    view.setUint16(cursor + 12, item.date, true);
    view.setUint32(cursor + 14, item.crc, true);
    view.setUint32(cursor + 18, item.data.length, true);
    view.setUint32(cursor + 22, item.data.length, true);
    view.setUint16(cursor + 26, item.nameBytes.length, true);
    view.setUint16(cursor + 28, 0, true); // extra length
    cursor += 30;
    buffer.set(item.nameBytes, cursor);
    cursor += item.nameBytes.length;
    buffer.set(item.data, cursor);
    cursor += item.data.length;
  }

  const centralStart = cursor;
  for (const item of prepared) {
    view.setUint32(cursor, 0x0201_4b50, true); // central directory header
    view.setUint16(cursor + 4, 20, true); // version made by
    view.setUint16(cursor + 6, 20, true); // version needed
    view.setUint16(cursor + 8, 0x0800, true);
    view.setUint16(cursor + 10, 0, true);
    view.setUint16(cursor + 12, item.time, true);
    view.setUint16(cursor + 14, item.date, true);
    view.setUint32(cursor + 16, item.crc, true);
    view.setUint32(cursor + 20, item.data.length, true);
    view.setUint32(cursor + 24, item.data.length, true);
    view.setUint16(cursor + 28, item.nameBytes.length, true);
    view.setUint16(cursor + 30, 0, true); // extra
    view.setUint16(cursor + 32, 0, true); // comment
    view.setUint16(cursor + 34, 0, true); // disk number start
    view.setUint16(cursor + 36, 0, true); // internal attrs
    view.setUint32(cursor + 38, 0, true); // external attrs
    view.setUint32(cursor + 42, item.offset, true);
    cursor += 46;
    buffer.set(item.nameBytes, cursor);
    cursor += item.nameBytes.length;
  }

  view.setUint32(cursor, 0x0605_4b50, true); // end of central directory
  view.setUint16(cursor + 4, 0, true);
  view.setUint16(cursor + 6, 0, true);
  view.setUint16(cursor + 8, prepared.length, true);
  view.setUint16(cursor + 10, prepared.length, true);
  view.setUint32(cursor + 12, centralSize, true);
  view.setUint32(cursor + 16, centralStart, true);
  view.setUint16(cursor + 20, 0, true);

  return buffer;
}

/**
 * 读回包内条目名（**给冒烟与自测用**：断言"包里真的有那些文件"）。
 * 只认自己写出的 store-only 包；遇到不认识的格式如实抛错。
 */
export function readZipEntryNames(buffer: Uint8Array): string[] {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) !== 0x0605_4b50) continue;
    const count = view.getUint16(i + 10, true);
    let cursor = view.getUint32(i + 16, true);
    const names: string[] = [];
    for (let index = 0; index < count; index += 1) {
      if (view.getUint32(cursor, true) !== 0x0201_4b50) {
    throw new Error(translate(getLanguage(), 'library.zip.badCentralDirectory'));
  }
      const nameLength = view.getUint16(cursor + 28, true);
      names.push(
        new TextDecoder().decode(buffer.subarray(cursor + 46, cursor + 46 + nameLength)),
      );
      cursor += 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
    }
    return names;
  }
  throw new Error(translate(getLanguage(), 'library.zip.notZip'));
}

/** 触发浏览器下载（唯一碰 DOM 的函数，其余都是纯函数） */
export function downloadBytes(
  bytes: Uint8Array,
  fileName: string,
  mime = 'application/zip',
): void {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  // 下载链接是瞬时的：给浏览器留出触发时间后立刻释放（与导出面板同纪律）
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * 下载一段文本（V2.20 / 台账 B65 画布配方包）。
 *
 * 与 `downloadBytes` 同一纪律（唯一碰 DOM 的地方），但走 `application/json` ——
 * 有些浏览器/系统会按 MIME 决定"用什么打开"，配方包被当成 zip 打开会莫名其妙。
 */
export function downloadText(text: string, fileName: string, mime = 'application/json'): void {
  downloadBytes(new TextEncoder().encode(text), fileName, mime);
}
