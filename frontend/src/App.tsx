import React, { useEffect, useState } from 'react';
import type { HealthResponse, ProviderStatus } from '@astrmira/shared';

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 工作台基础状态
  const [prompt, setPrompt] = useState('竖屏短剧，女孩站在雨夜街头微笑着说："我们终于成功了！"，电影感光影');
  const [selectedEngine, setSelectedEngine] = useState<'cloud' | 'local'>('cloud');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');

  useEffect(() => {
    // 检查后端探针 AC1
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: HealthResponse) => {
        setHealth(data);
        setError(null);
      })
      .catch((err) => {
        console.error('后端连接失败:', err);
        setError('后端服务未连通 (请确保 Fastify 启动于 3000 端口)');
      });

    // 检查算力探针
    fetch('/api/providers/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ProviderStatus | null) => {
        if (data) {
          setProviders(data);
          // 连带修复（Step 1.5 / T5-6，见 PLAN §5）：T1 起 local 恒为 available:false，
          // 该分支成为真实可达路径——
          // 探针判定本地不可用时必须回退 'cloud'，否则按钮已置灰而引擎状态仍停在 'local'。
          setSelectedEngine(
            data.local.available && data.defaultProvider === 'local-minimax-h3' ? 'local' : 'cloud',
          );
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div style={styles.container}>
      {/* 顶部导航栏 */}
      <header style={styles.header}>
        <div style={styles.brand}>
          <span style={styles.brandIcon}>✧</span>
          <h1 style={styles.brandTitle}>AstrmiraVideo</h1>
          <span style={styles.brandTag}>Step 1 骨架</span>
        </div>

        <div style={styles.headerRight}>
          {health ? (
            <div style={styles.statusBadgeSuccess}>
              <span style={styles.statusDotGreen}></span>
              <span>服务在线 (v{health.version})</span>
            </div>
          ) : error ? (
            <div style={styles.statusBadgeError}>
              <span style={styles.statusDotRed}></span>
              <span>{error}</span>
            </div>
          ) : (
            <div style={styles.statusBadgeWaiting}>
              <span>探测中...</span>
            </div>
          )}

          {providers?.local?.available && (
            <div style={styles.gpuBadge}>
              <span>GPU: {providers.local.gpuName} (Tier {providers.local.tier})</span>
            </div>
          )}
        </div>
      </header>

      {/* 主工作台布局 (3 栏自适应) */}
      <main style={styles.mainLayout}>
        {/* 左栏：参数与控制区 */}
        <section style={styles.leftColumn}>
          <div style={styles.panelTitle}>
            <span>✦ 创作输入</span>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>
              <span>提示词 (Prompt)</span>
              <button style={styles.enhanceBtn} title="提示词扩写助手 (Step 2 接入)">
                ✨ 润色
              </button>
            </label>
            <textarea
              style={styles.textarea}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="输入镜头运动、主体对白（引号内）或画面氛围..."
            />
            <div style={styles.hintText}>
              台词长度建议 ≤ 20 字，完美匹配 5 秒镜头
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>参考资产 (Reference Assets)</label>
            <div style={styles.dropZone}>
              <span style={styles.dropIcon}>🖼️</span>
              <span style={styles.dropText}>拖拽首帧参考图 (Smart 32x 裁切)</span>
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>执行引擎 (Engine)</label>
            <div style={styles.segmentedControl}>
              <button
                style={{
                  ...styles.segmentBtn,
                  ...(selectedEngine === 'cloud' ? styles.segmentBtnActive : {}),
                }}
                onClick={() => setSelectedEngine('cloud')}
              >
                云端 Seedance (BYOK)
              </button>
              <button
                style={{
                  ...styles.segmentBtn,
                  ...(selectedEngine === 'local' ? styles.segmentBtnActive : {}),
                  ...(!providers?.local?.available ? styles.segmentBtnDisabled : {}),
                }}
                onClick={() => providers?.local?.available && setSelectedEngine('local')}
                disabled={!providers?.local?.available}
              >
                本地 MiniMax H3
              </button>
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>画幅比例 (Aspect Ratio)</label>
            <div style={styles.ratioGroup}>
              <button
                style={{
                  ...styles.ratioBtn,
                  ...(aspectRatio === '16:9' ? styles.ratioBtnActive : {}),
                }}
                onClick={() => setAspectRatio('16:9')}
              >
                16:9 横屏 (832×480)
              </button>
              <button
                style={{
                  ...styles.ratioBtn,
                  ...(aspectRatio === '9:16' ? styles.ratioBtnActive : {}),
                }}
                onClick={() => setAspectRatio('9:16')}
              >
                9:16 竖屏 (480×832)
              </button>
            </div>
          </div>

          <button style={styles.submitBtn}>
            立即生成视频 (Generate)
          </button>
        </section>

        {/* 中栏：中央视窗播放器 */}
        <section style={styles.centerColumn}>
          <div style={styles.viewportHeader}>
            <span style={styles.panelTitle}>✦ 实时视窗 (Viewport)</span>
            <span style={styles.viewportRatio}>{aspectRatio} 渲染模式</span>
          </div>

          <div style={styles.playerContainer}>
            <div style={styles.playerCanvas}>
              <div style={styles.cosmicGlow}></div>
              <div style={styles.emptyState}>
                <span style={styles.emptyStateIcon}>✧</span>
                <p style={styles.emptyStateTitle}>等待生成任务下发</p>
                <p style={styles.emptyStateDesc}>
                  配置左侧提示词与参考图后，点击【立即生成视频】
                </p>
              </div>
            </div>

            {/* 底部传输栏 */}
            <div style={styles.transportBar}>
              <div style={styles.transportControls}>
                <button style={styles.transportBtn} disabled>▶</button>
                <span style={styles.timecode}>00:00 / 00:05</span>
              </div>
              <button style={styles.downloadBtn} disabled>
                下载 MP4
              </button>
            </div>
          </div>
        </section>

        {/* 右栏：任务队列与历史画廊 */}
        <section style={styles.rightColumn}>
          <div style={styles.panelTitle}>
            <span>✦ 历史画廊 (Gallery)</span>
          </div>
          <div style={styles.galleryPlaceholder}>
            <span style={styles.emptyGalleryIcon}>🎞️</span>
            <p style={styles.emptyGalleryText}>暂无历史成片</p>
            <p style={styles.emptyGallerySub}>生成后的成片将在此处沉淀，支持参数一键回填</p>
          </div>
        </section>
      </main>

      {/* 底部信息栏 */}
      <footer style={styles.footer}>
        <span>AstrmiraVideo V8.0 · 纯 CSS Tokens 美学基底 · 响应式视口适配</span>
        <span>后端协议: Fastify REST / SQLite 持久化</span>
      </footer>
    </div>
  );
}

