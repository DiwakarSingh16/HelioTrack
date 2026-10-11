const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const state = {
  source: localStorage.getItem('helio-source') || 'demo',
  metric: 'power', timer: null, points: [], config: JSON.parse(localStorage.getItem('helio-config') || '{}'),
  data: { angle:124.8, sunAngle:128.1, voltage:18.6, current:.99, lux:87200, temperature:32.4 }
};
const alerts = [
  ['✓','Optimal alignment reached','Panel is within 3.3° of the sun','Now'],
  ['↗','Output climbed 8.2%','Sunlight intensity increased','18 min'],
  ['↻','Daily calibration complete','Angle sensor zero-point verified','2 hr']
];
const colors = {power:'#45e7c3',lux:'#ffc65a',temperature:'#ff826f',voltage:'#9e74ff'};

function initHistory(){
  const now=Date.now();
  state.points=Array.from({length:48},(_,i)=>{
    const phase=i/47*Math.PI;
    const sun=Math.max(0,Math.sin(phase));
    return {t:now-(47-i)*5*60000,power:+(2+20*sun+Math.sin(i*.8)*.7).toFixed(2),lux:+(8+86*sun+Math.sin(i*.5)*2).toFixed(1),temperature:+(24+10*sun+Math.sin(i*.24)).toFixed(1),voltage:+(14+5*sun+Math.sin(i)*.15).toFixed(2)};
  });
}

function normalized(payload){
  return {
    angle:+(payload.angle ?? payload.field1 ?? state.data.angle),
    sunAngle:+(payload.sunAngle ?? payload.field2 ?? state.data.sunAngle),
    voltage:+(payload.voltage ?? payload.field3 ?? state.data.voltage),
    current:+(payload.current ?? payload.field4 ?? state.data.current),
    lux:+(payload.lux ?? payload.field5 ?? state.data.lux),
    temperature:+(payload.temperature ?? payload.field6 ?? state.data.temperature)
  };
}

function applyData(raw){
  const d=normalized(raw); if(Object.values(d).some(Number.isNaN)) return;
  d.angle=clamp(d.angle,0,180); d.sunAngle=clamp(d.sunAngle,0,180);
  state.data=d; const power=d.voltage*d.current;
  $('#angleValue').textContent=`${d.angle.toFixed(1)}°`; $('#sunValue').textContent=`${d.sunAngle.toFixed(1)}°`;
  $('#errorValue').textContent=`${Math.abs(d.sunAngle-d.angle).toFixed(1)}°`; $('#voltageValue').textContent=d.voltage.toFixed(1);
  $('#powerValue').textContent=power.toFixed(1); $('#luxValue').textContent=(d.lux/1000).toFixed(1); $('#tempValue').textContent=d.temperature.toFixed(1);
  const pct=d.angle/180*100; $('#axisFill').style.width=`${pct}%`; $('#axisKnob').style.left=`${pct}%`;
  $('#panelRig').style.transform=`translateX(-50%) rotate(${d.angle-90}deg)`;
  const sunX=9+d.sunAngle/180*80, sunY=115-Math.sin(d.sunAngle/180*Math.PI)*95; $('#sunDot').style.left=`${sunX}%`; $('#sunDot').style.top=`${sunY}px`;
  $('#updatedAt').textContent='Updated now'; $('#syncValue').textContent='Now';
  const p={t:Date.now(),power:+power.toFixed(2),lux:+(d.lux/1000).toFixed(1),temperature:d.temperature,voltage:d.voltage};
  state.points.push(p); if(state.points.length>288)state.points.shift();
  drawAll(); updateKpis();
}

function simulate(){
  const prev=state.data, drift=(scale)=> (Math.random()-.48)*scale;
  const sun=clamp(prev.sunAngle+drift(.25),0,180); const angle=clamp(prev.angle+(sun-prev.angle)*.18+drift(.18),0,180);
  const intensity=clamp(prev.lux+drift(1500),45000,99000); const voltage=clamp(16+intensity/35000+drift(.16),0,22);
  applyData({angle,sunAngle:sun,voltage,current:clamp(.72+intensity/320000+drift(.025),0,1.5),lux:intensity,temperature:clamp(prev.temperature+drift(.14),22,45)});
}

