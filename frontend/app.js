const $=s=>document.querySelector(s);
function displayText(value){
 if(value==null)return '';
 if(typeof value!=='object')return String(value);
 if(Array.isArray(value))return value.map(displayText).filter(Boolean).join('；');
 const detail=[value.issue,value.fix_hint||value.action||value.expected_improvement].filter(Boolean);
 if(detail.length)return detail.map(displayText).join('；');
 for(const key of ['observation','text','description','requirement','summary','reason','element'])if(value[key])return displayText(value[key]);
 return Object.entries(value).map(([key,v])=>key+'：'+displayText(v)).join('；');
}
const esc=s=>displayText(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let mode='live',base='',timer=null,stream=null,run={status:'idle',iterations:[],events:[],requirements:[]},selected=0,detailKey=null,comparing=false,startedAt=0,endedAt=0,elapsedTimer=null,seen=new Set();
let replaying=false,replayTime=0,skipReplay=false;
const names={scene_analysis:'理解画面需求',prompt_generated:'生成初始 Prompt',image_generation:'生成图片',image_evaluation:'检查画面质量',prompt_revision:'修订 Prompt',accepted:'完成 · 已通过',failed:'任务失败',cancelled:'任务已停止',limit_reached:'已达生成上限'};
function toast(t){$('#toast').textContent=t;$('#toast').style.display='block';setTimeout(()=>$('#toast').style.display='none',3500)}
function safeURL(url){try{const u=new URL(url,location.href);return ['http:','https:'].includes(u.protocol)?u.href:''}catch{return ''}}
$('#request').value='';
$('#source').value='live';
$('#start').textContent='▶ 开始创作';
$('.mode-pill').textContent='后端接口';
$('#footer-mode').textContent='接口模式 · 等待 PilotDeck Gateway';
function active(on){$('#start').disabled=on;$('#stop').hidden=!on;for(const id of ['request','connect'])$('#'+id).disabled=on}
function receive(e){
 if(!e||!names[e.stage]||!Number.isInteger(e.iteration)||e.iteration<0||!['running','completed','failed'].includes(e.status))throw Error('收到不符合约定的阶段事件');
 if(seen.has(e.event_id))return;seen.add(e.event_id);run.events.push(e);
 const data=e.payload||{};let item;
 if(e.iteration>0){item=run.iterations.find(x=>x.iteration===e.iteration);if(!item){item={iteration:e.iteration};run.iterations.push(item)}}
 if(e.stage==='scene_analysis'&&e.status==='completed')run.requirements=data.requirements||[];
 if(item&&data.prompt)item.prompt=data.prompt;
 if(item&&e.stage==='image_generation'&&e.status==='completed'){item.image_url=safeURL(data.image_url);item.sample_view=data.sample_view;selected=run.iterations.indexOf(item);comparing=false}
 if(item&&e.stage==='image_evaluation'&&e.status==='completed')item.evaluation=data;
 if(item&&e.stage==='prompt_revision'&&e.status==='completed')item.revision=data;
 if(['accepted','failed','cancelled','limit_reached'].includes(e.stage)){endedAt=e.timestamp||Date.now();clearInterval(elapsedTimer);elapsedTimer=null;run.status=e.stage;run.message=data.reason||'';active(false);stream?.close();stream=null;clearTimeout(timer)}
 render();const timeline=$('#timeline');if(run.status==='running'&&detailKey===null){timeline.scrollTop=timeline.scrollHeight;timeline.scrollLeft=timeline.scrollWidth;}
}
function render(){
 $('#run-status').textContent=replaying?'回放历史步骤':({idle:'准备就绪',running:'正在创作',accepted:'已通过',failed:'执行失败',cancelled:'已停止',limit_reached:'达到轮次上限'})[run.status];
 if(replaying){active(true);$('#stop').hidden=true;}
 $('#skip-replay').hidden=!replaying;
 updateElapsed();
 $('#round-count').textContent='自动迭代';
 const stages=new Map();for(const e of run.events)stages.set(e.iteration+':'+e.stage,e);
 $('#timeline').innerHTML=run.events.length?[...stages.values()].map(e=>'<div class="step '+(e.status==='running'?'active':e.stage==='failed'||(e.stage==='image_evaluation'&&e.payload?.pass===false)?'issue':'done')+'" role="button" tabindex="0" data-step="'+e.iteration+':'+e.stage+'" aria-pressed="'+String((detailKey||stepKey(run.events.at(-1)))===stepKey(e))+'"><span class="step-icon">'+(e.status==='running'?'◌':e.stage==='image_evaluation'&&e.payload?.pass===false?'!':'✓')+'</span><div class="step-title">'+esc(names[e.stage])+'<small>'+(e.iteration?'第 '+e.iteration+' 轮':'')+'</small></div><p>'+esc(e.payload?.summary||e.payload?.reason||(e.status==='running'?'处理中…':'已完成'))+'</p>'+(e.stage==='prompt_revision'&&e.status==='completed'?'<div class="mini-card">保留：'+esc((e.payload.preserve||[]).join('、'))+'<br>修改：'+esc(e.payload.change)+'</div>':'')+'</div>').join(''):['理解需求与关键约束','设计 Prompt 并生成图片','逐项检查画面质量','修订与版本对比'].map((s,i)=>'<div class="step"><span class="step-icon">'+(i+1)+'</span><div class="step-title">'+s+'</div><p>'+['将想法转化为清晰的画面要求','保留每轮提示词与图片','展示问题与已经正确的部分','看到每次调整带来的变化'][i]+'</p></div>').join('');
 $('#activity').textContent=run.message||run.events.at(-1)?.payload?.summary||'输入画面需求，开始一次创作';
 const images=run.iterations.filter(x=>x.image_url),current=run.iterations[selected];
 $('#versions').innerHTML=run.iterations.map((x,i)=>x.image_url?'<button data-version="'+i+'" class="'+(selected===i?'selected':'')+'">V'+x.iteration+'</button>':'').join('');
 if(comparing&&images.length>1){$('#image-area').innerHTML='<div class="compare-grid">'+[images[0],images.at(-1)].map(x=>'<div class="compare-cell"><div><img src="'+esc(x.image_url)+'" class="'+(x.sample_view==='crop'?'v1':'')+'" alt="第 '+x.iteration+' 轮图片"></div><p>V'+x.iteration+' · '+(x.evaluation?.pass?'通过':'待改进')+'</p></div>').join('')+'</div>'}
 else $('#image-area').innerHTML=current?.image_url?'<span class="image-label">V'+current.iteration+(mode==='demo'?' · 历史结果':'')+'</span><img class="'+(current.sample_view==='crop'?'v1':'')+'" src="'+esc(current.image_url)+'" alt="第 '+current.iteration+' 轮生成结果">':'<div class="empty"><div class="empty-symbol">▧</div><h3>好画面，值得反复打磨</h3><p>生成结果将在这里逐轮呈现</p></div>';
 $('#result-summary').innerHTML=current?.image_url?'<strong>'+(current.evaluation?(current.evaluation.pass?'✓ 满足画面要求':'需进一步调整'):'等待质检')+'</strong><span>'+(mode==='demo'?'历史任务图片':'保留原始结果')+'</span>':'<span>等待第一张画面</span><span>版本与质检同步保留</span>';
 $('#compare').disabled=images.length<2;$('#compare').textContent=comparing?'返回单图':'⇄ 对比版本';$('#download').disabled=!current?.image_url;$('#export').disabled=!run.events.length;
 renderStepDetail();
}

function stepKey(e){return e?e.iteration+':'+e.stage:null}
function renderStepDetail(){
 const event=detailKey===null?run.events.at(-1):[...run.events].reverse().find(e=>stepKey(e)===detailKey);
 $('#follow-current').hidden=detailKey===null;
 if(!event){
  $('#detail-version').textContent='等待开始';
  $('#detail').innerHTML='<div class="detail-empty">执行后自动展示当前步骤的输出。点击创作进程可查看历史步骤。</div>';
  return;
 }
 const p=event.payload||{};
 $('#detail-version').textContent=(event.iteration?'第 '+event.iteration+' 轮 · ':'')+names[event.stage]+' · '+({running:'进行中',completed:'已完成',failed:'失败'})[event.status];
 const list=(items,cls='')=>(Array.isArray(items)?items:[]).map(x=>'<p class="'+cls+'">'+esc(x)+'</p>').join('');
 let content=p.summary||p.reason?'<p>'+esc(p.summary||p.reason)+'</p>':'';
 if(event.status==='running'){
  content+='<div class="detail-empty">正在执行，输出就绪后会自动更新。</div>';
 }else if(event.stage==='scene_analysis'){
  content+='<h3>场景需求</h3>'+list(p.requirements);
 }else if(event.stage==='prompt_generated'){
  content+='<h3>生成提示词</h3><p class="prompt-text">'+esc(p.prompt||'暂无提示词')+'</p>';
 }else if(event.stage==='image_generation'){
  const url=safeURL(p.image_url);
  content+=url?'<img class="step-output-image" src="'+esc(url)+'" alt="第 '+event.iteration+' 轮图片">':'<p>暂无图片输出</p>';
 }else if(event.stage==='image_evaluation'){
  content+='<div class="score">'+esc(p.overall_score??'—')+'<small> / 100</small></div><p>'+ (p.pass?'通过质检':'未通过质检')+'</p><h3>需要改进</h3>'+(p.issues?.length?list(p.issues,'warn'):'<p>未发现影响验收的问题</p>')+'<h3>已经满足</h3>'+list(p.correct_elements,'ok');
 }else if(event.stage==='prompt_revision'){
  content+='<h3>保留内容</h3>'+list(p.preserve)+'<h3>修改内容</h3><p>'+esc(p.change)+'</p><div class="diff-grid"><div><h3>修改前</h3>'+esc(p.before)+'</div><div><h3>修改后</h3>'+esc(p.after)+'</div></div><h3>下一轮提示词</h3><p class="prompt-text">'+esc(p.next_prompt)+'</p>';
 }
 $('#detail').innerHTML=content||'<p>此步骤暂无输出。</p>';
}

function updateElapsed(){ $('#elapsed').textContent=run.status==='idle'?'READY':Math.floor(((replaying?replayTime:(endedAt||Date.now()))-startedAt)/1000)+'s'; }
function reset(){clearInterval(elapsedTimer);endedAt=0;elapsedTimer=setInterval(updateElapsed,1000);stream?.close();stream=null;clearTimeout(timer);seen=new Set();selected=0;detailKey=null;comparing=false;startedAt=Date.now();run={id:'demo-'+Date.now(),status:'running',iterations:[],events:[],requirements:[]};active(true);render()}
async function start(){
 if(replaying||run.status==='running')return;
 if(mode==='demo'){await restoreTask('demo');return;}
 if(!$('#request').value.trim())return toast('请先填写画面需求');
 reset();run.request=$('#request').value;
try{const res=await fetch(base+'/api/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request:run.request}),signal:AbortSignal.timeout(20000)});if(!res.ok)throw Error('创建任务失败：HTTP '+res.status);const d=await res.json();if(typeof d.run_id!=='string'||!d.run_id)throw Error('后端未返回 run_id');run.id=d.run_id;
 const taskUrl=new URL(location.href);taskUrl.searchParams.set('taskid',run.id);history.pushState({},'',taskUrl);
 connectEvents();
 }catch(err){fail(err.message)}
}
function connectEvents(){
 stream=new EventSource(base+'/api/runs/'+encodeURIComponent(run.id)+'/events');stream.onmessage=m=>{try{const e=JSON.parse(m.data);if(e.run_id!==run.id)return;receive(e)}catch(err){fail(err.message)}};stream.onerror=()=>{$('#activity').textContent='连接中断，正在自动重连；不会重新创建任务。'};stream.onopen=()=>{$('#activity').textContent='已连接后端，等待阶段结果'};
}
function fail(reason){receive({event_id:'error-'+Date.now(),stage:'failed',iteration:0,status:'failed',payload:{reason}})}
async function stop(){try{const r=await fetch(base+'/api/runs/'+encodeURIComponent(run.id)+'/cancel',{method:'POST',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('停止请求失败');$('#activity').textContent='停止请求已发送，等待后端确认。'}catch(e){toast(e.message)}}
function saveBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
$('#start').onclick=start;$('#stop').onclick=stop;
$('#versions').onclick=e=>{const b=e.target.closest('[data-version]');if(b){selected=Number(b.dataset.version);comparing=false;render()}};
function selectStep(event){
 const card=event.target.closest('[data-step]');
 if(!card)return;
 detailKey=card.dataset.step;
 render();
 const activeCard=Array.from($('#timeline').querySelectorAll('[data-step]')).find(x=>x.dataset.step===detailKey);
 activeCard?.focus({preventScroll:true});
}
$('#timeline').onclick=selectStep;
$('#timeline').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectStep(e)}};
$('#follow-current').onclick=()=>{detailKey=null;render()};
$('#compare').onclick=()=>{comparing=!comparing;render()};
$('#download').onclick=async()=>{try{const item=run.iterations[selected];const r=await fetch(item.image_url);if(!r.ok)throw Error();saveBlob(await r.blob(),mode==='demo'?'scene-history.png':'image-v'+item.iteration+'.png');if(mode==='demo')toast('已下载历史任务图片')}catch{toast('下载失败，请检查后端图片接口与跨域设置')}};
$('#export').onclick=()=>saveBlob(new Blob([JSON.stringify({...run,mode,sample_notice:mode==='demo'?'历史任务静态回放，不调用模型':undefined},null,2)],{type:'application/json'}),'qiantu-run.json');
$('#connect').onclick=()=>$('#settings').showModal();
$('#save-settings').onclick=()=>{
 const v=$('#base').value.trim().replace(/\/$/,'');
 if(v){try{const u=new URL(v);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error();if(location.protocol==='https:'&&u.protocol!=='https:')throw Error()}catch{return toast('请输入有效的后端地址，HTTPS 页面需使用 HTTPS 后端')}}
 base=v;$('#settings').close();
 if($('#source').value==='demo'){void restoreTask('demo');return;}
 mode='live';stream?.close();clearInterval(elapsedTimer);run={status:'idle',events:[],iterations:[],requirements:[]};
 const url=new URL(location.href);url.searchParams.delete('taskid');history.replaceState({},'',url);
 $('#request').readOnly=false;$('#start').textContent='▶ 开始创作';$('.mode-pill').textContent='后端接口';active(false);render();
};
$('#architecture').onclick=()=>$('#architecture-dialog').showModal();
$('#close-architecture').onclick=()=>$('#architecture-dialog').close();
$('#skip-replay').onclick=()=>{skipReplay=true};
async function replayHistory(events){
 replaying=true;skipReplay=false;replayTime=startedAt;render();
 try{
  for(let i=0;i<events.length;i++){
   const event=events[i];
   const stamp=typeof event.timestamp==='number'?event.timestamp:Date.parse(event.timestamp);
   replayTime=Number.isFinite(stamp)?Math.max(startedAt,stamp):replayTime;
   receive(event);
   if(!skipReplay&&i<events.length-1)await new Promise(resolve=>setTimeout(resolve,1000));
  }
 }finally{replaying=false;active(run.status==='running');render();}
}
async function restoreTask(taskId){
 const id=taskId||new URL(location.href).searchParams.get('taskid')||(location.hostname.endsWith('github.io')?'demo':null);
 if(!id)return;
 $('#request').readOnly=id==='demo';
 $('#start').disabled=true;
 try{
  const isStatic=id==='demo';
  mode=isStatic?'demo':'live';
  $('.mode-pill').textContent=isStatic?'历史任务回放':'后端接口';
  $('#start').textContent=isStatic?'▶ 重新回放':'▶ 开始创作';
  $('#footer-mode').textContent=isStatic?'静态展示 · 不调用模型':'接口模式 · PilotDeck Gateway';
  if(isStatic){const url=new URL(location.href);url.searchParams.set('taskid','demo');history.replaceState({},'',url);}
  const res=await fetch(isStatic?'./data/demo.json':base+'/api/runs/'+encodeURIComponent(id),{cache:'no-store'});
  if(!res.ok)throw Error(res.status===404?'任务不存在或尚未保存':'读取任务失败');
  const data=await res.json();
  reset();run.id=id;run.request=data.request||'';$('#request').value=run.request;
  startedAt=data.started_at||Date.now();
  await replayHistory(data.events||[]);
  if(data.ended_at)endedAt=data.ended_at;
  render();
  if(run.status==='running'&&!isStatic)connectEvents();
 }catch(error){replaying=false;clearInterval(elapsedTimer);elapsedTimer=null;run.status='failed';run.message=error.message;active(false);render();}
}
window.addEventListener('popstate',()=>location.reload());
render();
void restoreTask();


