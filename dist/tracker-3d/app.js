import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

const $ = (selector, root = document) => root.querySelector(selector);
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const fields = [
  {key:'field1',name:'LDR 1',min:0,max:4095,unit:'ADC',color:'#48c8ff',icon:'◉'},
  {key:'field2',name:'LDR 2',min:0,max:4095,unit:'ADC',color:'#a98aff',icon:'◉'},
  {key:'field3',name:'Servo Motor Angle',min:0,max:180,unit:'°',color:'#64e3c6',icon:'↗'},
  {key:'field4',name:'Solar panel temperature',min:0,max:100,unit:'°C',color:'#ffb85e',icon:'⌁'},
  {key:'field5',name:'Gyroscope X',min:-2,max:2,unit:'',color:'#6dd5bc',icon:'X'},
  {key:'field6',name:'Gyroscope Y',min:-2,max:2,unit:'',color:'#8fe0cf',icon:'Y'},
  {key:'field7',name:'Gyroscope Z',min:-2,max:2,unit:'',color:'#ff8b7d',icon:'Z'},
  {key:'field8',name:'Acceleration magnitude',min:0,max:20,unit:'m/s²',color:'#e599ff',icon:'↟'}
];
const components = [
  {id:'array',name:'Photovoltaic array',type:'PRIMARY GENERATION',desc:'Multi-cell module on a tilting single-axis mount.',code:'01'},
  {id:'ldr1',name:'LDR 1',type:'LIGHT SENSOR · A',desc:'First photoresistor for differential light sensing.',code:'02'},
  {id:'ldr2',name:'LDR 2',type:'LIGHT SENSOR · B',desc:'Second photoresistor paired with LDR 1.',code:'03'},
  {id:'servo',name:'Servo drive',type:'ACTUATOR',desc:'Servo motor provides the panel tracking torque.',code:'04'},
  {id:'shaft',name:'Torque tube',type:'SINGLE-AXIS SHAFT',desc:'Rotating tube carries the array through its tracking arc.',code:'05'},
  {id:'thermal',name:'Temperature probe',type:'PANEL SENSOR',desc:'Probe fixed to the rear of the solar panel.',code:'06'},
  {id:'imu',name:'Gyroscope / IMU',type:'3-AXIS INERTIAL UNIT',desc:'Measures X, Y and Z rotation on the moving frame.',code:'07'},
  {id:'accel',name:'Accelerometer',type:'LINEAR MOTION SENSOR',desc:'Reads acceleration magnitude on the tracking assembly.',code:'08'}
];
const demoReadings = {field1:1650,field2:2380,field3:95,field4:31.2,field5:.12,field6:-.08,field7:.04,field8:9.76};
const state = {
  config: readConfig(), raw:{}, values:{}, connected:false, demo:false, tracking:true,
  labels:true, tilt:0, timer:null, lastUpdated:null, selected:'array',
  history:[],historyChannel:'',pollBusy:false,sunHour:9,sunPlaying:true,sunTarget:0,sunDirection:null,lastDemoStore:0
};

