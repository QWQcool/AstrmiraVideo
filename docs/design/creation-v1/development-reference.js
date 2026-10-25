/* Offline design reference. Static evidence only; no APIs, provider calls or credentials. */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const evidenceRoot = '../reference-jimeng-2026-10-20/';
const pages = {
  overview: {
    title: '从“能出片”走向“能持续创作”', kicker: '创作闭环', tag: '证据快照',
    summary: '把界面、能力与验收放在一起看。点击左侧页面，查看目标交互与依据。',
    image: '13-canvas-overview.jpg', caption: '即梦画布 · 2026-10-20 历史观察；不代表本日在线状态。',
    observation: '媒体节点占据主要空间；操作随上下文出现。截图能证明布局，不能证明模型质量或失败恢复能力。',
    current: '审计已验证主链能够执行，但参考消费、首镜重复拼接、助手历史隔离、项目归属及备份仍有缺口。',
    rules: ['保留现有视觉方向，围绕创作任务组织界面。', '已具备、待接通和待拍板分开表达。', '不恢复已退场的工作台、成本台或旧编排入口。'],
    checks: ['按完整用户路径验收，而非仅检查按钮存在。', '生产数据与本页示例严格区分。'],
    decision: '依据：D58–D65、交接审计、即梦差距复核。完整进度与优先级只见 PLAN。',
  },
  create: {
    title: '输入、参考、参数，一次说清楚', kicker: '01 / 创作入口', tag: '目标交互',
    summary: '同一份创作有对话与画布两个入口；多素材先整理，再按模型能力确认用途。',
    image: '05-reference-modes.jpg', caption: '即梦参考模式菜单 · 2026-10-20；本日 REA 补看首页与画布，原始截图留在本地。',
    observation: '本日 REA 确认全能参考、首尾帧等菜单；Seedance 2.0 mini 输入提示最多 12 份素材（该模式限定，不照搬为我们的限额）。首页另见生成/画布入口，画布多素材汇入结果节点。',
    current: '画布图片派生支持单图；视频协议有首尾帧或单视频，二者非混合；本机 ComfyUI 未证明多图/视频混合。分镜接受参考清单不等于实际消费，F3 仍待修。',
    rules: ['对话/画布切换保留当前项目、文字、参考与用途。', '参考条提供缩略图、类型、用途、排序、移除与 @ 提及。', '不兼容的参考留在草稿并阻止提交，不静默挑第一张。'],
    checks: ['空态/单图/多图/图视频混合及首尾帧分别验收。', '切换后 ID、顺序、用途和提示词保持一致；移除不删除素材。', '提交载荷与模板消费逐项核对；没有能力就拒绝。'],
    decision: '沿用 D69：Enter 换行、Ctrl/Cmd+Enter 提交；此参照没有绑定真实提交快捷键。N9 未决定前不默认启用主体锚点。',
  },
  canvas: {
    title: '围绕所选画面继续创作', kicker: '02 / 媒体画布', tag: '沿用已定交互',
    summary: '输入面板贴着当前节点；版本、参考来源与下一步动作保持可见。',
    image: '14-canvas-node-panel.jpg', caption: '即梦节点面板 · 2026-10-20；锚定位置来自实际观察。',
    observation: '选中节点的输入面板贴近节点，常用参数紧凑排列，节点上方提供上下文操作。',
    current: '新画布、引用连线、检查器、版本及图片派生已有实现；助手跨画布历史覆盖需修。',
    rules: ['引用使用细白曲线，默认不显示箭头和用途标签。', '拖动、缩放与滚动时端点随卡片移动；来源和目标均可交互。', 'D73 保留：计划依赖为灰白虚线；已绑定来源也不等于已执行。'],
    checks: ['拖动前后端点贴合卡片，缩放后线宽仍清楚。', 'A→B→A 的草稿不串，返回对话后参考与文字保留。', '生产中撤销、保存重载、删边语义与循环保护继续通过。'],
    decision: 'D58 / D63 / D70 / D73 / D76。本页只演示布局状态，不写 CanvasDoc；生产连线样式复用 XYFlow。',
  },
  edit: {
    title: '把“改图”拆成明确的编辑操作', kicker: '03 / 像素级图片编辑', tag: '新能力规划',
    summary: '先接通可验证的工作流，再开放相应参数；原图始终可找回。',
    image: '14-canvas-node-panel.jpg', caption: '历史节点界面参考；扩图/超清/重绘内部面板未在本轮在线核验。',
    observation: '已有图片工具条观察，但没有充分证据确认各工具的内部参数、蒙版规则和效果。左侧是本项目建议，非即梦复刻。',
    current: 'S9-A3 支持单参考自然语言派生；专用超清、扩图和蒙版局部重绘尚无完整工作流。',
    rules: ['超清：展示倍率与实际目标尺寸。', '扩图：展示原图位置与新增画幅。', '局部重绘：蒙版、画笔/擦除、撤销及保留策略需明确。'],
    checks: ['缺模型或节点时不能提交，显示原因。', '生成新资产并保留原图及来源关系。', '实际尺寸、区域保持与伪影通过真实图片核验。'],
    decision: '本图表达目标交互，不冻结模型、倍率范围或误差阈值。模板选型后先改 CONTRACT，再按 B102 分片实现。',
  },
  subjects: {
    title: '主体引用应当是一份可追溯的约定', kicker: '04 / 跨画布主体复用', tag: 'N9 待拍板',
    summary: '给主体命名、选择引用版本，并明确它将影响哪一步生成。',
    image: '17-subjects.jpg', caption: '即梦主体页面 · 2026-10-20；仅能支持入口与列表形态观察。',
    observation: '主体是独立的资源入口。跨项目调用与更新传播的具体行为，本轮未在线核验。',
    current: '已有单次会话的首镜定妆锚点；没有跨画布/业务项目复用的主体实体。资产库不自动等于主体库。',
    rules: ['名称、缩略图、来源与版本同时可见。', '插入引用前标明用途，不默认将所有图片当同一种参考。', '旧引用固定版本；更新主体不应悄悄重生成已有结果。'],
    checks: ['引用离开画布再返回仍能定位同一主体版本。', '缺失资产明确标记，不能静默换图。', '主体复用的实际输入通过真模型确认。'],
    decision: '本页演示 N9 推荐选项①，不代表已经拍板。主体更新传播与锚点重出影响还关联 N10。',
  },
  confirm: {
    title: '先看到每张首帧，再决定继续', kicker: '05 / 首帧确认与恢复', tag: '待补交互闭环',
    summary: '把确认对象放在操作旁边；长任务状态、旧产物与重出成本各自说明。',
    image: '09-task-progress.jpg', caption: '即梦生成中页面 · 2026-10-20；不用于推断其首帧确认流程。',
    observation: '已有任务进度与结果区域观察。这里的逐镜首帧确认是 Astrmira 自身的会话设计目标。',
    current: '会话暂停/继续与图片重出已实现；RunsView 只有产物 ID，缺少直接预览，关闭详情还会被轮询重开。',
    rules: ['图片能放大，重出操作与目标镜头绑定。', '本地未知进度显示真实阶段，不编造百分比。', '重出锚点前展示受影响关系；成功后继不自动重跑。'],
    checks: ['确认前没有视频提前提交，未 start 不产生任务。', '重出后该卡更新到新产物，其他卡保持原结果。', '取消/失败/刷新后行为明确；关闭详情跨轮询不复开。'],
    decision: 'F1/F6、B92/B96/B100。N10 未定的传播策略仅以提示呈现。本页三张卡复用同一素材。',
  },
  delivery: {
    title: '交付一个可核验、可复用的结果', kicker: '06 / 成片交付', tag: '待补交付闭环',
    summary: '播放与下载靠近结果，项目、来源与媒体事实可以追溯。',
    image: '10-task-result.jpg', caption: '即梦结果页 · 2026-10-20；仅作为结果动作布局参考。',
    observation: '结果内嵌，提供下载和继续编辑动作。不能据此推断其企业备份、Webhook 或项目管理能力。',
    current: '自动拼接与交付基础存在；审计发现首镜重复、拼接项目归属错误、备份遗漏画布。会话详情缺直接成片入口。',
    rules: ['完整播放、下载、回到画布与交付说明集中在结果旁。', '成功状态之后仍核对镜头顺序与时长。', '没有真实媒体时禁用下载，不能给出假链接。'],
    checks: ['每镜一次，转场接缝数正确，媒体能完整解码。', '视频任务与最终成片属于同一业务项目。', '隔离环境恢复备份后，画布及引用可还原。'],
    decision: 'F5/F7/F9/F10、B95/B97/B99/B107。身份、协作、积分等不因交付页设计而重开。',
  },
};
let activePage = 'overview';
let activeNode = 'image';
let activeTool = 'upscale';
let noticeTimer;
let dialogReturn;
const nodeDrafts = {image: $('#node-prompt').value, reference: '从这份素材建立新的创作草稿。', video: '保持灯具造型，镜头缓慢向前推进。'};

