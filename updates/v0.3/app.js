'use strict';
const app=document.querySelector('#app'),status=document.querySelector('#status'),subtitle=document.querySelector('#subtitle');
const staff=location.pathname.endsWith('staff.html');
const table=new URLSearchParams(location.search).get('table')||'';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>(Number(v)||0).toFixed(2),label={new:'待上菜',accepted:'待上菜',ready:'已上齐',settled:'已清台'};
let csrf='',view='board',items=[],orders=[],tables=[],sid='',cart={},note='',category='',submitting=false,pending=null,seen=new Set(),first=true,audio=null,showServed=false,optionProduct=null,selectedTable=null,detailSignature='';
const modal=document.querySelector('#modal'),modalContent=document.querySelector('#modal-content');
const cartKey='dining-cart-'+table;
function message(text){status.textContent=text;}
async function api(action,data=null,query={}){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),15000);
 try{
  const res=await fetch('/dining/index/api?'+new URLSearchParams({action,...query}),{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{},body:data?JSON.stringify(data):undefined,signal:ctrl.signal,credentials:'same-origin',cache:'no-store'});
  const body=await res.json();if(body.error)throw new Error(body.error);if(!res.ok)throw new Error('请求失败');return body;
 }catch(e){if(e.name==='AbortError')throw new Error('连接超时，请重试；下单重试不会重复生成订单');throw e;}finally{clearTimeout(timer);}
}
function saveCart(){try{localStorage.setItem(cartKey,JSON.stringify({sid,cart,note,pending}));}catch{}}
function renderOrders(list,controls=false){return list.map(o=>`<article class="${esc(o.state)}"><div class="line"><strong class="table-number">${esc(o.table_no)} 桌</strong><span class="badge">${controls&&Number(o.batch)>1?'加菜 · ':''}${esc(label[o.state])}</span></div><div class="muted">订单 ${esc(o.order_no)} · ${new Date(Number(o.create_time)*1000).toLocaleTimeString()}</div>${o.items.map(i=>`<div class="line"><span>${esc(i.product_name)} · ${esc(i.product_attr)} × ${i.total_num}</span><span>¥${money(Number(i.product_price)*i.total_num)}</span></div>`).join('')}${o.buyer_remark?`<p class="notice">备注：${esc(o.buyer_remark)}</p>`:''}<div class="line"><strong>合计 ¥${money(o.pay_price)}</strong>${controls&&['new','accepted'].includes(o.state)?`<button class="serve-button" data-state="ready" data-order="${o.order_id}">全部上齐了</button>`:controls&&o.state==='ready'?`<button class="secondary" data-state="accepted" data-order="${o.order_id}">误点了，恢复待上菜</button>`:''}</div></article>`).join('')||'<p class="muted">暂无订单</p>';}
function groups(){
 const map=new Map();
 for(const item of items){const key=String(item.product_id??(item.category+'|'+item.name));if(!map.has(key))map.set(key,{key,name:item.name,category:item.category,variants:[]});map.get(key).variants.push(item);}
 return [...map.values()];
}
const tasteChoices={spice:[['default','按原做法（默认）'],['none','不辣'],['mild','微辣'],['medium','中辣'],['hot','特辣']],salt:[['default','正常（默认）'],['less','少盐']],cilantro:[['default','正常（默认）'],['none','不要香菜']],scallion:[['default','正常（默认）'],['none','不要葱']]};
const tasteNames={spice:'辣度',salt:'盐量',cilantro:'香菜',scallion:'葱'};
function cartLine(key,qty){const [id,...v]=String(key).split('~');const item=items.find(i=>Number(i.id)===Number(id));if(!item)return null;const options=Object.fromEntries(Object.keys(tasteChoices).map((k,j)=>[k,v[j]||'default']));return {...item,key,qty,options};}
function cartLines(){return Object.entries(cart).map(([key,qty])=>cartLine(key,qty)).filter(Boolean);}
function tasteText(options){return Object.entries(options).filter(([k,v])=>v!=='default').map(([k,v])=>tasteChoices[k].find(c=>c[0]===v)?.[1]||'').filter(Boolean).join('、');}
function productChoices(group){
 try{const raw=JSON.parse(group.variants[0].choice_config||'{}');return raw.dining||{};}catch{return {};}
}
function tasteRules(group){const c=productChoices(group).tastes||{};return Object.fromEntries(Object.entries(tasteChoices).map(([key,values])=>[key,c[key]||{enabled:true,values:values.map(v=>v[0]),default:'default'}]));}
function chooseSize(key){
 const group=groups().find(g=>g.key===key);if(!group)return;
 optionProduct=key;const rules=tasteRules(group),config=productChoices(group);const first=group.variants.find(i=>Number(i.id)===Number(config.default_size)&&Number(i.stock_num)>0)||group.variants.find(i=>Number(i.stock_num)>0);
 modalContent.innerHTML=`<h2 id="size-title">${esc(group.name)}</h2><fieldset><legend>份量</legend>${group.variants.map(i=>`<label class="portion"><input type="radio" name="portion" value="${i.id}" ${i===first?'checked':''} ${Number(i.stock_num)<1?'disabled':''}> ${esc(i.size)} · ¥${money(i.price)} ${Number(i.stock_num)<1?'（售罄）':''}</label>`).join('')}</fieldset>${Object.entries(tasteChoices).filter(([k])=>rules[k].enabled).map(([k,choices])=>`<label class="taste-row">${tasteNames[k]}<select id="taste-${k}">${choices.filter(([v])=>rules[k].values.includes(v)).map(([v,t])=>`<option value="${v}" ${rules[k].default===v?'selected':''}>${t.replace('（默认）','')}${rules[k].default===v?'（默认）':''}</option>`).join('')}</select></label>`).join('')}<p class="muted">不调整就按原做法。其他要求可写在整单备注里。</p><button id="add-selection" ${!first||!sid||pending?'disabled':''}>加入已选</button>`;
 modal.setAttribute('aria-labelledby','size-title');document.querySelector('#modal-close').textContent='取消';if(!modal.open)modal.showModal();
}
function showCart(){
 optionProduct=null;modalContent.innerHTML='<h2 id="size-title">已选菜品</h2>'+cartLines().map(i=>`<div class="cart-line"><strong>${esc(i.name)} · ${esc(i.size)}</strong><p class="muted">${esc(tasteText(i.options)||'按原做法')}</p><div class="line"><span>¥${money(Number(i.price)*i.qty)}</span><div class="qty"><button class="secondary" data-cart-key="${esc(i.key)}" data-delta="-1" ${pending?'disabled':''}>−</button><span>${i.qty}</span><button data-cart-key="${esc(i.key)}" data-delta="1" ${pending?'disabled':''}>+</button></div></div></div>`).join('');
 if(!cartLines().length)modalContent.innerHTML+='<p>还没有选菜</p>';
 modal.setAttribute('aria-labelledby','size-title');document.querySelector('#modal-close').textContent='继续点菜';if(!modal.open)modal.showModal();
}
function renderGuest(){
 const cats=[...new Set(items.map(i=>i.category))];if(!category)category=cats[0];
 const total=cartLines().reduce((sum,i)=>sum+Math.round(Number(i.price)*100)*i.qty,0)/100;
 app.innerHTML=`${!sid?'<p class="notice">本次用餐已结束，请重新扫码。</p>':''}<nav><button data-guest="menu" class="${view==='menu'?'':'secondary'}">点菜</button><button data-guest="orders" class="${view==='orders'?'':'secondary'}">本桌订单</button></nav>${view==='orders'?renderOrders(orders):`<nav>${cats.map(c=>`<button class="${category===c?'':'secondary'}" data-category="${esc(c)}">${esc(c)}</button>`).join('')}</nav><div class="grid">${groups().filter(g=>g.category===category).map(g=>{
 const chosen=cartLines().filter(i=>g.variants.some(v=>Number(v.id)===Number(i.id)));const available=g.variants.some(i=>Number(i.stock_num)>0);const low=Math.min(...g.variants.map(i=>Number(i.price)));
 return `<article><h3>${esc(g.name)}</h3><p class="muted">${g.variants.map(i=>esc(i.size)).join(' / ')}</p><div class="line"><strong class="price">¥${money(low)}${g.variants.length>1?' 起':''}</strong><button data-product="${esc(g.key)}" ${!sid||pending||!available?'disabled':''}>${!available?'售罄':g.variants.length>1?'选份量':'选这道菜'}</button></div>${chosen.length?`<p class="chosen-summary">已选：${chosen.map(i=>esc(i.size)+(tasteText(i.options)?'（'+esc(tasteText(i.options))+'）':'')+' × '+i.qty).join('、')}</p>`:''}</article>`;
 }).join('')}</div><label>整单备注<textarea id="note" maxlength="200" ${pending?'disabled':''} placeholder="例如：少辣、不放香菜">${esc(note)}</textarea></label><p class="muted">餐后到前台结账。下单后请以“本桌订单”为准。</p>`}`;
 document.querySelector('.bottom')?.remove();const bar=document.createElement('div');bar.className='bottom';bar.innerHTML=`<button id="view-cart" class="secondary">已选 ${Object.values(cart).reduce((a,b)=>a+b,0)} 份 · ¥${money(total)}</button><button id="submit" ${!sid||submitting||!Object.keys(cart).length?'disabled':''}>${submitting?'正在提交…':pending?'重试同一订单':'确认菜品并下单'}</button>`;document.body.append(bar);
}
async function guestLoad(initial=false){
 if(initial)await api('join',{table});
 const m=await api('menu',null,{table});items=m.items;sid=m.session_id||'';document.querySelector('h1').textContent=m.name;subtitle.textContent=m.table_no+' 桌 · 餐后结账';
 if(initial){try{const saved=JSON.parse(localStorage.getItem(cartKey));if(saved&&saved.sid===sid){cart=saved.cart||{};note=saved.note||'';pending=saved.pending||null;}}catch{}}
 if(sid){orders=(await api('orders',null,{table,session_id:sid})).orders;}else orders=[];
 renderGuest();
}
async function submit(){
 if(submitting)return;
 if(!pending){
  const selected=cartLines();
  if(!confirm('确认下单？\n'+selected.map(i=>`${i.name} ${i.size} ${tasteText(i.options)} × ${i.qty}`).join('\n')))return;
  pending={table,session_id:sid,request_id:Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join(''),items:selected.map(i=>({id:Number(i.id),qty:i.qty,options:i.options})),note};saveCart();
 }
 submitting=true;renderGuest();
 try{const result=await api('submit',pending);pending=null;cart={};note='';saveCart();view='orders';message('下单成功，订单号 '+result.order_id);await guestLoad();}
 catch(e){message(e.message+'。若是售罄或用餐结束，可点“检查订单并重新选菜”。');
  if(!document.querySelector('#recover')){const b=document.createElement('button');b.id='recover';b.textContent='检查订单并重新选菜';b.onclick=async()=>{try{if(pending){await api('submit',pending);pending=null;cart={};note='';saveCart();message('已确认订单提交成功');await guestLoad();} }catch(err){if(/售罄|库存|下架|用餐已结束|尚未开桌/.test(err.message)){pending=null;cart={};note='';saveCart();await guestLoad();message('已清理未提交菜品，请重新选择');}else message('暂时无法确认，请保留当前订单稍后重试或联系店员。');}};status.append(' ',b);}}
 finally{submitting=false;renderGuest();}
}
function nav(){return `<nav class="owner-nav">${view!=='board'?'<button data-view="board" class="secondary">返回桌台</button>':''}${view!=='codes'?'<button data-view="codes" class="secondary">打印桌码</button>':''}<button id="sound" class="secondary">${audio?'声音已开启':'开启声音提醒'}</button><details class="settings"${document.querySelector('.settings')?.open?' open':''}><summary>设置</summary><button data-view="catalog" class="secondary">菜品设置</button><button id="logout" class="secondary">退出登录</button></details></nav>`;}
function variantRow(v,index,isDefault){return `<section class="edit-variant" data-sku="${Number(v.id)||0}"><div class="line"><label>份量名称<input name="size-name" value="${esc(v.size||'')}" maxlength="30" required placeholder="例如：小份"></label><label>价格<input name="size-price" value="${money(v.price)}" inputmode="decimal" required></label></div><div class="line"><label><input type="checkbox" name="available" ${Number(v.stock_num)>0?'checked':''}> 可售</label><label><input type="radio" name="default-size" value="${index}" ${isDefault?'checked':''}> 默认份量</label></div></section>`;}
function editProduct(key){const g=groups().find(g=>g.key===key);if(!g)return;selectedTable=null;const c=productChoices(g),rules=tasteRules(g);const defaultIndex=Math.max(0,g.variants.findIndex(i=>Number(i.id)===Number(c.default_size)));
 modalContent.innerHTML=`<h2 id="edit-title">${esc(g.name)} · 设置</h2><form id="dish-setup" data-product-id="${Number(g.variants[0].product_id)}"><label>菜名<input name="dish-name" value="${esc(g.name)}" maxlength="50" required></label><h3>份量和价格</h3><div id="variant-list">${g.variants.map((v,j)=>variantRow(v,j,j===defaultIndex)).join('')}</div><button type="button" id="add-variant" class="secondary">添加份量</button><details class="taste-settings"><summary>口味选项和默认值</summary>${Object.entries(tasteChoices).map(([k,choices])=>`<fieldset data-taste="${k}"><legend>${tasteNames[k]}</legend><label><input type="checkbox" name="enabled" ${rules[k].enabled?'checked':''}> 让顾客选择</label><div class="taste-checks">${choices.map(([v,t])=>`<label><input type="checkbox" name="choice" value="${v}" ${rules[k].values.includes(v)?'checked':''} ${v==='default'?'disabled':''}> ${t.replace('（默认）','')}</label>`).join('')}</div><label>默认选择<select name="taste-default">${choices.map(([v,t])=>`<option value="${v}" ${rules[k].default===v?'selected':''}>${t.replace('（默认）','')}</option>`).join('')}</select></label></fieldset>`).join('')}</details><p class="muted">不卖的份量取消可售；修改不会影响已下单的价格和口味。</p><button type="submit" class="save-dish">保存这个菜</button></form>`;
 modal.setAttribute('aria-labelledby','edit-title');document.querySelector('#modal-close').textContent='取消';modal.showModal();
}
function tableOrders(t){return t.session_id?orders.filter(o=>o.session_id===t.session_id):[];}
function tableCards(){return tables.map(t=>{
 const os=tableOrders(t),sum=os.reduce((n,o)=>n+Math.round(Number(o.pay_price)*100),0)/100,pending=os.filter(o=>['new','accepted'].includes(o.state)),qty=os.reduce((n,o)=>n+o.items.reduce((a,i)=>a+Number(i.total_num),0),0);
 return `<button class="table-tile ${pending.length?'has-orders':''}" data-table="${t.token}" aria-label="${esc(t.table_no)}桌，${pending.length?'有待上菜订单':t.session_id?'用餐中':'空桌'}，查看点单详情"><strong>${esc(t.table_no)} 桌</strong><span>${t.session_id?'用餐中':'空桌'} · ${os.length} 笔订单 · ¥${money(sum)}</span><span class="tile-status">${pending.length?pending.length+' 单待上菜':qty?'已全部上齐':'暂无点单'}</span></button>`;
 }).join('');}