function readConfig(){try{return JSON.parse(localStorage.getItem('helio-config')||'{}')}catch{return {}}}
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(el._timer);el._timer=setTimeout(()=>el.classList.remove('show'),3200)}
function historyStorageKey(channel){return `helio-lab-history:${encodeURIComponent(channel)}`}
function loadHistory(channel){try{const stored=JSON.parse(localStorage.getItem(historyStorageKey(channel))||'[]');return Array.isArray(stored)?stored:[]}catch{return []}}
function saveHistory(){if(!state.historyChannel)return;try{localStorage.setItem(historyStorageKey(state.historyChannel),JSON.stringify(state.history.slice(-3000)))}catch{toast('Browser storage is full; older history remains available from ThingSpeak.')}}
function normalizeFeed(feed){
  const time=Date.parse(feed.created_at||'');if(!Number.isFinite(time))return null;
  const sample={id:String(feed.entry_id??time),time};for(const field of fields){const value=feed[field.key];sample[field.key]=value==null||value===''?null:Number(value)}
  if(!fields.some(field=>Number.isFinite(sample[field.key])))return null;return sample;
}
function mergeHistory(feeds){
  const entries=new Map(state.history.map(sample=>[sample.id,sample]));
  for(const feed of feeds){const sample=normalizeFeed(feed);if(sample)entries.set(sample.id,sample)}
  state.history=[...entries.values()].sort((a,b)=>a.time-b.time).slice(-3000);saveHistory();drawHistory();
}
function filteredHistory(){
  const span=Number($('#rangeSelect').value),latest=state.history.at(-1)?.time||Date.now();
  return span?state.history.filter(sample=>sample.time>=latest-span):state.history;
}
function drawChart(canvas,series,rows,min,max){
  const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
  const dpr=Math.min(devicePixelRatio||1,2),w=rect.width,h=rect.height;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const left=38,right=10,top=12,bottom=22,plotW=w-left-right,plotH=h-top-bottom;
  ctx.font='7px DM Mono, monospace';ctx.textAlign='right';ctx.textBaseline='middle';
  for(let i=0;i<=4;i++){const y=top+plotH*i/4;ctx.strokeStyle='#283541';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.fillStyle='#647683';const value=max-(max-min)*i/4;ctx.fillText(Math.abs(value)>=100?value.toFixed(0):value.toFixed(1),left-6,y)}
  if(!rows.length)return;
  const first=rows[0].time,last=rows.at(-1).time,range=Math.max(1,last-first);
  ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.fillStyle='#627480';
  for(let i=0;i<=3;i++){const x=left+plotW*i/3;const time=first+range*i/3;ctx.fillText(new Date(time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),x,h-5)}
  series.forEach((item,index)=>{
    const points=rows.map((row,i)=>{const value=row[item.key]==null?NaN:Number(row[item.key]);return {x:left+plotW*(row.time-first)/range,y:top+plotH*(1-(value-min)/(max-min||1)),value,i}}).filter(point=>Number.isFinite(point.value));if(!points.length)return;
    if(index===0&&series.length===1&&points.length>1){const fill=ctx.createLinearGradient(0,top,0,top+plotH);fill.addColorStop(0,`${item.color}35`);fill.addColorStop(1,`${item.color}00`);ctx.beginPath();ctx.moveTo(points[0].x,top+plotH);for(const point of points)ctx.lineTo(point.x,point.y);ctx.lineTo(points.at(-1).x,top+plotH);ctx.closePath();ctx.fillStyle=fill;ctx.fill()}
    ctx.beginPath();points.forEach((point,i)=>i?ctx.lineTo(point.x,point.y):ctx.moveTo(point.x,point.y));ctx.strokeStyle=item.color;ctx.lineWidth=1.8;ctx.lineJoin='round';ctx.lineCap='round';ctx.shadowColor=`${item.color}55`;ctx.shadowBlur=5;ctx.stroke();ctx.shadowBlur=0;
    const point=points.at(-1);ctx.beginPath();ctx.arc(point.x,point.y,2.4,0,Math.PI*2);ctx.fillStyle=item.color;ctx.fill();
  });
}
function drawHistory(){
  if(!$('#historyCanvas'))return;const rows=filteredHistory(),selected=fields.find(field=>field.key===$('#fieldSelect').value)||fields[0];
  $('#storedCount').textContent=state.history.length.toLocaleString();$('#historyUpdated').textContent=state.history.length?new Date(state.history.at(-1).time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'—';$('#activeSensor').textContent=selected.name;$('#fieldLegend').textContent=selected.name;$('#sampleLegend').textContent=`${rows.length} samples`;
  const empty=rows.length===0;$('#historyEmpty').classList.toggle('visible',empty);$('#lightEmpty').classList.toggle('visible',empty);$('#motionEmpty').classList.toggle('visible',empty);
  drawChart($('#historyCanvas'),[{key:selected.key,color:selected.color}],rows,selected.min,selected.max);
  drawChart($('#lightCanvas'),[{key:'field1',color:'#48c8ff'},{key:'field2',color:'#a98aff'}],rows,0,4095);
  drawChart($('#motionCanvas'),[{key:'field5',color:'#6dd5bc'},{key:'field6',color:'#a98aff'},{key:'field7',color:'#ff8b7d'}],rows,-2,2);
}
function gaugeMarkup(field,index){
  return `<article class="gauge-card" style="--gauge:${field.color};--glow:${field.color}80" aria-label="${field.name} speedometer">
    <span class="gauge-title">${field.name}</span><span class="gauge-icon">${field.icon}</span>
    <svg class="speedometer" viewBox="0 0 112 82" aria-hidden="true">
      <path class="gauge-track" pathLength="100" d="M14 64 A42 42 0 0 1 98 64"/>
      <path class="gauge-value-arc" id="arc${index}" pathLength="100" d="M14 64 A42 42 0 0 1 98 64"/>
      <path class="gauge-tick" d="M16 56l5 2M24 37l5 3M39 22l3 5M56 18v6M73 22l-3 5M88 37l-5 3M96 56l-5 2"/>
      <line class="gauge-needle" id="needle${index}" x1="56" y1="64" x2="56" y2="29"/>
      <circle class="gauge-hub" cx="56" cy="64" r="4"/>
    </svg>
    <div class="gauge-reading"><span id="value${index}">—</span><span class="gauge-unit">${field.unit}</span></div>
    <div class="gauge-range"><span>${field.min}</span><span>${field.max}</span></div>
  </article>`;
}
$('#gaugeGrid').innerHTML=fields.map(gaugeMarkup).join('');
$('#fieldSelect').innerHTML=fields.map(field=>`<option value="${field.key}">${field.name}</option>`).join('');

function updateGauges(payload){
  state.raw={...state.raw,...payload};
  fields.forEach((field,index)=>{
    const raw=state.raw[field.key];
    if(raw===undefined||raw===null||raw==='')return;
    const value=Number(raw);if(!Number.isFinite(value))return;
    state.values[field.key]=value;
    const pct=clamp((value-field.min)/(field.max-field.min)*100,0,100);
    const arc=$(`#arc${index}`),needle=$(`#needle${index}`),reading=$(`#value${index}`);
    arc.style.strokeDasharray=`${pct} 100`;
    needle.style.transform=`rotate(${-90+pct*1.8}deg)`;
    reading.textContent=Math.abs(value)>=100?value.toFixed(0):value.toFixed(2).replace(/\.00$/,'');
  });
  if(Object.hasOwn(payload,'field3')){
    const servo=Number(payload.field3);if(Number.isFinite(servo)){
      $('#angleReadout').innerHTML=`${servo.toFixed(1)}<small>°</small>`;
      $('#driveAngle').textContent=`${servo.toFixed(0)}°`;
      if(state.tracking){state.tilt=clamp((servo-90)*.67,-60,60);$('#tiltSlider').value=state.tilt;$('#tiltValue').textContent=`${state.tilt.toFixed(0)}°`}
    }
  }
  if(Object.hasOwn(payload,'field5')||Object.hasOwn(payload,'field6')||Object.hasOwn(payload,'field7'))$('#imuStatus').textContent='LIVE · 3 AXIS';
  state.lastUpdated=new Date();$('#lastUpdated').textContent=state.lastUpdated.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  $('#feedAge').textContent='JUST NOW';
  updateSceneReadouts();
}

async function pollChannel(includeHistory=false){
  if(state.pollBusy)return;
  const config=readConfig(),channelId=(config.channelId||'').trim(),key=(config.readKey||'').trim();
  if(!channelId){setConnection('AWAITING TELEMETRY',false);$('#feedLabel').textContent='Set up your ThingSpeak link';return}
  state.pollBusy=true;
  try{
    const params=new URLSearchParams();if(key)params.set('api_key',key);if(includeHistory)params.set('results','200');
    const endpoint=includeHistory?'feeds.json':'feeds/last.json';const url=`https://api.thingspeak.com/channels/${encodeURIComponent(channelId)}/${endpoint}${params.size?`?${params}`:''}`;
    const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const data=await response.json();if(data.error)throw new Error(data.error);
    const feeds=includeHistory?(data.feeds||[]):[data];if(!feeds.length||!Object.hasOwn(feeds.at(-1),'field1'))throw new Error('No sensor fields returned. Check the channel settings.');
    state.demo=false;state.connected=true;state.config=config;mergeHistory(feeds);const latest=feeds.at(-1);updateGauges(latest);setConnection('THINGSPEAK · LIVE',true);
    $('#feedLabel').textContent='Latest channel feed';$('#sceneMode').textContent='LIVE MODEL';$('#driveStatus').textContent='TELEMETRY LINK';
  }catch(error){state.connected=false;setConnection('LINK INTERRUPTED',false);$('#feedLabel').textContent='Could not read channel';toast(`ThingSpeak: ${error.message}`)}finally{state.pollBusy=false}
}
function setConnection(label,connected){
  $('#connectionStatus').textContent=label;$('.signal-dot').style.background=connected?'#54e4c5':'#e7a655';$('.signal-dot').style.boxShadow=connected?'0 0 12px #54e4c580':'0 0 12px #e7a65560';$('.live-indicator').style.background=connected?'#54e4c5':'#e9a65e';
}
function connect(){
  clearInterval(state.timer);const channel=(readConfig().channelId||'').trim();state.demo=false;state.connected=false;
  if(!channel){setConnection('AWAITING TELEMETRY',false);$('#feedLabel').textContent='Set up your ThingSpeak link';return}
  if(state.historyChannel!==channel){state.historyChannel=channel;state.history=loadHistory(channel);state.raw={};state.values={};fields.forEach((field,index)=>{$(`#value${index}`).textContent='—';$(`#arc${index}`).style.strokeDasharray='0 100'});drawHistory()}
  pollChannel(state.history.length===0);state.timer=setInterval(()=>pollChannel(false),15000);
}

$('#componentList').innerHTML=components.map(component=>`<button class="component-item${component.id==='array'?' active':''}" data-focus="${component.id}"><span class="comp-index">${component.code}</span><span class="comp-copy"><b>${component.name}</b><small>${component.type}</small></span><i class="comp-led"></i></button>`).join('');
function selectComponent(id){
  const component=components.find(item=>item.id===id);if(!component)return;state.selected=id;
  $$('.component-item').forEach(button=>button.classList.toggle('active',button.dataset.focus===id));
  $('#focusName').textContent=component.name;$('#focusDesc').textContent=component.desc;
  const target=focusPoints[id]||new THREE.Vector3(0,2,0);controls.target.copy(target);camera.position.set(target.x+6,target.y+4.4,target.z+7);controls.update();
  const object=focusObjects[id];if(object){object.traverse(child=>{if(child.material?.emissive){child.material.emissive.set('#155b56');setTimeout(()=>child.material.emissive?.set('#000000'),500)}})}
}

// Three.js scene: a real perspective model with a mechanically rotating panel assembly.
const sceneHost=$('#scene');
const scene=new THREE.Scene();scene.background=new THREE.Color('#91b3c3');scene.fog=new THREE.FogExp2('#91b3c3',.018);
const camera=new THREE.PerspectiveCamera(37,1,.1,100);camera.position.set(8.5,6.5,10.5);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.3;renderer.outputColorSpace=THREE.SRGBColorSpace;sceneHost.appendChild(renderer.domElement);
const labelRenderer=new CSS2DRenderer();labelRenderer.domElement.className='label-layer';sceneHost.appendChild(labelRenderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.06;controls.minDistance=6;controls.maxDistance=21;controls.maxPolarAngle=Math.PI*.47;controls.target.set(0,2,0);
scene.add(new THREE.HemisphereLight('#f3fbff','#546b61',3.1));
const keyLight=new THREE.DirectionalLight('#fff6e8',4.2);keyLight.position.set(-5,9,6);keyLight.castShadow=true;keyLight.shadow.mapSize.set(1024,1024);keyLight.shadow.camera.left=-9;keyLight.shadow.camera.right=9;keyLight.shadow.camera.top=9;keyLight.shadow.camera.bottom=-9;scene.add(keyLight);
const fillLight=new THREE.PointLight('#46dfc4',32,14);fillLight.position.set(5,4,-3);scene.add(fillLight);
const sunLight=new THREE.DirectionalLight('#ffe0a2',3.3);sunLight.castShadow=true;sunLight.shadow.mapSize.set(1024,1024);sunLight.shadow.camera.left=-9;sunLight.shadow.camera.right=9;sunLight.shadow.camera.top=9;sunLight.shadow.camera.bottom=-9;scene.add(sunLight);
const sunBall=new THREE.Mesh(new THREE.SphereGeometry(.18,18,12),new THREE.MeshBasicMaterial({color:'#ffd585'}));scene.add(sunBall);
const sunHalo=new THREE.Mesh(new THREE.SphereGeometry(.34,18,12),new THREE.MeshBasicMaterial({color:'#ffbd67',transparent:true,opacity:.14}));scene.add(sunHalo);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(80,80),new THREE.MeshStandardMaterial({color:'#82958a',roughness:.88,metalness:.03}));floor.rotation.x=-Math.PI/2;floor.position.y=-.02;floor.receiveShadow=true;scene.add(floor);
const grid=new THREE.GridHelper(34,34,'#65838a','#91a6a0');grid.position.y=.008;grid.material.transparent=true;grid.material.opacity=.2;scene.add(grid);
const centerGlow=new THREE.Mesh(new THREE.CircleGeometry(6.7,60),new THREE.MeshBasicMaterial({color:'#74d8c7',transparent:true,opacity:.055,depthWrite:false}));centerGlow.rotation.x=-Math.PI/2;centerGlow.position.y=.015;scene.add(centerGlow);
const metal=new THREE.MeshStandardMaterial({color:'#677985',metalness:.82,roughness:.25});
const darkMetal=new THREE.MeshStandardMaterial({color:'#273640',metalness:.78,roughness:.32});
const frameMat=new THREE.MeshStandardMaterial({color:'#52717c',metalness:.72,roughness:.3,emissive:'#071416'});
const cellMat=new THREE.MeshStandardMaterial({color:'#123858',metalness:.42,roughness:.28,emissive:'#0b3f70',emissiveIntensity:.26});
const glassMat=new THREE.MeshPhysicalMaterial({color:'#216c92',metalness:.48,roughness:.14,clearcoat:.85,clearcoatRoughness:.16,emissive:'#0a3553',emissiveIntensity:.22});
const sensorMat=new THREE.MeshStandardMaterial({color:'#f2b65d',metalness:.28,roughness:.35,emissive:'#e1963a',emissiveIntensity:.35});
const whiteSensorMat=new THREE.MeshStandardMaterial({color:'#a0d8e6',metalness:.4,roughness:.28,emissive:'#42a3c5',emissiveIntensity:.22});
const world=new THREE.Group();scene.add(world);
const focusObjects={},focusPoints={};
function track(id,object,target){focusObjects[id]=object;focusPoints[id]=target;}
function box(parent,size,position,material,cast=true){const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),material);mesh.position.set(...position);mesh.castShadow=cast;mesh.receiveShadow=true;parent.add(mesh);return mesh}
function cylinder(parent,r1,r2,length,position,material,axis='y'){const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,length,24),material);mesh.position.set(...position);if(axis==='x')mesh.rotation.z=Math.PI/2;if(axis==='z')mesh.rotation.x=Math.PI/2;mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh}
function addLabel(parent,text,position){const el=document.createElement('div');el.className='component-label';el.textContent=text;const label=new CSS2DObject(el);label.position.set(...position);parent.add(label);return label}