async function pollWifi(){
  try{const r=await fetch(state.config.wifiUrl,{cache:'no-store'});if(!r.ok)throw Error(`HTTP ${r.status}`);applyData(await r.json());setConnected('Wi-Fi');}
  catch(e){showToast(`Wi-Fi read failed: ${e.message}`);stopStream();setConnected('Offline',false)}
}
async function pollThingSpeak(){
  const id=state.config.channelId,key=state.config.readKey; if(!id)return;
  const url=`https://api.thingspeak.com/channels/${encodeURIComponent(id)}/feeds/last.json${key?`?api_key=${encodeURIComponent(key)}`:''}`;
  try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error(`HTTP ${r.status}`);applyData(await r.json());setConnected('ThingSpeak');}
  catch(e){showToast(`ThingSpeak read failed: ${e.message}`);stopStream();setConnected('Offline',false)}
}
function stopStream(){if(state.timer)clearInterval(state.timer);state.timer=null}
function startSource(source){
  stopStream(); state.source=source; localStorage.setItem('helio-source',source);
  if(source==='demo'){setConnected('Demo');simulate();state.timer=setInterval(simulate,2800)}
  if(source==='wifi'){pollWifi();state.timer=setInterval(pollWifi,Math.max(1000,+state.config.pollMs||3000))}
  if(source==='thingspeak'){pollThingSpeak();state.timer=setInterval(pollThingSpeak,Math.max(15000,+state.config.pollMs||15000))}
  $$('.source-card').forEach(b=>b.classList.toggle('active',b.dataset.source===source));
}
function setConnected(name,ok=true){$('#liveLabel').textContent=`${ok?'LIVE':'OFFLINE'} · ${name.toUpperCase()}`;$('#sideStatus').textContent=ok?`${name} stream`:'Not connected';$('.live-pill i').style.background=ok?'var(--cyan)':'var(--coral)'}