function showTable(token){
 const t=tables.find(t=>t.token===token);if(!t)return;
 selectedTable={token,sessionId:t.session_id};detailSignature='';renderTableDetails();if(!modal.open)modal.showModal();
}
function renderTableDetails(){
 if(!selectedTable)return;const t=tables.find(t=>t.token===selectedTable.token);if(!t)return;
 const ended=t.session_id!==selectedTable.sessionId,os=ended?[]:tableOrders(t);
 const signature=JSON.stringify([selectedTable,t.session_id,os]);if(signature===detailSignature)return;detailSignature=signature;
 const expanded=modalContent.querySelector('details')?.open||false;
 const waiting=os.filter(o=>['new','accepted'].includes(o.state)),served=os.filter(o=>o.state==='ready'),sum=os.reduce((n,o)=>n+Math.round(Number(o.pay_price)*100),0)/100;
 modalContent.innerHTML=`<h2 id="table-detail-title">${esc(t.table_no)} 桌 · 点单详情</h2>${ended?'<p class="notice">桌台状态已更新，请关闭后重新查看。</p>':`<div class="line"><strong>合计 ¥${money(sum)}</strong><span>${os.length} 笔订单</span></div>${!os.length?'<p class="empty-table">暂无点单，顾客扫码下单后会显示在这里。</p>':waiting.length?renderOrders(waiting,true):'<p class="muted">本桌菜品已全部上齐</p>'}${served.length?`<details class="served-details" ${expanded?'open':''}><summary>已上齐（${served.length} 单）</summary>${renderOrders(served,true)}</details>`:''}${t.session_id?`<div class="clear-area"><button class="secondary" data-close="${t.token}" data-session="${t.session_id}" data-total="${money(sum)}" ${waiting.length?'disabled':''}>客人离店，清台</button>${waiting.length?'<p class="muted">还有菜未上齐</p>':''}</div>`:''}`}`;
 modal.setAttribute('aria-labelledby','table-detail-title');document.querySelector('#modal-close').textContent='关闭';
}
function login(){app.innerHTML='<form id="login" class="panel form"><h2>店员登录</h2><label>店员密码<input id="password" type="password" required autocomplete="current-password"></label><button>登录接单</button></form>';}
async function staffLoad(){
 if(view==='board'){
  orders=(await api('board')).orders;
  tables=(await api('tables')).tables;
  if(!first&&audio&&orders.some(o=>o.state==='new'&&!seen.has(o.order_id))){const osc=audio.createOscillator(),gain=audio.createGain();osc.connect(gain);gain.connect(audio.destination);gain.gain.value=.08;osc.frequency.value=880;osc.start();osc.stop(audio.currentTime+.4);}
  seen=new Set(orders.map(o=>o.order_id));first=false;
 }
 if(view==='board'){
  app.innerHTML=nav()+'<div class="table-overview">'+tableCards()+'</div>';
  if(selectedTable&&modal.open)renderTableDetails();
 }
 if(view==='catalog'){
  items=(await api('catalog')).items;
  app.innerHTML=nav()+'<h2>菜品设置</h2><div class="grid">'+groups().map(g=>`<button class="dish-settings-card" data-edit-product="${esc(g.key)}"><strong>${esc(g.name)}</strong><span>${g.variants.map(i=>`${esc(i.size)} ¥${money(i.price)}${Number(i.stock_num)>0?'':'（售罄）'}`).join(' / ')}</span><small>份量 · 价格 · 口味 · 默认值</small></button>`).join('')+'</div>';
 }
 if(view==='codes'){
  const data=await api('codes');app.innerHTML=nav()+'<p><button id="print">打印桌码</button></p>'+data.tables.map(t=>`<div class="qr-card"><h2>${esc(t.table_no)} 桌</h2><img class="qr" src="${esc(t.qr)}" alt="${esc(t.table_no)}桌二维码"><p>扫码点餐 · 餐后结账</p><p class="small">${esc(t.url)}</p></div>`).join('');
 }
 subtitle.textContent='店员接单 · 更新于 '+new Date().toLocaleTimeString();
}
modal.addEventListener('close',()=>{selectedTable=null;detailSignature='';});
document.addEventListener('submit',async e=>{
 e.preventDefault();const f=e.target,b=f.querySelector('button[type="submit"]')||f.querySelector('button');b.disabled=true;
 try{if(f.id==='dish-setup'){
  const variants=[...f.querySelectorAll('.edit-variant')].map(row=>({id:Number(row.dataset.sku),name:row.querySelector('[name="size-name"]').value,price:row.querySelector('[name="size-price"]').value,available:row.querySelector('[name="available"]').checked}));
  const tastes=Object.fromEntries([...f.querySelectorAll('[data-taste]')].map(row=>[row.dataset.taste,{enabled:row.querySelector('[name="enabled"]').checked,values:[...row.querySelectorAll('[name="choice"]:checked')].map(x=>x.value),default:row.querySelector('[name="taste-default"]').value}]));
  await api('product_setup',{product_id:Number(f.dataset.productId),name:f.querySelector('[name="dish-name"]').value,variants,default_index:Number(f.querySelector('[name="default-size"]:checked')?.value||0),tastes});modal.close();await staffLoad();message('菜品设置已保存');
 }else if(f.id==='login'){csrf=(await api('login',{password:f.querySelector('input').value})).csrf;view='board';await staffLoad();message('已登录。顾客扫码即可点餐。');}
 else if(f.classList.contains('product-form')){await api('product',{sku_id:Number(f.dataset.sku),price:f.elements.price.value,available:f.elements.available.checked});message('菜品已保存');}}
 catch(err){message(err.message);}finally{b.disabled=false;}
});
document.addEventListener('input',e=>{if(e.target.id==='note'){note=e.target.value;saveCart();}});
document.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b||b.disabled)return;
 try{
  if(b.dataset.editProduct){editProduct(b.dataset.editProduct);}
  else if(b.id==='add-variant'){const list=document.querySelector('#variant-list');if(list.children.length>=12){message('最多12个份量');return;}list.insertAdjacentHTML('beforeend',variantRow({id:0,size:'',price:0,stock_num:9999},list.children.length,false));}
  else if(b.dataset.product){chooseSize(b.dataset.product);}
  else if(b.id==='view-cart'){showCart();}
  else if(b.id==='add-selection'){
   const radio=modalContent.querySelector('input[name="portion"]:checked');if(!radio)return;
   const values=Object.keys(tasteChoices).map(k=>document.querySelector('#taste-'+k)?.value||'default');
   const key=radio.value+(values.some(v=>v!=='default')?'~'+values.join('~'):'');
   const total=cartLines().filter(i=>Number(i.id)===Number(radio.value)).reduce((n,i)=>n+i.qty,0);
   if(total>=50){message('同一规格最多50份');return;}
   cart[key]=(cart[key]||0)+1;saveCart();modal.close();optionProduct=null;renderGuest();message('已加入，可以继续点菜');
  }
  else if(b.dataset.cartKey){const key=b.dataset.cartKey,delta=Number(b.dataset.delta);const id=Number(key.split('~')[0]);
   if(delta>0&&cartLines().filter(i=>Number(i.id)===id).reduce((n,i)=>n+i.qty,0)>=50){message('同一规格最多50份');return;}
   cart[key]=Math.max(0,(cart[key]||0)+delta);if(!cart[key])delete cart[key];saveCart();renderGuest();showCart();
  }
  else if(b.id==='modal-close'){modal.close();optionProduct=null;selectedTable=null;}
  else if(b.dataset.table){showTable(b.dataset.table);}
  else if(b.dataset.category){category=b.dataset.category;renderGuest();}
  else if(b.dataset.guest){view=b.dataset.guest;if(view==='orders')await guestLoad();else renderGuest();}
  else if(b.id==='submit')await submit();
  else if(b.dataset.view){message('');view=b.dataset.view;selectedTable=null;modal.close();await staffLoad();}
  else if(b.id==='sound'){audio ||= new (window.AudioContext||window.webkitAudioContext)();await audio.resume();b.textContent='声音已开启';message('页面打开时可响铃；手机锁屏后可能暂停。');}
  else if(b.id==='logout'){await api('logout',{});csrf='';login();}
  else if(b.dataset.close){if(!confirm('客人已付款并离店？\n本桌合计 ¥'+b.dataset.total+'。确认清台后，下一批客人重新记单。'))return;b.disabled=true;await api('close',{table:b.dataset.close,session_id:b.dataset.session,expected_total:b.dataset.total});selectedTable=null;modal.close();await staffLoad();message('已清台，下批客人扫码即可点餐。');}
  else if(b.dataset.state){b.disabled=true;await api('state',{order_id:Number(b.dataset.order),state:b.dataset.state});await staffLoad();message(b.dataset.state==='ready'?'已上齐，订单已收起。误点可从本桌“已上齐”恢复。':'已恢复待上菜');}
  else if(b.id==='print')window.print();
 }catch(err){b.disabled=false;message(err.message);}
});
let polling=false;
async function poll(){
 if(polling||document.hidden)return;polling=true;
 try{if(staff&&csrf&&view==='board'){await staffLoad();if(status.textContent.startsWith('连接中断'))message('连接已恢复，订单已补查');}
 else if(!staff&&view==='orders'&&sid&&!submitting){const r=await api('orders',null,{table,session_id:sid});orders=r.orders;renderGuest();}}
 catch(e){message('连接中断或状态变化：'+e.message+'；请检查网络或刷新。');}finally{polling=false;}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});setInterval(poll,5000);
(async()=>{try{if(staff){try{const r=await api('who');csrf=r.csrf;document.querySelector('h1').textContent=r.name;await staffLoad();}catch{login();subtitle.textContent='店员接单';}}else{view='menu';if(!table){app.innerHTML='<p class="notice">请扫描桌上的二维码进入点餐。店员请打开 /dining/staff.html。</p>';subtitle.textContent='请扫码入桌';return;}await guestLoad(true);}}catch(e){message(e.message);}})();