// Ground footing and fixed mast.
const baseGroup=new THREE.Group();world.add(baseGroup);
const foundation=box(baseGroup,[7.8,.24,6.3],[0,.16,0],darkMetal);foundation.material.emissive=new THREE.Color('#061018');
box(baseGroup,[6.8,.12,5.25],[0,.34,0],frameMat);
for(const x of [-2.25,2.25]){
  box(baseGroup,[.3,1.62,.3],[x,1.19,0],metal);
  box(baseGroup,[.65,.22,.66],[x,.55,0],darkMetal);
  cylinder(baseGroup,.14,.14,.3,[x,2.0,0],frameMat,'x');
  for(const z of [-2.2,2.2]){const brace=box(baseGroup,[.12,1.5,.12],[x*.84,1.05,z*.7],darkMetal);brace.rotation.z=x>0?-.35:.35;}
}
for(const x of [-3.1,3.1])cylinder(baseGroup,.17,.17,.22,[x,2.0,0],metal,'x');
const torqueTube=cylinder(baseGroup,.11,.11,7.1,[0,2.0,0],metal,'x');
addLabel(baseGroup,'TORQUE TUBE',[0,2.24,.08]);
track('shaft',baseGroup,new THREE.Vector3(0,2,0));

// Servo drive housing and coupling at the fixed end of the tracking axis.
const servoGroup=new THREE.Group();servoGroup.position.set(3.75,1.86,.12);world.add(servoGroup);
const servoBody=box(servoGroup,[.76,.54,.68],[0,0,0],darkMetal);servoBody.material.emissive=new THREE.Color('#09110f');
box(servoGroup,[.5,.13,.52],[0,.34,0],frameMat);
cylinder(servoGroup,.17,.17,.34,[-.44,0,0],metal,'x');
for(let y=-.16;y<=.16;y+=.16)for(let z=-.19;z<=.19;z+=.19)box(servoGroup,[.05,.07,.06],[.41,y,z],sensorMat,false);
addLabel(servoGroup,'SERVO DRIVE',[.03,.66,0]);track('servo',servoGroup,new THREE.Vector3(3.7,1.9,0));