function listInto(selector, items) {
  $(selector).replaceChildren(...items.map(text => { const item = document.createElement('li'); item.textContent = text; return item; }));
}
function showPage(id, updateHash = true) {
  activePage = Object.hasOwn(pages, id) ? id : 'overview';
  const page = pages[activePage];
  $$('.page').forEach(section => { section.hidden = section.id !== activePage; });
  $$('[data-page]').forEach(link => { if (link.dataset.page === activePage) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  for (const [selector, text] of Object.entries({'#page-title':page.title,'#page-kicker':page.kicker,'#page-tag':page.tag,'#page-summary':page.summary,'#evidence-caption':page.caption,'#observation':page.observation,'#current':page.current,'#decision-note':page.decision})) $(selector).textContent = text;
  $('#evidence-image').src = evidenceRoot + page.image;
  $('#evidence-image').alt = page.caption;
  $('#evidence-kind').textContent = '历史截图';
  listInto('#rules', page.rules); listInto('#checks', page.checks);
  if (updateHash) history.replaceState(null, '', `#${activePage}`);
  document.title = `Astrmira · ${page.title}`;
  if (activePage === 'canvas') { syncContext(); requestAnimationFrame(drawWires); }
}
function notice(text) {
  $('#notice').textContent = text; $('#notice').hidden = false;
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 4500);
}
function openDialog(title, text, imageSrc, action) {
  const dialog = $('#detail-dialog');
  dialogReturn = document.activeElement;
  $('#dialog-title').textContent = title;
  $('#dialog-body').replaceChildren();
  if (imageSrc) { const img = document.createElement('img'); img.src = imageSrc; img.alt = title; $('#dialog-body').append(img); }
  const paragraph = document.createElement('p'); paragraph.textContent = text; $('#dialog-body').append(paragraph);
  if (action) { const button = document.createElement('button'); button.textContent = action.label; button.className = 'primary'; button.addEventListener('click', () => { dialog.close(); action.run(); }); $('#dialog-body').append(button); }
  dialog.showModal(); $('#dialog-close').focus();
}
function runState(state) {
  $('#run-state').value = state;
  const messages = {ready:'3 张首帧可检查；视频尚未启动。这是目标界面演示。', running:'生成中状态示意：显示真实阶段，保留首帧。未连接中间帧时，不显示虚构采样图或百分比。', failed:'失败状态示意：镜头 02 需要处理；保留其余成功结果，继续操作暂不可用。', unavailable:'能力不可用示意：保留计划和参考，先修复引擎配置；不能静默切换模型。'};
  $('#run-status').textContent = messages[state]; $('#run-status').dataset.state = state;
  $('#confirm-next').disabled = state !== 'ready';
  $$('.shot').forEach((shot, i) => {
    $('.shot-state', shot).textContent = state === 'ready' ? '可检查 · 示例 v1' : state === 'running' ? '保留首帧 · 生成中示意' : state === 'unavailable' ? '模型不可用 · 草稿保留' : i === 1 ? '镜头失败 · 原图保留' : '可检查 · 成功结果保留';
    $('[data-reroll]', shot).disabled = state === 'running' || state === 'unavailable' || (state === 'failed' && i !== 1);
  });
}
const tools = {
  upscale:{title:'智能超清',description:'选择放大倍率，提交前显示目标尺寸与模型能力。',label:'倍率',options:['2 倍','4 倍'],artboard:'原图预览 · 未生成超分结果'},
  outpaint:{title:'扩图',description:'确定新增画幅与原图位置；新增区域需要真实扩图工作流生成。',label:'目标画幅',options:['16:9','1:1','9:16'],artboard:'虚线：目标画幅 · 实线：原图 · 空白不代表生成结果'},
  inpaint:{title:'局部重绘',description:'明确需要修改的区域；生产实现须提供画笔、擦除、撤销和区域保持策略。',label:'区域策略',options:['只修改蒙版区域（待验证）'],artboard:'青色区域仅为蒙版示意 · 原图未改变'},
};
function setTool(id) {
  activeTool = id; const tool = tools[id];
  $$('[data-tool]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tool === id)));
  $('#edit-title').textContent=tool.title; $('#edit-description').textContent=tool.description;
  $('#edit-option-label').firstChild.textContent=tool.label;
  $('#edit-option').replaceChildren(...tool.options.map(label => new Option(label,label)));
  $('#edit-artboard').classList.toggle('outpaint',id==='outpaint');
  $('#mask-tools').hidden=id!=='inpaint'; $('.mask').setAttribute('hidden','');
  $('#artboard-label').textContent=tool.artboard; updateEditOption();
}
function updateEditOption() {
  if(activeTool!=='outpaint') return;
  const choice=$('#edit-option').value;
  const ratio=choice.replace(':',' / ');
  $('#edit-artboard').style.setProperty('--target-ratio',ratio);
  $('#edit-artboard').style.setProperty('--target-width',choice==='9:16'?'45%':choice==='1:1'?'75%':'86%');
  $('#edit-artboard').style.setProperty('--source-width',choice==='9:16'?'36%':'65%');
}
document.addEventListener('click', event => {
  const target=event.target.closest('button,a'); if(!target) return;
  if(target.dataset.entry){showPage(target.dataset.entry);$('#workspace').focus({preventScroll:true});return;}
  const id=target.dataset.page ?? target.dataset.go;
  if(id){event.preventDefault();showPage(id);$('#workspace').focus({preventScroll:true});return;}
  if(target.dataset.mode){
    const mode=target.dataset.mode; $$('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button===target)));
    $('#duration-control').hidden=mode==='image'; $('#create-next').textContent=mode==='script'?'查看分镜方案':'查看提交前确认'; $('#create-next').dataset.mode=mode;
    $('#create-note').textContent=mode==='script'?'规划会调用文本模型；确认并启动后才提交媒体生成。':'模型能力、输入用途与费用在提交前确认；本页仅演示。';
    validateReferences();
  }
  if(target.dataset.prompt){const text={product:'三镜灯具产品短片：展示客厅空间、环形灯细节与暖光阅读角。保持产品造型一致。',story:'用三个镜头讲述从忙碌归家到安静阅读的小故事，灯光是连接三个画面的线索。',space:'呈现客厅从蓝调时刻到夜晚的光线变化，保留房间布局和环形灯造型。'};$('#prompt').value=text[target.dataset.prompt];}
  if(target.dataset.node){
    nodeDrafts[activeNode]=$('#node-prompt').value;activeNode=target.dataset.node;
    $$('.media-node').forEach(node=>{node.classList.toggle('selected',node===target);node.setAttribute('aria-pressed',String(node===target));});
    target.closest('.node-column').append($('#node-composer'));
    $('#node-context').textContent={reference:'正在查看：上传参考素材',image:'正在编辑：镜头 01 · 首帧草稿',video:'正在编辑：镜头 01 · 视频草稿'}[activeNode];
    $('#node-prompt').value=nodeDrafts[activeNode];$('#node-prompt').readOnly=activeNode==='reference';
    $('.node-parameters>span').textContent=activeNode==='video'?'视频 · 2 秒 · 首帧参考':activeNode==='image'?'图片 · 单参考':'素材仅作输入';
    $('[data-action="draft"]').disabled=activeNode==='reference';
    requestAnimationFrame(drawWires);
  }
  if(target.dataset.tool)setTool(target.dataset.tool);
  if(target.dataset.preview)openDialog(target.dataset.preview,'这是同一原创素材的布局占位，不是该镜头真实生成结果。','scene.png');
  if(target.dataset.reroll){const anchor=target.dataset.reroll==='镜头 01';openDialog(`重出 ${target.dataset.reroll}`,'真实实现将提交一个新任务并保留旧版本。'+(anchor?'该镜头可能是定妆锚点，后镜仍引用旧版本；N10 未拍板前不能自动重出后继。':'只作用于当前镜头，不自动重出其他成功镜头。'),null,{label:'查看重出提示（演示）',run:()=>notice('已展示显式重出流程；没有提交任务，也没有生成新图片。')});}
  if(target.dataset.action){const content={derive:['作为参考继续','目标行为：从当前所见产物建立相邻草稿并固定引用；不会自动提交生成。'],draft:['提交前确认','核对当前提示词、参考用途、模型能力和费用后，才允许显式提交。本页只展示这一确认位置。'],package:['交付包说明','生产交付应包含成片、必要的源素材清单和来源信息。画布备份恢复还须修复审计 F5；本页未提供模拟下载。']};const [title,text]=content[target.dataset.action];openDialog(title,text);}
});
$('#create-next').addEventListener('click',()=>{if(($('#create-next').dataset.mode??'script')==='script'){showPage('confirm');runState('ready');$('#workspace').focus({preventScroll:true});}else openDialog('提交前核对','目标实现需要核对参考用途、模型能力、参数和费用。此设计页不会调用生成接口。');});
$('#show-mask').addEventListener('click',()=>{$('.mask').removeAttribute('hidden');});$('#clear-mask').addEventListener('click',()=>{$('.mask').setAttribute('hidden','');});
$('#edit-option').addEventListener('change',updateEditOption);
$('#subject-select').addEventListener('click',()=>{const selected=$('#subject-select').getAttribute('aria-pressed')!=='true';$('#subject-select').setAttribute('aria-pressed',String(selected));$('#subject-binding').textContent=selected?'@双环吸顶灯 · 参考 v1 · 主体用途待 N9 决定':'尚未选择主体';$('#subject-use').disabled=!selected;$('.subject-action').textContent=selected?'已选择 · 再次点击取消':'选择此主体';});
$('#subject-use').addEventListener('click',()=>openDialog('主体引用示意','已展示主体和版本的绑定方式。没有创建主体资产或写入任何画布；实际生成语义等待 N9 和契约。'));
$('#run-state').addEventListener('change',event=>runState(event.target.value));
$('#confirm-next').addEventListener('click',()=>openDialog('确认首帧并继续','生产实现将开始视频步骤，随后自动拼接。本页可切换到生成中状态，查看反馈设计。',null,{label:'查看生成中状态',run:()=>runState('running')}));
$('#evidence-preview').addEventListener('click',()=>openDialog('即梦历史观察截图',pages[activePage].caption,evidenceRoot+pages[activePage].image));
$('#dialog-close').addEventListener('click',()=>$('#detail-dialog').close());
$('#detail-dialog').addEventListener('close',()=>{if(dialogReturn?.isConnected)dialogReturn.focus({preventScroll:true});});
$('#annotations-toggle').addEventListener('click',()=>{const show=$('#inspector').hidden;$('#inspector').hidden=!show;$('.body-grid').classList.toggle('without-notes',!show);$('#annotations-toggle').setAttribute('aria-pressed',String(show));$('#annotations-toggle').textContent=show?'隐藏开发注释':'显示开发注释';});
$('#print').addEventListener('click',()=>window.print());
window.addEventListener('hashchange',()=>showPage(location.hash.slice(1),false));
const referenceCatalog = {
  space:{name:'空间图片',kind:'image',mention:'图片1',crop:'center'},
  lamp:{name:'灯具图片',kind:'image',mention:'图片2',crop:'top'},
  style:{name:'光线图片',kind:'image',mention:'图片3',crop:'bottom'},
  motion:{name:'运镜视频',kind:'video',mention:'视频1',crop:'center'},
};
let referenceDraft = [{id:'space',role:'图片参考'}];
function element(tag,text,className){const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;}
function renderReferences(){
  const cards=referenceDraft.map((ref,index)=>{
    const asset=referenceCatalog[ref.id], card=element('article',null,'reference-card');card.dataset.refId=ref.id;
    const preview=element('div',null,'reference-thumb'),img=element('img');img.src='scene.png';img.alt=`${asset.name}：同一原创图片的布局示意`;img.style.objectPosition=asset.crop;preview.append(img,element('span',asset.kind==='video'?'视频占位 · 无媒体':`图片 ${index+1}`));card.append(preview);
    card.append(element('strong',asset.name));const label=element('label','用途');const select=element('select');select.setAttribute('aria-label',`${asset.name}用途`);
    const roles=asset.kind==='video'?['视频参考','运镜（规划）']:['图片参考','首帧','尾帧','主体（规划）','场景（规划）','风格（规划）'];
    roles.forEach(role=>{const option=element('option',role);option.value=role;select.append(option);});select.value=ref.role;select.addEventListener('change',()=>{ref.role=select.value;validateReferences();});label.append(select);card.append(label);
    const actions=element('div',null,'reference-card-actions');for(const [action,text,title]of [['mention','@','插入提及'],['up','←','前移'],['down','→','后移'],['remove','×','移除引用']]){
      const button=element('button',text);button.type='button';button.dataset.refAction=action;button.dataset.ref=ref.id;button.setAttribute('aria-label',`${title}${asset.name}`);button.disabled=action==='up'&&index===0||action==='down'&&index===referenceDraft.length-1;actions.append(button);
    }card.append(actions);return card;
  });
  $('#reference-tray').replaceChildren(...(cards.length?cards:[element('p','添加图片或视频，先保留素材，再指定本次用途。','reference-empty')]));
  $$('[data-add-ref]').forEach(button=>button.disabled=referenceDraft.some(ref=>ref.id===button.dataset.addRef));validateReferences();
}
function validateReferences(){
  const mode=$('#reference-mode').value,kind=$('#create-next').dataset.mode??'script',count=referenceDraft.length;
  let message='',blocked=false;
  if(!count){blocked=mode!=='single';message=blocked?'当前参考方式需要素材，请添加参考或切回单图/无参考草稿。':'尚未添加参考；可先整理文字草稿。';}
  else if(mode==='multi'||referenceDraft.some(ref=>ref.role.includes('规划'))){blocked=true;message=`已保留 ${count} 份素材。多图语义 / 图视频混合尚未接通，当前不能生成；用途待 N9 / N12 与真实模板验证。`;}
  else if(mode==='single'&&(count>1||referenceDraft[0].role!=='图片参考'||referenceCatalog[referenceDraft[0].id].kind!=='image')){blocked=true;message='单图参考需一张图片，且用途为“图片参考”。其余素材已保留，请调整参考方式或移除引用。';}
  else if(mode==='frames'){
    blocked=kind!=='video'||count!==2||!referenceDraft.some(ref=>ref.role==='首帧')||!referenceDraft.some(ref=>ref.role==='尾帧');
    message=blocked?'首尾帧需要视频创作、两张图片，并分别指定首帧和尾帧；素材不会自动改用途。':'首尾帧布局就绪。协议有此通道；实际可提交仍取决于所选实例模板，本页不证明本机支持。';
  }else if(mode==='video'){blocked=true;message='单视频参考有协议通道，本机当前模板未验通。视频已保留，不把抽帧或文字描述冒充原生视频条件。';}
  else message='单图布局就绪。生产仍需修复剧本参考传递并校验模板；本页只查看方案，不提交任务。';
  $('#reference-status').textContent=message;$('#reference-status').classList.toggle('blocked',blocked);$('#create-next').disabled=blocked;syncContext();
}
function syncContext(){ $('#shared-context').textContent=`与对话共用：蓝调客厅 · ${referenceDraft.length} 份参考 · 当前画布为固定关系示例，切换不自动建节点或提交任务。`; }
$('#reference-picker').addEventListener('click',()=>{const open=$('#reference-options').hidden;$('#reference-options').hidden=!open;$('#reference-picker').setAttribute('aria-expanded',String(open));});
$('#reference-mode').addEventListener('change',validateReferences);
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.addRef){const id=button.dataset.addRef;if(!referenceDraft.some(ref=>ref.id===id))referenceDraft.push({id,role:referenceCatalog[id].kind==='video'?'视频参考':'图片参考'});renderReferences();}
  if(button.dataset.refAction){const i=referenceDraft.findIndex(ref=>ref.id===button.dataset.ref);if(i<0)return;const action=button.dataset.refAction;
    if(action==='mention'){const prompt=$('#prompt');prompt.setRangeText(`@${referenceCatalog[button.dataset.ref].mention} `,prompt.selectionStart,prompt.selectionEnd,'end');prompt.focus();return;}
    if(action==='remove')referenceDraft.splice(i,1);else{const next=action==='up'?i-1:i+1;if(next>=0&&next<referenceDraft.length)[referenceDraft[i],referenceDraft[next]]=[referenceDraft[next],referenceDraft[i]];}renderReferences();$('#reference-picker').focus({preventScroll:true});
  }
  if(button.dataset.refCase){const c=button.dataset.refCase;const ids={empty:[],single:['space'],multi:['space','lamp','style'],mixed:['space','lamp','motion'],frames:['space','lamp']}[c];referenceDraft=ids.map((id,i)=>({id,role:c==='frames'?(i?'尾帧':'首帧'):referenceCatalog[id].kind==='video'?'视频参考':'图片参考'}));$('#reference-mode').value=c==='multi'||c==='mixed'?'multi':c==='frames'?'frames':'single';if(c==='frames')$('[data-mode="video"]').click();renderReferences();}
});
const initialPositions={reference:[30,90],image:[285,130],video:[550,230]};
const positions=Object.fromEntries(Object.entries(initialPositions).map(([key,xy])=>[key,[...xy]]));
let zoom=1,drag=null,suppressNodeClick=false;
const flow=$('.canvas-flow');
function placeNodes(){for(const card of $$('.media-node')){const col=card.closest('.node-column'),[x,y]=positions[card.dataset.node];col.style.left=`${x}px`;col.style.top=`${y}px`;}drawWires();}
function drawWires(){
  if(!flow.getClientRects().length)return;const origin=flow.getBoundingClientRect();
  const point=(id,right)=>{const box=$(`[data-node="${id}"]`).getBoundingClientRect();return[(box.left-origin.left+(right?box.width:0))/zoom,(box.top-origin.top+box.height/2)/zoom];};
  for(const [wire,a,b] of [['source','reference','image'],['plan','image','video']]){const [x1,y1]=point(a,true),[x2,y2]=point(b,false),curve=Math.max(24,Math.abs(x2-x1)*.45);$(`[data-wire="${wire}"]`).setAttribute('d',`M ${x1} ${y1} C ${x1+curve} ${y1}, ${x2-curve} ${y2}, ${x2} ${y2}`);}
}
function setZoom(value){zoom=Math.max(.6,Math.min(1.3,value));flow.style.transform=`scale(${zoom})`;$('.canvas-sizer').style.width=`${800*zoom}px`;$('.canvas-sizer').style.height=`${820*zoom}px`;$('#canvas-zoom-label').textContent=`${Math.round(zoom*100)}%`;drawWires();}
flow.addEventListener('pointerdown',event=>{const card=event.target.closest('.media-node');if(!card||event.button!==0)return;event.preventDefault();const id=card.dataset.node;drag={id,card,start:[event.clientX,event.clientY],origin:[...positions[id]],moved:false};card.setPointerCapture(event.pointerId);});
flow.addEventListener('pointermove',event=>{if(!drag)return;const dx=(event.clientX-drag.start[0])/zoom,dy=(event.clientY-drag.start[1])/zoom;if(Math.abs(dx)+Math.abs(dy)>4)drag.moved=true;positions[drag.id]=[Math.max(8,Math.min(588,drag.origin[0]+dx)),Math.max(25,Math.min(360,drag.origin[1]+dy))];placeNodes();});
function finishDrag(event){if(!drag)return;suppressNodeClick=drag.moved;if(drag.card.hasPointerCapture(event.pointerId))drag.card.releasePointerCapture(event.pointerId);drag=null;setTimeout(()=>{suppressNodeClick=false;},0);}
flow.addEventListener('pointerup',finishDrag);flow.addEventListener('pointercancel',finishDrag);
flow.addEventListener('click',event=>{if(suppressNodeClick){event.preventDefault();event.stopPropagation();}},true);
flow.addEventListener('keydown',event=>{const card=event.target.closest('.media-node'),delta={ArrowLeft:[-8,0],ArrowRight:[8,0],ArrowUp:[0,-8],ArrowDown:[0,8]}[event.key];if(!card||!delta)return;event.preventDefault();const p=positions[card.dataset.node];p[0]=Math.max(8,Math.min(588,p[0]+delta[0]));p[1]=Math.max(25,Math.min(360,p[1]+delta[1]));placeNodes();});
$('#canvas-zoom-out').addEventListener('click',()=>setZoom(zoom-.1));$('#canvas-zoom-in').addEventListener('click',()=>setZoom(zoom+.1));
$('#canvas-reset').addEventListener('click',()=>{for(const id of Object.keys(positions))positions[id]=[...initialPositions[id]];setZoom(1);placeNodes();});
for(const wire of $$('[data-wire]')){const describe=()=>{$('#wire-detail').textContent=wire.getAttribute('aria-label')+'。示例关系，不触发执行。';};wire.addEventListener('pointerenter',describe);wire.addEventListener('focus',describe);wire.addEventListener('click',describe);wire.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();describe();}});}
new ResizeObserver(()=>requestAnimationFrame(drawWires)).observe(flow);
renderReferences();placeNodes();setZoom(1);
showPage(location.hash.slice(1)||'overview',false);