function canvasSize(canvas){const r=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);canvas.width=r.width*dpr;canvas.height=r.height*dpr;const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);return {c,w:r.width,h:r.height}}
function plotLine(canvas,data,color,fill=true,opts={}){
  if(!canvas||!data.length)return; const {c,w,h}=canvasSize(canvas),pad=opts.pad??26;
  c.clearRect(0,0,w,h); const values=data.map(Number),min=opts.min??Math.min(...values)*.93,max=opts.max??(Math.max(...values)*1.05||1);
  if(opts.grid){c.strokeStyle='rgba(210,255,240,.07)';c.lineWidth=1;for(let i=0;i<5;i++){let y=pad+(h-pad*1.7)*i/4;c.beginPath();c.moveTo(pad,y);c.lineTo(w-8,y);c.stroke()}}
  const pts=values.map((v,i)=>({x:pad+(w-pad-9)*i/Math.max(1,values.length-1),y:pad/2+(h-pad*1.35)*(1-(v-min)/(max-min||1))}));
  if(fill){const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,color+'35');g.addColorStop(1,color+'00');c.beginPath();c.moveTo(pts[0].x,h-pad/2);pts.forEach(p=>c.lineTo(p.x,p.y));c.lineTo(pts.at(-1).x,h-pad/2);c.closePath();c.fillStyle=g;c.fill()}
  c.beginPath();pts.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.strokeStyle=color;c.lineWidth=opts.width||2;c.lineJoin='round';c.lineCap='round';c.stroke();return {pts,min,max,pad,w,h};
}
function drawMain(){const data=state.points.slice(-48),metric=state.metric,canvas=$('#mainChart');plotLine(canvas,data.map(x=>x[metric]),colors[metric],true,{grid:true,pad:27});drawAxes(canvas,data,metric)}
function drawAxes(canvas,data,metric){const {c,w,h}=canvasSize(canvas),color=colors[metric],vals=data.map(d=>d[metric]),min=Math.min(...vals)*.93,max=Math.max(...vals)*1.05||1,pad=27;c.strokeStyle='rgba(210,255,240,.07)';for(let i=0;i<5;i++){let y=pad+(h-pad*1.7)*i/4;c.beginPath();c.moveTo(pad,y);c.lineTo(w-8,y);c.stroke()}const pts=vals.map((v,i)=>({x:pad+(w-pad-9)*i/(vals.length-1),y:pad/2+(h-pad*1.35)*(1-(v-min)/(max-min||1))}));const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,color+'35');g.addColorStop(1,color+'00');c.beginPath();c.moveTo(pts[0].x,h-pad/2);pts.forEach(p=>c.lineTo(p.x,p.y));c.lineTo(pts.at(-1).x,h-pad/2);c.fillStyle=g;c.fill();c.beginPath();pts.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.strokeStyle=color;c.lineWidth=2;c.stroke();c.fillStyle='#6e8a80';c.font='8px DM Mono';c.textAlign='center';[0,.25,.5,.75,1].forEach(fr=>{const ix=Math.round(fr*(data.length-1));c.fillText(new Date(data[ix].t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),pad+(w-pad-9)*fr,h-3)})}
function drawAnalytics(){const canvas=$('#analyticsChart'),data=state.points.slice(-72),{c,w,h}=canvasSize(canvas),pad=28;c.clearRect(0,0,w,h);c.strokeStyle='rgba(210,255,240,.07)';for(let i=0;i<6;i++){const y=pad+(h-pad*1.7)*i/5;c.beginPath();c.moveTo(pad,y);c.lineTo(w-8,y);c.stroke()}[['power',24],['lux',100],['temperature',45]].forEach(([key,max])=>{const pts=data.map((v,i)=>({x:pad+(w-pad-9)*i/(data.length-1),y:pad/2+(h-pad*1.35)*(1-v[key]/max)}));c.beginPath();pts.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.strokeStyle=colors[key];c.lineWidth=2;c.stroke()});c.fillStyle='#6e8a80';c.font='8px DM Mono';c.textAlign='center';[0,.25,.5,.75,1].forEach(fr=>{const ix=Math.round(fr*(data.length-1));c.fillText(new Date(data[ix].t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),pad+(w-pad-9)*fr,h-3)})}
function drawSparks(){[['powerSpark','power'],['luxSpark','lux'],['voltageSpark','voltage'],['tempSpark','temperature']].forEach(([id,key])=>plotLine($('#'+id),state.points.slice(-20).map(x=>x[key]),colors[key],true,{pad:1,width:1.5}))}
function drawAll(){drawMain();drawAnalytics();drawSparks()}
function updateKpis(){const pts=state.points,vals=pts.map(x=>x.power),peak=Math.max(...vals),avg=vals.reduce((a,b)=>a+b,0)/vals.length,energy=pts.slice(1).reduce((sum,p,i)=>sum+(p.power+pts[i].power)/2*(p.t-pts[i].t)/3600000,0);$('#peakValue').textContent=`${peak.toFixed(1)} W`;$('#avgValue').textContent=`${avg.toFixed(1)} W`;$('#energyValue').textContent=`${Math.max(0,energy).toFixed(0)} Wh`;$('#capturedKpi').textContent=`${Math.max(.01,energy/1000).toFixed(2)} kWh`;$('#accuracyKpi').textContent=`${clamp(100-Math.abs(state.data.sunAngle-state.data.angle)*.8,0,100).toFixed(1)}%`}