// Moving single-axis assembly. Panel rotates around the X-aligned torque tube.
const tiltAssembly=new THREE.Group();tiltAssembly.position.set(0,2,0);world.add(tiltAssembly);
const panelRig=new THREE.Group();panelRig.position.y=.46;tiltAssembly.add(panelRig);
const panelFrame=box(panelRig,[6.35,.12,3.9],[0,0,0],frameMat);
box(panelRig,[6.1,.035,3.66],[0,.079,0],darkMetal,false);
for(const x of [-3.12,3.12])box(panelRig,[.1,.23,4.05],[x,.11,0],metal);
for(const z of [-1.97,1.97])box(panelRig,[6.34,.23,.1],[0,.11,z],metal);
const cellGroup=new THREE.Group();cellGroup.position.y=.103;panelRig.add(cellGroup);
const cols=8,rows=4,cellW=.715,cellD=.82,gap=.045;
for(let c=0;c<cols;c++)for(let r=0;r<rows;r++){
  const mesh=box(cellGroup,[cellW,.018,cellD],[(c-(cols-1)/2)*(cellW+gap),0,(r-(rows-1)/2)*(cellD+gap)],c%2===0&&r%2===0?glassMat:cellMat,false);
  mesh.castShadow=false;
}
for(let x of [-1.8,1.8]){
  const strut=box(panelRig,[.1,.8,.12],[x,-.34,.15],darkMetal);strut.rotation.z=x>0?-.55:.55;
}
// Paired light-dependent resistors mounted on the leading panel edge.
const ldrA=new THREE.Group();panelRig.add(ldrA);ldrA.position.set(-2.72,.28,-2.08);
cylinder(ldrA,.12,.13,.16,[0,0,0],darkMetal);cylinder(ldrA,.075,.075,.07,[0,.11,0],sensorMat);addLabel(ldrA,'LDR 1',[0,.34,0]);track('ldr1',ldrA,new THREE.Vector3(-2.7,2.75,-2));
const ldrB=new THREE.Group();panelRig.add(ldrB);ldrB.position.set(2.72,.28,-2.08);
cylinder(ldrB,.12,.13,.16,[0,0,0],darkMetal);cylinder(ldrB,.075,.075,.07,[0,.11,0],whiteSensorMat);addLabel(ldrB,'LDR 2',[0,.34,0]);track('ldr2',ldrB,new THREE.Vector3(2.7,2.75,-2));
// Rear temperature probe, inertial board, and accelerometer package.
const thermal=new THREE.Group();panelRig.add(thermal);thermal.position.set(-1.9,-.1,1.55);
box(thermal,[.34,.13,.28],[0,0,0],darkMetal);cylinder(thermal,.055,.055,.18,[0,-.12,0],sensorMat);addLabel(thermal,'PANEL TEMP',[0,.24,0]);track('thermal',thermal,new THREE.Vector3(-1.9,2.3,1.5));
const imu=new THREE.Group();panelRig.add(imu);imu.position.set(.25,-.03,1.55);
box(imu,[.44,.18,.36],[0,0,0],darkMetal);box(imu,[.22,.07,.2],[0,.12,0],whiteSensorMat);addLabel(imu,'GYRO X · Y · Z',[0,.38,0]);track('imu',imu,new THREE.Vector3(.25,2.45,1.5));
const accel=new THREE.Group();panelRig.add(accel);accel.position.set(1.95,-.02,1.55);
box(accel,[.35,.2,.3],[0,0,0],darkMetal);box(accel,[.17,.08,.17],[0,.14,0],sensorMat);addLabel(accel,'ACCELEROMETER',[0,.38,0]);track('accel',accel,new THREE.Vector3(1.95,2.45,1.5));
const panelAnchor=new THREE.Object3D();panelAnchor.position.set(0,.54,0);tiltAssembly.add(panelAnchor);addLabel(panelAnchor,'PV ARRAY · 32 CELLS',[0,1.8,0]);track('array',tiltAssembly,new THREE.Vector3(0,2.7,0));
// Rotating position marker and a small true sun vector point provide orientation context.
const axisMarker=new THREE.Mesh(new THREE.TorusGeometry(.19,.018,6,32),new THREE.MeshBasicMaterial({color:'#58dfcb',transparent:true,opacity:.8}));axisMarker.rotation.y=Math.PI/2;axisMarker.position.set(0,2,0);world.add(axisMarker);
const rayMaterial=new THREE.LineDashedMaterial({color:'#f1bd70',dashSize:.22,gapSize:.13,transparent:true,opacity:.55});
const sunRayGeometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0),new THREE.Vector3(1,1,1)]);const sunRay=new THREE.Line(sunRayGeometry,rayMaterial);world.add(sunRay);
const northMark=new THREE.Mesh(new THREE.ConeGeometry(.075,.3,12),new THREE.MeshBasicMaterial({color:'#61d4c7'}));northMark.position.set(-3.7,.22,-2.6);northMark.rotation.x=-Math.PI/2;world.add(northMark);

