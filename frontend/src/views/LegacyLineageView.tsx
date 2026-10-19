import { useTranslate } from '../lib/i18n';
import { navigate } from '../lib/router';

/**
 * 旧只读血缘图的下线页（Step 11-S3 片 B4）。
 *
 * 为什么保留一个页面而不是直接 404：`#/lineage` 曾是画布的一等入口，旧书签/旧会话链接
 * 打进来时应该看到"它去哪了"，而不是"未知视图"。**不自动跳转**：跳转会让用户来不及读，
 * 也会污染浏览器的前进/后退栈。
 */
export function LegacyLineageView() {
  const t = useTranslate();

  return (
    <section className="wb-page">
      <div className="cs-empty">
        <p className="cs-empty-title">{t('canvas.legacy.title')}</p>
        <p className="wb-note">{t('canvas.legacy.body')}</p>
        <button
          type="button"
          className="wb-btn wb-btn-primary"
          onClick={() => navigate('#/canvas')}
        >
          {t('canvas.legacy.action')}
        </button>
      </div>
    </section>
  );
}