function renderBars(){const el=$('#hourlyBars'),vals=[8,14,29,52,76,92,100,88,67,38,16,7];el.innerHTML=vals.map((v,i)=>`<div class="bar-wrap" title="${v}% yield"><div class="bar" style="height:${v}%"></div><small>${i+7}</small></div>`).join('')}
function renderAlerts(){const el=$('#alertsList');el.innerHTML=alerts.length?alerts.map(a=>`<div class="alert"><i>${a[0]}</i><div><b>${a[1]}</b><small>${a[2]}</small></div><time>${a[3]}</time></div>`).join(''):'<p class="hint" style="padding:24px 0">No recent events.</p>'}
function renderSetup(source){
  const p=$('#setupPanel'),cfg=state.config;
  const templates={
    demo:`<div class="setup-head"><div><h2>Built-in simulator</h2><p>Realistic values update every few seconds so you can explore every screen.</p></div><span class="live-pill"><i></i> RUNNING</span></div><div class="setup-actions"><button class="primary-btn" data-start="demo">Restart simulation</button><span class="hint">No hardware required</span></div>`,
    wifi:`<div class="setup-head"><div><h2>ESP32 Wi-Fi endpoint</h2><p>Enter an HTTP(S) endpoint that returns the JSON payload shown below.</p></div></div><div class="form-grid"><div class="field full"><label>Endpoint URL</label><input id="wifiUrl" value="${cfg.wifiUrl||'http://192.168.4.1/data'}" placeholder="http://192.168.4.1/data"></div><div class="field"><label>Poll interval (ms)</label><input id="wifiPoll" type="number" min="1000" value="${cfg.pollMs||3000}"></div></div><div class="setup-actions"><button class="primary-btn" data-save="wifi">Connect over Wi-Fi</button><span class="hint">ESP32 must allow CORS; HTTPS pages require an HTTPS endpoint.</span></div>`,
    thingspeak:`<div class="setup-head"><div><h2>ThingSpeak channel</h2><p>Fields 1–6 map to angle, sun angle, voltage, current, lux, and temperature.</p></div></div><div class="form-grid"><div class="field"><label>Channel ID</label><input id="channelId" value="${cfg.channelId||''}" placeholder="1234567"></div><div class="field"><label>Read API key (optional for public channels)</label><input id="readKey" type="password" value="${cfg.readKey||''}" placeholder="••••••••••••••••"></div><div class="field"><label>Refresh interval (ms, min 15000)</label><input id="tsPoll" type="number" min="15000" value="${Math.max(15000,cfg.pollMs||15000)}"></div></div><div class="setup-actions"><button class="primary-btn" data-save="thingspeak">Connect to ThingSpeak</button><span class="hint">Uses the latest channel feed.</span></div>`,
    bluetooth:`<div class="setup-head"><div><h2>Web Bluetooth</h2><p>Pair directly with an ESP32 BLE service. Readings may be JSON text or comma-separated values.</p></div></div><div class="form-grid"><div class="field"><label>Service UUID</label><input id="serviceUuid" value="${cfg.serviceUuid||'4fafc201-1fb5-459e-8fcc-c5c9c331914b'}"></div><div class="field"><label>Characteristic UUID</label><input id="charUuid" value="${cfg.charUuid||'beb5483e-36e1-4688-b7f5-ea07361b26a8'}"></div></div><div class="setup-actions"><button class="primary-btn" data-save="bluetooth">Pair Bluetooth device</button><span class="hint">Supported in Chrome/Edge on Android and desktop.</span></div>`
  };p.innerHTML=templates[source];
}