function updateTilt(){
  tiltAssembly.rotation.x=THREE.MathUtils.degToRad(-state.tilt);$('#tiltValue').textContent=`${state.tilt.toFixed(0)}°`;$('#angleReadout').innerHTML=`${state.tilt.toFixed(1)}<small>°</small>`;$('#normalReadout').textContent=`${(90-state.tilt).toFixed(0)}°`;$('#driveAngle').textContent=`${state.tilt.toFixed(0)}°`;updateIncidence();
}
function updateIncidence(){
  if(!state.sunDirection)return;const normal=new THREE.Vector3(0,1,0).applyEuler(tiltAssembly.rotation).normalize();
  $('#sunIncidence').textContent=`${Math.round(clamp(normal.dot(state.sunDirection),0,1)*100)}%`;
}
function updateSun(){
  const hour=state.sunHour,daylight=clamp((hour-6)/12,0,1),isDay=hour>=6&&hour<=18;
  const elevation=isDay?Math.sin(daylight*Math.PI)*.92+.025:-.12,az=(daylight-.5)*Math.PI*.92;
  const direction=new THREE.Vector3(Math.cos(az)*Math.cos(elevation),Math.sin(elevation),Math.sin(az)*Math.cos(elevation)).normalize();state.sunDirection=direction;
  sunLight.position.copy(direction).multiplyScalar(15);sunLight.intensity=isDay?3.5:0;sunBall.position.copy(direction).multiplyScalar(8);sunHalo.position.copy(sunBall.position);sunBall.visible=isDay;sunHalo.visible=isDay;
  sunRay.geometry.setFromPoints([new THREE.Vector3(0,4.6,0),direction.clone().multiplyScalar(6)]);sunRay.computeLineDistances();sunRay.visible=isDay;
  state.sunTarget=clamp(-THREE.MathUtils.radToDeg(Math.atan2(direction.z,direction.y)),-58,58);
  const hourLabel=`${String(Math.floor(hour)).padStart(2,'0')}:${String(Math.floor((hour%1)*60)).padStart(2,'0')}`;$('#daylightSlider').value=hour;$('#daylightTime').textContent=hourLabel;
  $('#sunElevation').textContent=`${Math.round(THREE.MathUtils.radToDeg(elevation))}° ELEV.`;$('#azimuthReadout').textContent=`${Math.round(THREE.MathUtils.radToDeg(az)+180)}°`;
  $('#sunPosition').textContent=isDay?'DAY ARC':'NIGHT STOW';
  const solarServo=state.connected&&Number.isFinite(state.values.field3);
  if(state.tracking&&!solarServo&&!state.demo){state.tilt=state.sunTarget;$('#tiltSlider').value=state.tilt;updateTilt();$('#trackingCaption').textContent='Following moving sun';$('#driveStatus').textContent='SOLAR TRACKING';}
  updateIncidence();
}
function updateSceneReadouts(){
  if(state.tracking&&state.connected&&Number.isFinite(state.values.field3)){state.tilt=clamp((state.values.field3-90)*.67,-60,60);$('#tiltSlider').value=state.tilt;updateTilt();$('#trackingCaption').textContent='Following servo angle';$('#driveStatus').textContent='SERVO · LIVE';}
  else if(state.tracking&&state.demo&&Number.isFinite(state.values.field3)){state.tilt=clamp((state.values.field3-90)*.67,-60,60);$('#tiltSlider').value=state.tilt;updateTilt();$('#trackingCaption').textContent='Demo servo angle';$('#driveStatus').textContent='AUTO TRACKING';}
  else if(state.tracking){state.tilt=state.sunTarget;$('#tiltSlider').value=state.tilt;updateTilt();$('#trackingCaption').textContent='Following moving sun';}
}
function resize(){const w=sceneHost.clientWidth,h=sceneHost.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);labelRenderer.setSize(w,h)}
new ResizeObserver(resize).observe(sceneHost);resize();updateSun();updateTilt();
let lastFrame=0;
function animate(time){requestAnimationFrame(animate);const elapsed=lastFrame?time-lastFrame:0;if(elapsed>260){lastFrame=time;if(state.sunPlaying){state.sunHour+=elapsed*12/240000;if(state.sunHour>18)state.sunHour=6+(state.sunHour-18)}updateSun()}
  controls.update();renderer.render(scene,camera);labelRenderer.render(scene,camera);
}requestAnimationFrame(animate);

