/**
 * 音频自动落轨的**排布计算**（V2.106）—— 纯函数，不碰 store、不碰 DOM。
 *
 * 从 `AudioPanel` 里抽出来只有一个理由：**这段规则要能被断言**。
 * 面板里原来那版"放一条、裁一下"在"配乐比片子短"时会让后半段是哑的，
 * 而这种错在界面上看不出来（导出后才发现最后 10 秒没声音）。
 *
 * ## 三条规则
 * 1. **人声只放一次**：重复念同一句没有意义；超出片长就从右边裁。
 * 2. **配乐/音效循环铺满**：生成 30s、片子 90s → 铺 3 段首尾相接。
 *    段与段之间**不淡**（否则每 30 秒掉一次音量，听感像断了），只有首段淡入、末段淡出；
 *    最后一段按剩余长度裁齐。
 * 3. **音量**：配乐/音效 `AUDIO_BED_VOLUME`（垫底），配音 1.0 ——
 *    依据是 Stable Audio 的产物峰值实测 −0.0 ~ −2.3dB（几乎满刻度），和旁白一起按 1.0 混会削波。
 */

/** 淡入上限（帧）：8 帧 @30fps ≈ 0.27s，够盖住起播的爆音又不显得"渐强" */
export const AUDIO_FADE_IN_MAX = 8;
/** 淡出上限（帧）：15 帧 ≈ 0.5s，收尾更自然 */
export const AUDIO_FADE_OUT_MAX = 15;
/** 配乐/音效垫底时的默认音量 */
export const AUDIO_BED_VOLUME = 0.35;

export interface AudioPlacementSegment {
  /** 这一段落在工程第几帧 */
  atFrame: number;
  /** 这一段最终占多少帧（末段可能被裁短） */
  frames: number;
  fadeInFrames: number;
  fadeOutFrames: number;
}

export interface AudioPlacement {
  segments: AudioPlacementSegment[];
  /** 被音频覆盖到的总帧数（封顶 = 片长） */
  coveredFrames: number;
  volume: number;
}

/**
 * 算出"这段音频该怎么摆在时间轴上"。
 *
 * @param filmFrames 片子长度（帧）；≤0 时返回空排布（没片子就别放声音）
 * @param durationFrames 音频自身长度（帧）；≤0 时返回空排布
 * @param isBed true = 配乐/音效（循环 + 0.35 音量），false = 人声（只放一次 + 1.0）
 */
export function planAudioPlacement(
  filmFrames: number,
  durationFrames: number,
  isBed: boolean,
): AudioPlacement {
  if (filmFrames <= 0 || durationFrames <= 0) {
    return { segments: [], coveredFrames: 0, volume: isBed ? AUDIO_BED_VOLUME : 1 };
  }

  const volume = isBed ? AUDIO_BED_VOLUME : 1;
  const repeats = isBed ? Math.max(1, Math.ceil(filmFrames / durationFrames)) : 1;
  const segments: AudioPlacementSegment[] = [];
  let covered = 0;

  for (let index = 0; index < repeats; index += 1) {
    const atFrame = index * durationFrames;
    if (atFrame >= filmFrames) break;
    const frames = Math.min(durationFrames, filmFrames - atFrame);
    if (frames <= 0) break;

    const isFirst = index === 0;
    const isLast = atFrame + frames >= filmFrames;
    segments.push({
      atFrame,
      frames,
      fadeInFrames: isFirst ? Math.min(AUDIO_FADE_IN_MAX, Math.floor(frames / 4)) : 0,
      fadeOutFrames: isLast ? Math.min(AUDIO_FADE_OUT_MAX, Math.floor(frames / 3)) : 0,
    });
    covered = atFrame + frames;
    if (covered >= filmFrames) break;
  }

  return { segments, coveredFrames: covered, volume };
}