async function connectBluetooth(){
  if(!navigator.bluetooth){showToast('Web Bluetooth is not supported in this browser.');return}
  try{
    const device=await navigator.bluetooth.requestDevice({filters:[{services:[state.config.serviceUuid]}]}); const server=await device.gatt.connect(); const svc=await server.getPrimaryService(state.config.serviceUuid); const ch=await svc.getCharacteristic(state.config.charUuid);
    await ch.startNotifications();ch.addEventListener('characteristicvaluechanged',e=>{const text=new TextDecoder().decode(e.target.value);try{applyData(JSON.parse(text))}catch{const v=text.split(',').map(Number);applyData({angle:v[0],sunAngle:v[1],voltage:v[2],current:v[3],lux:v[4],temperature:v[5]})}});state.source='bluetooth';setConnected('Bluetooth');showToast(`Connected to ${device.name||'ESP32'}`)
  }catch(e){showToast(`Bluetooth: ${e.message}`)}
}
function saveConfig(source){
  if(source==='wifi'){state.config.wifiUrl=$('#wifiUrl').value.trim();state.config.pollMs=+$('#wifiPoll').value||3000}
  if(source==='thingspeak'){state.config.channelId=$('#channelId').value.trim();state.config.readKey=$('#readKey').value.trim();state.config.pollMs=+$('#tsPoll').value||15000}
  if(source==='bluetooth'){state.config.serviceUuid=$('#serviceUuid').value.trim();state.config.charUuid=$('#charUuid').value.trim()}
  localStorage.setItem('helio-config',JSON.stringify(state.config));source==='bluetooth'?connectBluetooth():startSource(source)
}
function showView(name){$$('.view').forEach(v=>v.classList.toggle('active',v.id===name+'View'));$$('.nav-item').forEach(b=>{const on=b.dataset.view===name;b.classList.toggle('active',on);b.toggleAttribute('aria-current',on)});$('#pageTitle').textContent=name==='devices'?'Connections':name[0].toUpperCase()+name.slice(1);$('#sidebar').classList.remove('open');if(name==='analytics')setTimeout(drawAll,30)}
function showToast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._to);t._to=setTimeout(()=>t.classList.remove('show'),3600)}
function exportCsv(){const head='timestamp,power_w,lux_klx,temperature_c,voltage_v\n',rows=state.points.map(p=>`${new Date(p.t).toISOString()},${p.power},${p.lux},${p.temperature},${p.voltage}`).join('\n'),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([head+rows],{type:'text/csv'}));a.download=`heliotrack-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(a.href);showToast('CSV export downloaded')}

document.addEventListener('click',e=>{
  const nav=e.target.closest('.nav-item');if(nav)showView(nav.dataset.view);
  if(e.target.closest('[data-open-connect]')){$('#connectModal').classList.add('open');$('#connectModal').setAttribute('aria-hidden','false')}
  if(e.target.closest('#closeModal')||e.target===$('#connectModal')){$('#connectModal').classList.remove('open');$('#connectModal').setAttribute('aria-hidden','true')}
  const quick=e.target.closest('[data-quick-source]');if(quick){showView('devices');const s=quick.dataset.quickSource;renderSetup(s);$$('.source-card').forEach(b=>b.classList.toggle('active',b.dataset.source===s));$('#connectModal').classList.remove('open')}
  const card=e.target.closest('.source-card');if(card){renderSetup(card.dataset.source);$$('.source-card').forEach(b=>b.classList.toggle('active',b===card))}
  const save=e.target.closest('[data-save]');if(save)saveConfig(save.dataset.save);
  const start=e.target.closest('[data-start]');if(start){startSource(start.dataset.start);showToast('Simulator restarted')}
  const metric=e.target.closest('[data-metric]');if(metric){state.metric=metric.dataset.metric;$$('[data-metric]').forEach(b=>b.classList.toggle('active',b===metric));drawMain()}
});
$('#menuBtn').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));$('#themeBtn').addEventListener('click',()=>document.body.classList.toggle('high-contrast'));$('#exportBtn').addEventListener('click',exportCsv);$('#clearAlerts').addEventListener('click',()=>{alerts.length=0;renderAlerts()});window.addEventListener('resize',()=>requestAnimationFrame(drawAll));
$('#mainChart').addEventListener('mousemove',e=>showChartTip(e,$('#mainChart'),$('#chartTooltip'),state.metric));$('#mainChart').addEventListener('mouseleave',()=>$('#chartTooltip').style.display='none');
function showChartTip(e,canvas,tip,key){const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,idx=clamp(Math.round((x-27)/(r.width-36)*(Math.min(48,state.points.length)-1)),0,Math.min(48,state.points.length)-1),data=state.points.slice(-48)[idx];if(!data)return;const units={power:'W',lux:'klx',temperature:'°C'};tip.textContent=`${new Date(data.t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · ${data[key].toFixed(1)} ${units[key]}`;tip.style.left=`${clamp(x,20,r.width-115)}px`;tip.style.top='28px';tip.style.display='block'}

initHistory();renderBars();renderAlerts();renderSetup(state.source);startSource(state.source);drawAll();updateKpis();