$('#tiltSlider').addEventListener('input',event=>{state.tracking=false;state.tilt=Number(event.target.value);$('#trackingToggle').classList.remove('on');$('#trackingCaption').textContent='Manual panel control';updateTilt()});
$('#trackingToggle').addEventListener('click',()=>{state.tracking=!state.tracking;$('#trackingToggle').classList.toggle('on',state.tracking);$('#trackingCaption').textContent=state.tracking?'Following servo angle':'Manual panel control';if(state.tracking)updateSceneReadouts()});
$('#daylightSlider').addEventListener('input',event=>{state.sunPlaying=false;state.sunHour=Number(event.target.value);$('#daylightPlay').textContent='▶';$('#daylightPlay').title='Resume daylight cycle';updateSun()});
$('#daylightPlay').addEventListener('click',()=>{state.sunPlaying=!state.sunPlaying;$('#daylightPlay').textContent=state.sunPlaying?'Ⅱ':'▶';$('#daylightPlay').title=state.sunPlaying?'Pause daylight cycle':'Resume daylight cycle'});
$('#labelsButton').addEventListener('click',()=>{state.labels=!state.labels;labelRenderer.domElement.classList.toggle('hidden',!state.labels);$('#labelsButton').classList.toggle('active',state.labels);$('#labelsButton').innerHTML=`LABELS <span>${state.labels?'ON':'OFF'}</span>`});
$('#resetViewButton').addEventListener('click',()=>{camera.position.set(8.5,6.5,10.5);controls.target.set(0,2,0);controls.update();selectComponent('array')});
$('#demoButton').addEventListener('click',()=>{clearInterval(state.timer);state.historyChannel='';state.history=[];drawHistory();state.demo=true;state.connected=false;state.tracking=true;$('#trackingToggle').classList.add('on');$('#sceneMode').textContent='DEMO SIMULATION';$('#driveStatus').textContent='AUTO TRACKING';$('#imuStatus').textContent='CALIBRATED';$('#feedLabel').textContent='Illustrative telemetry';setConnection('DEMO SIMULATION',true);updateGauges(demoReadings);state.timer=setInterval(()=>{const p={...demoReadings};p.field1+=Math.round((Math.random()-.5)*55);p.field2+=Math.round((Math.random()-.5)*55);p.field3=90+Math.sin(Date.now()/6200)*35;p.field4=34+Math.sin(Date.now()/12000)*1.6;p.field5=Number((Math.random()-.5)*.12).toFixed(3);p.field6=Number((Math.random()-.5)*.12).toFixed(3);p.field7=Number((Math.random()-.5)*.12).toFixed(3);p.field8=Number((9.81+(Math.random()-.5)*.08).toFixed(3));updateGauges(p);if(Date.now()-state.lastDemoStore>5000){state.lastDemoStore=Date.now();mergeHistory([{...p,entry_id:`demo-${Date.now()}`,created_at:new Date().toISOString()}])}},1100)});
$('#refreshButton').addEventListener('click',()=>{if(state.demo){toast('Demo mode is running');return}pollChannel(state.history.length===0)});
$('#fieldSelect').addEventListener('change',drawHistory);$('#rangeSelect').addEventListener('change',drawHistory);
window.addEventListener('resize',drawHistory);
$('#historyCanvas').addEventListener('mousemove',event=>{
  const rows=filteredHistory(),canvas=event.currentTarget,rect=canvas.getBoundingClientRect(),tip=$('#historyTooltip');if(!rows.length)return;
  const left=38,plotW=rect.width-48,ratio=clamp((event.clientX-rect.left-left)/plotW,0,1),sample=rows[Math.round(ratio*(rows.length-1))],field=fields.find(item=>item.key===$('#fieldSelect').value)||fields[0],value=sample[field.key];
  if(!Number.isFinite(Number(value)))return;tip.textContent=`${new Date(sample.time).toLocaleString()} · ${field.name}: ${value} ${field.unit}`;tip.style.left=`${clamp(event.clientX-rect.left+8,5,rect.width-220)}px`;tip.style.top='8px';tip.style.display='block';
});$('#historyCanvas').addEventListener('mouseleave',()=>$('#historyTooltip').style.display='none');
$('#settingsButton').addEventListener('click',()=>{state.config=readConfig();$('#channelInput').value=state.config.channelId||'';$('#keyInput').value=state.config.readKey||'';$('#connectionDialog').showModal()});
$('#helpButton').addEventListener('click',()=>{const existing=$('.help-pop');if(existing){existing.remove();return}const help=document.createElement('div');help.className='help-pop';help.innerHTML='<b>Explore the digital twin</b><br>Drag to orbit · scroll to zoom · select an assembly component to focus it · use the tilt slider for manual tracking. Connect a ThingSpeak channel to drive the speedometers from fields 1–8.';document.body.append(help);setTimeout(()=>help.remove(),6500)});
$('#saveConnection').addEventListener('click',()=>{
  const channelId=$('#channelInput').value.trim(),readKey=$('#keyInput').value.trim();if(!channelId){toast('Enter your ThingSpeak channel ID');$('#channelInput').focus();return}
  state.config={...readConfig(),channelId,readKey};localStorage.setItem('helio-config',JSON.stringify(state.config));$('#connectionDialog').close();state.demo=false;$('#sceneMode').textContent='LIVE MODEL';connect();
});
$('#connectionDialog').addEventListener('click',event=>{if(event.target===event.currentTarget)event.currentTarget.close()});
$('#componentList').addEventListener('click',event=>{const button=event.target.closest('[data-focus]');if(button)selectComponent(button.dataset.focus)});
window.addEventListener('storage',event=>{if(event.key==='helio-config'){state.config=readConfig();connect()}});
window.addEventListener('beforeunload',()=>clearInterval(state.timer));

$('#daylightSlider').value=state.sunHour;$('#daylightPlay').textContent='Ⅱ';$('#daylightPlay').title='Pause daylight cycle';drawHistory();
if(state.config.channelId){connect()}else{setConnection('AWAITING TELEMETRY',false);$('#feedLabel').textContent='Set up your ThingSpeak link';}
selectComponent('array');