/**
 * eyebrow 标签体系（P1-6 / T5）：参考稿最具辨识度的元素——全大写 + 极小字 + 大字母间距。
 * 字号与字距一律取自 tokens.css（--fs-eyebrow / --track-caps），禁止硬编码；
 * 字体走 --serif-caps（碑体仅在这种全大写场景成立）。
 */
const eyebrowStyle: React.CSSProperties = {
  fontFamily: 'var(--serif-caps)',
  fontSize: 'var(--fs-eyebrow)',
  fontWeight: 500,
  letterSpacing: 'var(--track-caps)',
  textTransform: 'uppercase',
  color: 'var(--faint)',
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
  },
  header: {
    height: '64px',
    padding: '0 24px',
    borderBottom: '1px solid var(--line)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'var(--panel-glass)',
    backdropFilter: 'blur(12px)',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  brandIcon: {
    color: 'var(--gold)',
    fontSize: '20px',
    animation: 'mira-breathe 6s infinite ease-in-out',
  },
  brandTitle: {
    fontFamily: 'var(--serif)',
    fontSize: '20px',
    fontWeight: 700,
    letterSpacing: '-0.5px',
    color: 'var(--text)',
  },
  brandTag: {
    ...eyebrowStyle,
    padding: '2px 8px',
    borderRadius: '12px',
    border: '1px solid var(--line-gold)',
    color: 'var(--gold)',
    backgroundColor: 'rgba(214, 184, 129, 0.08)',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  statusBadgeSuccess: {
    ...eyebrowStyle,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: 'var(--text)',
    padding: '4px 10px',
    borderRadius: '20px',
    border: '1px solid rgba(145, 185, 213, 0.3)',
    backgroundColor: 'rgba(145, 185, 213, 0.08)',
  },
  statusBadgeError: {
    ...eyebrowStyle,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: 'var(--danger)',
    padding: '4px 10px',
    borderRadius: '20px',
    border: '1px solid rgba(248, 113, 113, 0.3)',
    backgroundColor: 'rgba(248, 113, 113, 0.08)',
  },
  statusBadgeWaiting: {
    ...eyebrowStyle,
    color: 'var(--muted)',
  },
  statusDotGreen: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: 'var(--success)',
    boxShadow: '0 0 8px var(--success)',
  },
  statusDotRed: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: 'var(--danger)',
  },
  gpuBadge: {
    ...eyebrowStyle,
    color: 'var(--gold)',
    padding: '4px 10px',
    borderRadius: '20px',
    border: '1px solid var(--line-gold)',
    backgroundColor: 'rgba(214, 184, 129, 0.08)',
  },
  mainLayout: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: 'minmax(320px, 380px) 1fr minmax(280px, 340px)',
    gap: '20px',
    padding: '20px 24px',
    maxWidth: '1800px',
    margin: '0 auto',
    width: '100%',
  },
  panelTitle: {
    ...eyebrowStyle,
    fontWeight: 600,
    color: 'var(--gold)',
    marginBottom: '16px',
    display: 'block',
  },
  leftColumn: {
    backgroundColor: 'var(--panel)',
    borderRadius: 'var(--radius-surface)',
    border: '1px solid var(--line)',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--muted)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  enhanceBtn: {
    fontSize: '12px',
    color: 'var(--gold)',
    border: '1px solid var(--line-gold)',
    padding: '2px 8px',
    borderRadius: '6px',
    backgroundColor: 'rgba(214, 184, 129, 0.1)',
  },
  textarea: {
    width: '100%',
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--line)',
    borderRadius: 'var(--radius-control)',
    color: 'var(--text)',
    padding: '12px',
    fontSize: '13px',
    lineHeight: '1.6',
    resize: 'none',
    outline: 'none',
  },
  hintText: {
    fontSize: '11px',
    color: 'var(--faint)',
  },
  dropZone: {
    border: '1px dashed var(--line-gold)',
    borderRadius: 'var(--radius-control)',
    padding: '24px 16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    backgroundColor: 'rgba(214, 184, 129, 0.02)',
    cursor: 'pointer',
  },
  dropIcon: {
    fontSize: '24px',
  },
  dropText: {
    fontSize: '12px',
    color: 'var(--muted)',
  },
  segmentedControl: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    backgroundColor: 'var(--panel2)',
    borderRadius: 'var(--radius-control)',
    padding: '4px',
    gap: '4px',
    border: '1px solid var(--line)',
  },
  segmentBtn: {
    padding: '8px 12px',
    fontSize: '12px',
    borderRadius: '6px',
    color: 'var(--muted)',
    transition: 'all 0.2s var(--ease-ui)',
  },
  segmentBtnActive: {
    backgroundColor: 'var(--action-fill)',
    color: 'var(--on-segment)',
    fontWeight: 600,
  },
  segmentBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  ratioGroup: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px',
  },
  ratioBtn: {
    padding: '8px',
    fontSize: '12px',
    border: '1px solid var(--line)',
    borderRadius: 'var(--radius-control)',
    color: 'var(--muted)',
    backgroundColor: 'var(--panel2)',
  },
  ratioBtnActive: {
    borderColor: 'var(--gold)',
    color: 'var(--gold)',
    backgroundColor: 'rgba(214, 184, 129, 0.08)',
  },
  submitBtn: {
    marginTop: 'auto',
    backgroundColor: 'var(--action-fill)',
    color: 'var(--on-action)',
    fontWeight: 600,
    fontSize: '14px',
    padding: '12px',
    borderRadius: 'var(--radius-control)',
    border: 'none',
    boxShadow: '0 4px 14px rgba(214, 184, 129, 0.2)',
  },
  centerColumn: {
    backgroundColor: 'var(--panel)',
    borderRadius: 'var(--radius-surface)',
    border: '1px solid var(--line)',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
  },
  viewportHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  viewportRatio: {
    ...eyebrowStyle,
    color: 'var(--muted)',
  },
  playerContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--canvas)',
    borderRadius: 'var(--radius-control)',
    border: '1px solid var(--line)',
    overflow: 'hidden',
  },
  playerCanvas: {
    flex: 1,
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '400px',
  },
  cosmicGlow: {
    position: 'absolute',
    width: '260px',
    height: '260px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(214, 184, 129, 0.08) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    zIndex: 1,
  },
  emptyStateIcon: {
    fontSize: '32px',
    color: 'var(--gold)',
    marginBottom: '8px',
    animation: 'star-gather 18s infinite',
  },
  emptyStateTitle: {
    fontSize: '15px',
    fontFamily: 'var(--serif)',
    color: 'var(--text)',
  },
  emptyStateDesc: {
    fontSize: '12px',
    color: 'var(--faint)',
  },
  transportBar: {
    height: '52px',
    backgroundColor: 'var(--panel2)',
    borderTop: '1px solid var(--line)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
  },
  transportControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  transportBtn: {
    color: 'var(--gold)',
    fontSize: '14px',
  },
  timecode: {
    fontFamily: 'var(--mono)',
    fontSize: '12px',
    color: 'var(--muted)',
  },
  downloadBtn: {
    fontSize: '12px',
    color: 'var(--muted)',
    border: '1px solid var(--line)',
    padding: '4px 10px',
    borderRadius: '6px',
  },
  rightColumn: {
    backgroundColor: 'var(--panel)',
    borderRadius: 'var(--radius-surface)',
    border: '1px solid var(--line)',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
  },
  galleryPlaceholder: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    textAlign: 'center',
    padding: '0 20px',
  },
  emptyGalleryIcon: {
    fontSize: '32px',
    marginBottom: '8px',
    opacity: 0.5,
  },
  emptyGalleryText: {
    fontSize: '14px',
    color: 'var(--muted)',
  },
  emptyGallerySub: {
    fontSize: '11px',
    color: 'var(--faint)',
    lineHeight: '1.5',
  },
  footer: {
    height: '40px',
    borderTop: '1px solid var(--line)',
    padding: '0 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: 'var(--faint)',
    backgroundColor: 'var(--bg)',
  },
};
