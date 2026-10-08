import { Eyebrow } from '../components/Eyebrow';
import { navigate } from '../lib/router';
import { DEFAULT_VIEW } from './registry';

/**
 * 未知视图兜底（V9 · B2 的破坏性验证对象）。
 *
 * 为什么**不静默重定向**到默认视图：用户把一个 hash 输错时，"悄悄跳到工作台"会让他以为
 * 自己点错了或者页面坏了；如实说"这个视图不存在"才便于发现是**注册表漏了**（开发期）
 * 或**书签过期**（用户侧）。B2 的破坏性验证（删掉一个注册项 → 访问该 hash 必须落到这里）
 * 就是靠这个组件兜底。
 */
export function UnknownView({ hash }: { hash: string }) {
  return (
    <section className="wb-page wb-unknown">
      <Eyebrow tone="gold">Unknown View</Eyebrow>
      <h1 className="wb-page-title">这个视图不存在</h1>
      <p className="wb-note">
        地址栏里的 <code>{hash || '#/'}</code> 不在视图注册表里。
        <br />
        它没有被静默重定向——因为"悄悄跳到别处"会让人以为自己点错了。
      </p>
      <button type="button" className="wb-btn wb-btn-gold" onClick={() => navigate(DEFAULT_VIEW)}>
        回到首页
      </button>
    </section>
  );
}
