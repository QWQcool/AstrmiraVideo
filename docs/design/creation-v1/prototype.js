/* Standalone design artifact. No application API, credentials or paid provider calls. */
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const state = { page: 'home', mode: 'video', refs: [], selected: 'image', zoom: 1, panX: 0, panY: 0, task: 'idle', filter: 'all', nextNode: 1 };
const storageKey = 'astrmira-design-v1-draft';
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3200); }
function save() {
  try { localStorage.setItem(storageKey, JSON.stringify({ home: $('#home-prompt').value, canvas: $('#canvas-prompt').value, refs: state.refs.filter(r => !r.src?.startsWith('blob:')).map(r => r.id), positions: $$('.media-node').filter(n => ['note','reference','image','video'].includes(n.dataset.node)).map(n => [n.dataset.node,n.style.left,n.style.top]) })); $('#save-status').textContent = '原型草稿已保存到本机'; }
  catch { $('#save-status').textContent = '本机保存不可用'; }
}
function navigate(page, updateHash = true) {
  state.page = ['home','works','canvas'].includes(page) ? page : 'home';
  $$('.page').forEach(p => { p.hidden = p.id !== state.page; });
  $$('nav [data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === state.page));
  $('#breadcrumb').textContent = {home:'创作空间', works:'作品与素材', canvas:'画布 / 客厅灯光广告'}[state.page];
  if (updateHash) history.replaceState(null,'','#'+state.page);
  if (state.page === 'canvas') { fit(); renderEdges(); }
  window.scrollTo(0,0);
}
function mode(value) {
  state.mode = value;
  $$('[data-mode]').forEach(b => b.classList.toggle('active',b.dataset.mode === value));
  $$('.model-button').forEach(b => { b.textContent = value === 'image' ? '图像模型 · 待配置 ⌄' : 'Seedance · 云端 ⌄'; });
  $$('.model-warning').forEach(p => { p.hidden = value !== 'image'; });
  $$('[data-submit]').forEach(b => { b.disabled = value === 'image'; b.title = value === 'image' ? '请先配置并验证图像模型' : '演示任务状态，不会提交真实生成'; });
  $$('.duration').forEach(s => { s.hidden = value === 'image'; });
  const resolution = $('select[aria-label="清晰度"]');
  resolution.disabled = value === 'image';
  resolution.replaceChildren(...(value === 'image' ? ['尺寸待配置'] : ['720p','480p','1080p']).map(text => new Option(text,text)));
  $('.cost').textContent = value === 'image' ? '模型待配置' : '费用待核算';
}
function renderRefs() {
  for (const list of $$('.reference-list')) {
    list.replaceChildren();
    for (const ref of state.refs) {
      const chip = document.createElement('span'); chip.className = 'reference-chip';
      const img = document.createElement('img'); img.src = ref.src || 'scene.png'; img.alt = '';
      const text = document.createElement('span'); text.textContent = ref.name + ' · 首帧';
      const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label','移除参考 '+ref.name); remove.onclick = () => { state.refs = state.refs.filter(r => r.id !== ref.id); renderRefs(); save(); };
      chip.append(img,text,remove); list.append(chip);
    }
  }
}
function addReference(id = 'scene', name = '客厅空间', src = 'scene.png') {
  if (state.refs.some(r => r.id === id)) return toast('这张图片已作为参考');
  // V1 prototype uses the currently available single first-frame contract.
  if (state.refs.length) return toast('此原型使用单首帧模式，请先移除现有参考。正式产品按模型能力限制。');
  state.refs.push({id,name,src}); renderRefs(); save(); toast('已添加为首帧参考');
}
function openDialog(title, html) { $('#dialog-title').textContent = title; $('#dialog-body').innerHTML = html; if (!$('#dialog').open) $('#dialog').showModal(); }
const dialogs = {
  assets: () => openDialog('选择参考素材', '<p class="dialog-copy">选择图片作为首帧。正式产品按模型能力开放首尾帧、多图或视频参考，并明确标注各素材用途。</p><div class="asset-choice"><img src="scene.png" alt="客厅空间"><div>客厅空间<small>图片 · 设计示例素材</small></div><button id="choose-scene">选择</button></div><div class="dialog-actions"><button id="upload-dialog">本地上传</button></div>'),
  model: () => state.mode === 'image' ? openDialog('图像模型 · 待配置','<span class="pill">等待部署者接入</span><div class="dialog-copy"><p style="margin-top:18px">先保留提示词和素材。部署时选择模型与适配器、验证连接及能力后，再开放图片生成。</p><ul><li>模型名称与标识、服务地址或 ComfyUI 工作流</li><li>支持的操作：文生图 / 参考图生图 / 局部编辑等</li><li>参考图数量、画幅、尺寸、输出格式与费用规则</li></ul><p>填入模型名称并不等于完成适配。此设计原型不保存配置，也不会发送请求。</p></div><div class="dialog-actions"><button data-dialog="settings">查看设置结构</button></div>') : openDialog('视频模型','<div class="asset-choice"><div>Seedance · 云端<small>界面示例；实际可用性取决于部署配置与凭据</small></div><span class="pill">示例选择</span></div><div class="dialog-copy"><p style="margin-top:18px">正式界面同时支持已配置的本地 ComfyUI 视频模型。参数与参考素材限制跟随当前模型；不会默默丢弃不兼容素材。</p></div>'),
  settings: () => openDialog('管理与设置','<div class="dialog-copy"><p>创作区保留内容与常用参数，专业管理能力收在这里。</p></div><div class="dialog-actions"><button data-dialog="model">模型与连接</button><button data-info="专业工作台保留独立入口，复杂参数继续可用。">专业工作台</button><button data-info="复用现有成本台账，未知价格显示待核算。">成本与用量</button><button data-info="复用操作日志与错误详情。">操作日志</button><button data-info="保留项目设置、备份与恢复。">项目与备份</button></div><hr><p class="dialog-copy">图像模型配置字段为接入规划；不会在本原型中安装或调用任何模型。</p><div class="provider-fields"><label>图像模型<input disabled placeholder="待选择模型"></label><label>提供方 / 适配器<input disabled placeholder="部署时配置并验证"></label></div>'),
  recipes: () => openDialog('配方 · 从一个起手式开始','<div class="dialog-copy"><p>配方填入镜头描述，行业模板填入内容结构。套用不自动生成。</p></div><div class="dialog-actions"><button data-recipe="运镜">缓慢推进</button><button data-recipe="光线">傍晚柔光</button><button data-recipe="产品展示">灯具细节</button><button data-recipe="分镜起手式">空间 → 产品 → 氛围</button></div>'),
  'image-tools': () => openDialog('图像编辑','<span class="pill">待接入支持相应能力的模型</span><div class="dialog-copy"><p style="margin-top:18px">局部修改、扩图、抠图、高清和多角度分别检查能力。当前没有配置可用图像编辑模型，不会提交任务。</p></div><div class="dialog-actions"><button disabled>局部修改</button><button disabled>扩图</button><button disabled>智能高清</button><button data-dialog="model" id="image-model-link">查看模型要求</button></div>'),
  'asset-detail': () => openDialog('客厅空间参考','<img class="detail-image" src="scene.png" alt="客厅空间"><div class="dialog-actions"><button id="detail-ref">作为参考</button><button id="detail-canvas">放入画布</button><a href="scene.png" download="astrmira-design-scene.png">下载示例图</a></div>'),
  'video-detail': () => openDialog('客厅推进 · 视频状态示意','<img class="detail-image" src="scene.png" alt="示例封面"><p class="dialog-copy" style="margin-top:15px">这是设计原型中的视频卡片，无真实视频文件。正式产品在任务成功后播放实际产物。</p><div class="dialog-actions"><button data-page="canvas">打开所在画布</button></div>'),
  help: () => openDialog('交互稿使用说明','<div class="dialog-copy"><p>这是后续开发的设计基准，所有任务状态均为演示，不连接生产服务。</p><ul><li>首页：视频 / 图片切换、@ 素材引用、配方、状态演示</li><li>作品：搜索、筛选、详情、作为参考</li><li>画布：选中、拖动、平移缩放、右键菜单、添加备注</li><li>图片模式：未配置模型时禁用生成，提示词保留</li><li>Esc 关闭弹窗；Ctrl / ⌘ + Enter 演示提交</li></ul><p>提示词、参考选择和初始节点位置保存在浏览器本机。新增节点与上传仅在当前页面会话中保留。更多细节以设计规格为准。</p></div><div class="dialog-actions"><button id="reset-prototype">重置原型草稿</button></div>')
};
document.addEventListener('click', event => {
  const b = event.target.closest('button'); if (!b) return;
  if (b.dataset.page) { $('#dialog').close(); navigate(b.dataset.page); }
  if (b.dataset.mode) mode(b.dataset.mode);
  if (b.dataset.dialog) { if (b.id === 'image-model-link') mode('image'); dialogs[b.dataset.dialog]?.(); }
  if (b.dataset.info) toast(b.dataset.info);
  if (b.dataset.recipe) {
    const input = $(state.page === 'canvas' ? '#canvas-prompt' : '#home-prompt');
    const snippets = {运镜:'镜头缓缓推进，稳定平滑，保持主体居中。',光线:'傍晚蓝调窗景与室内柔和暖光形成自然对比。',产品展示:'突出环形灯具的材质与光晕，保持产品造型一致。',分镜起手式:'空间全景建立氛围，随后推进产品细节，最后回到温暖的生活场景。'};
    input.value += '\n' + snippets[b.dataset.recipe]; $('#dialog').close(); if (state.page === 'works') navigate('home'); save(); toast('已加入起手式，可继续修改');
  }
  if (b.hasAttribute('data-submit')) submit();
  if (b.id === 'choose-scene') { addReference(); $('#dialog').close(); }
  if (b.id === 'detail-ref') { addReference(); $('#dialog').close(); navigate('home'); }
  if (b.id === 'detail-canvas') { $('#dialog').close(); navigate('canvas'); selectNode('reference'); }
  if (b.id === 'upload-dialog' || b.id === 'local-upload') $('#file-input').click();
  if (b.id === 'reset-prototype') { try { localStorage.removeItem(storageKey); } catch {} location.reload(); }
  if (b.dataset.add) {
    $('#add-menu').hidden = true; $('#add-menu-toggle').setAttribute('aria-expanded','false');
    if (b.dataset.add === 'text') addNode('text'); else dialogs.assets();
  }
  if (b.dataset.filter) { state.filter = b.dataset.filter; $$('[data-filter]').forEach(x => x.classList.toggle('active',x === b)); filterWorks(); }
});
$('#close-dialog').onclick = () => $('#dialog').close();
$('#dialog').addEventListener('click', e => { if (e.target === $('#dialog')) { const r = $('#dialog').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('#dialog').close(); } });
$$('textarea').forEach(input => { input.addEventListener('input',save); input.addEventListener('keyup',e => { if (e.key === '@') dialogs.assets(); }); });
function submit() {
  if (state.mode === 'image') return toast('图像模型待配置，草稿已保留');
  const input = $(state.page === 'canvas' ? '#canvas-prompt' : '#home-prompt');
  if (!input.value.trim()) return toast('先描述你想创作的画面');
  if (state.page === 'canvas') $('#home-prompt').value = input.value;
  state.task = 'running'; save(); navigate('home'); $('#task-result').hidden = false; $('#task-title').textContent = '生成中 · 状态演示'; $('#task-description').textContent = '本原型没有提交真实任务，也不会产生费用。请选择完成或失败状态进行查看。';
  $('#task-next').hidden = false; $('#task-next').textContent = '演示完成状态'; $('#task-fail').hidden = false; $('#task-cancel').hidden = false; $('#task-canvas').hidden = true;
}
$('#task-next').onclick = () => { if (state.task === 'failed') return submit(); state.task = 'succeeded'; $('#task-title').textContent = '已完成 · 状态演示'; $('#task-description').textContent = '正式产品将在此展示真实产物、使用参数与费用状态，可继续引用或放入画布。'; $('#task-next').hidden = true; $('#task-fail').hidden = true; $('#task-cancel').hidden = true; $('#task-canvas').hidden = false; };
$('#task-fail').onclick = () => { state.task = 'failed'; $('#task-title').textContent = '生成失败 · 状态演示'; $('#task-description').textContent = '示例原因：服务暂时不可用。提示词与素材保留；重试会创建新的执行。'; $('#task-next').textContent = '重试演示'; $('#task-fail').hidden = true; $('#task-cancel').hidden = true; };
$('#task-cancel').onclick = () => { state.task = 'cancelled'; $('#task-title').textContent = '已取消 · 状态演示'; $('#task-description').textContent = '草稿仍保留。正式产品按服务端返回状态确认是否已取消。'; $$('.result-actions button').forEach(b => { b.hidden = true; }); };
function filterWorks() { let count = 0; $$('#works-grid .work-card').forEach(card => { card.hidden = !((state.filter === 'all' || card.dataset.type === state.filter) && card.dataset.name.includes($('#work-search').value.trim())); if (!card.hidden) count++; }); $('#no-results').hidden = count !== 0; }
$('#work-search').oninput = filterWorks;
function selectNode(id) { state.selected = id; $$('.media-node').forEach(n => n.classList.toggle('selected',n.dataset.node === id)); const node = $(`[data-node="${id}"]`); $('#node-toolbar').hidden = !node; if (!node) return; $('#selected-name').textContent = node.querySelector('header').textContent.replace('⋯','').trim(); $('#use-reference').disabled = !node.querySelector('img') || id === 'video'; $('#node-video').disabled = $('#use-reference').disabled; }
$('#use-reference').onclick = () => addReference(state.selected,'选中图片',$(`[data-node="${state.selected}"] img`)?.src);
$('#node-video').onclick = () => { addReference(state.selected,'选中图片',$(`[data-node="${state.selected}"] img`)?.src); mode('video'); $('#canvas-prompt').focus(); };
$('#remove-node').onclick = () => { const n = $(`[data-node="${state.selected}"]`); if (n) { n.remove(); selectNode(null); renderEdges(); toast('已从原型画布移除，原作品不受影响；刷新恢复初始节点'); } };
function renderEdges() { for (const [path,a,b] of [['edge-a','reference','image'],['edge-b','image','video']]) { const n1 = $(`[data-node="${a}"]`),n2 = $(`[data-node="${b}"]`); if (!n1 || !n2) { $('#'+path).setAttribute('d',''); continue; } const x1 = parseFloat(n1.style.left)+n1.offsetWidth,y1 = parseFloat(n1.style.top)+115,x2 = parseFloat(n2.style.left),y2 = parseFloat(n2.style.top)+115; $('#'+path).setAttribute('d',`M ${x1} ${y1} C ${x1+60} ${y1},${x2-60} ${y2},${x2} ${y2}`); } }
function transform() { $('#canvas-world').style.transform = `translate(${state.panX}px,${state.panY}px) scale(${state.zoom})`; $('#zoom-label').textContent = Math.round(state.zoom*100)+'%'; }
function fit() { state.zoom = Math.min(1,($('#canvas-viewport').clientWidth-40)/1130); state.panX = 15; state.panY = 0; transform(); }
$('#fit-canvas').onclick = fit;
$('#zoom-in').onclick = () => { state.zoom = Math.min(1.6,state.zoom+.1); transform(); };
$('#zoom-out').onclick = () => { state.zoom = Math.max(.3,state.zoom-.1); transform(); };
$('#add-menu-toggle').onclick = () => { $('#add-menu').hidden = !$('#add-menu').hidden; $('#add-menu-toggle').setAttribute('aria-expanded',String(!$('#add-menu').hidden)); };
$('#canvas-viewport').oncontextmenu = e => { e.preventDefault(); $('#add-menu').hidden = false; $('#add-menu-toggle').setAttribute('aria-expanded','true'); };
let drag;
$('#canvas-viewport').addEventListener('pointerdown', e => { if (e.button !== 0 || e.target.closest('[contenteditable]')) return; const node = e.target.closest('.media-node'); if (node) selectNode(node.dataset.node); else selectNode(null); drag = {node,x:e.clientX,y:e.clientY,left:node ? parseFloat(node.style.left) : state.panX,top:node ? parseFloat(node.style.top) : state.panY}; $('#canvas-viewport').setPointerCapture(e.pointerId); });
$('#canvas-viewport').addEventListener('pointermove', e => { if (!drag) return; const dx=e.clientX-drag.x,dy=e.clientY-drag.y; if (drag.node) { drag.node.style.left=drag.left+dx/state.zoom+'px'; drag.node.style.top=drag.top+dy/state.zoom+'px'; renderEdges(); } else { state.panX=drag.left+dx; state.panY=drag.top+dy; transform(); } });
$('#canvas-viewport').addEventListener('pointerup', () => { if (drag) save(); drag = null; });
$('#canvas-viewport').addEventListener('pointercancel', () => { drag = null; });
$('#canvas-viewport').addEventListener('keydown', e => { const node=e.target.closest('.media-node'); if (node && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectNode(node.dataset.node); } });
function addNode(type, url, filename) { const n=document.createElement('article'); n.className='media-node'; n.dataset.node='added-'+state.nextNode++; n.tabIndex=0; n.style.left=300+state.nextNode*18+'px'; n.style.top=100+state.nextNode*15+'px'; const h=document.createElement('header'); h.textContent=filename || '新建备注'; n.append(h); if (type === 'text') { n.classList.add('note-node'); const p=document.createElement('p'); p.contentEditable='true'; p.textContent='在这里记录创作想法…'; n.append(p); } else { const media=document.createElement(type); media.src=url; if (type !== 'img') media.controls=true; media.style.width='100%'; media.alt=filename || ''; n.append(media); } $('#canvas-world').append(n); selectNode(n.dataset.node); toast('已添加到原型画布，仅本页会话保留'); }
$('#file-input').onchange = e => { const file=e.target.files?.[0]; if (!file) return; const type=file.type.startsWith('image/')?'img':file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':null; if (!type) return toast('请选择图片、视频或音频'); if (file.size>50*1024*1024) return toast('原型预览文件上限为 50 MB'); $('#dialog').close(); $('#add-menu').hidden=true; navigate('canvas'); addNode(type,URL.createObjectURL(file),file.name); e.target.value=''; };
document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('#add-menu').hidden=true; $('#add-menu-toggle').setAttribute('aria-expanded','false'); } if ((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&!e.isComposing&&!$('#dialog').open) { e.preventDefault(); submit(); } });
window.addEventListener('hashchange',() => navigate(location.hash.slice(1),false));
try { const draft=JSON.parse(localStorage.getItem(storageKey)||'null'); if (draft) { if (typeof draft.home === 'string') $('#home-prompt').value=draft.home; if (typeof draft.canvas === 'string') $('#canvas-prompt').value=draft.canvas; if (Array.isArray(draft.refs)&&draft.refs.length) state.refs=[{id:String(draft.refs[0]),name:'客厅空间'}]; for (const [id,left,top] of draft.positions||[]) { const n=$(`[data-node="${id}"]`); if (n && /^-?\d+(\.\d+)?px$/.test(left) && /^-?\d+(\.\d+)?px$/.test(top)) { n.style.left=left; n.style.top=top; } } } } catch { /* Fresh draft when storage is unavailable or malformed. */ }
$$('nav button').forEach(button => button.setAttribute('aria-label',button.querySelector('span').textContent));
$('.settings').setAttribute('aria-label','管理与设置');
renderRefs(); navigate(location.hash.slice(1)||'home');
