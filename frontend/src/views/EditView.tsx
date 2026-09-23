import { PlaceholderView } from './PlaceholderView';

/**
 * 剪辑台（V9 · B9 填）：独立视图 `#/edit`，源片经 `?task=<id>` 传入。
 *
 * 形态由用户在 B1 闸门拍板（2026-09-23）："更彻底的独立界面"——不进侧栏，
 * 从视频库卡片 / 详情抽屉的 ✂ 进入；无源片时显示空态引导。
 */
export function EditView() {
  return (
    <PlaceholderView
      title="剪辑台"
      eyebrow="Editing Desk"
      until="此视图在 B9 上线：对已有成片做时间轴上的确定性操作（裁剪 / 拼接 / 转场 / 静音·音量 / 变速 / 抽帧），本地 ffmpeg 执行、并发 1、零上游调用（不花钱、不占冷却）。抽帧产物可直接落为参考资产，接回 I2V / FL2V 闭环。"
    />
  );
}
