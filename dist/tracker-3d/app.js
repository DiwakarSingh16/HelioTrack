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
  labels:true, tilt:0, timer:null, lastUpdated:null, selected:'array'
};

function readConfig(){try{return JSON.parse(localStorage.getItem('helio-config')||'{}')}catch{return {}}}
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(el._timer);el._timer=setTimeout(()=>el.classList.remove('show'),3200)}
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

async function pollChannel(){
  const config=readConfig(),channelId=(config.channelId||'').trim(),key=(config.readKey||'').trim();
  if(!channelId){setConnection('AWAITING TELEMETRY',false);$('#feedLabel').textContent='Set up your ThingSpeak link';return}
  try{
    const url=`https://api.thingspeak.com/channels/${encodeURIComponent(channelId)}/feeds/last.json${key?`?api_key=${encodeURIComponent(key)}`:''}`;
    const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const data=await response.json();if(data.error)throw new Error(data.error);
    if(!Object.hasOwn(data,'field1'))throw new Error('No sensor fields returned. Check the channel settings.');
    state.demo=false;state.connected=true;state.config=config;updateGauges(data);setConnection('THINGSPEAK · LIVE',true);
    $('#feedLabel').textContent='Latest channel feed';$('#sceneMode').textContent='LIVE MODEL';$('#driveStatus').textContent='TELEMETRY LINK';
  }catch(error){state.connected=false;setConnection('LINK INTERRUPTED',false);$('#feedLabel').textContent='Could not read channel';toast(`ThingSpeak: ${error.message}`)}
}
function setConnection(label,connected){
  $('#connectionStatus').textContent=label;$('.signal-dot').style.background=connected?'#54e4c5':'#e7a655';$('.signal-dot').style.boxShadow=connected?'0 0 12px #54e4c580':'0 0 12px #e7a65560';$('.live-indicator').style.background=connected?'#54e4c5':'#e9a65e';
}
function connect(){clearInterval(state.timer);pollChannel();state.timer=setInterval(pollChannel,15000)}

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
const scene=new THREE.Scene();scene.background=new THREE.Color('#0d151e');scene.fog=new THREE.FogExp2('#0d151e',.025);
const camera=new THREE.PerspectiveCamera(37,1,.1,100);camera.position.set(8.5,6.5,10.5);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;renderer.outputColorSpace=THREE.SRGBColorSpace;sceneHost.appendChild(renderer.domElement);
const labelRenderer=new CSS2DRenderer();labelRenderer.domElement.className='label-layer';sceneHost.appendChild(labelRenderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.06;controls.minDistance=6;controls.maxDistance=21;controls.maxPolarAngle=Math.PI*.47;controls.target.set(0,2,0);
scene.add(new THREE.HemisphereLight('#bdd7e5','#142029',2.05));
const keyLight=new THREE.DirectionalLight('#e0f4ff',3.1);keyLight.position.set(-5,9,6);keyLight.castShadow=true;keyLight.shadow.mapSize.set(1024,1024);keyLight.shadow.camera.left=-9;keyLight.shadow.camera.right=9;keyLight.shadow.camera.top=9;keyLight.shadow.camera.bottom=-9;scene.add(keyLight);
const fillLight=new THREE.PointLight('#46dfc4',32,14);fillLight.position.set(5,4,-3);scene.add(fillLight);
const sunLight=new THREE.DirectionalLight('#ffc875',2.2);scene.add(sunLight);
const sunBall=new THREE.Mesh(new THREE.SphereGeometry(.18,18,12),new THREE.MeshBasicMaterial({color:'#ffd585'}));scene.add(sunBall);
const sunHalo=new THREE.Mesh(new THREE.SphereGeometry(.34,18,12),new THREE.MeshBasicMaterial({color:'#ffbd67',transparent:true,opacity:.14}));scene.add(sunHalo);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(80,80),new THREE.MeshStandardMaterial({color:'#101820',roughness:.84,metalness:.08}));floor.rotation.x=-Math.PI/2;floor.position.y=-.02;floor.receiveShadow=true;scene.add(floor);
const grid=new THREE.GridHelper(34,34,'#39707c','#27404b');grid.position.y=.008;grid.material.transparent=true;grid.material.opacity=.24;scene.add(grid);
const centerGlow=new THREE.Mesh(new THREE.CircleGeometry(6.7,60),new THREE.MeshBasicMaterial({color:'#42bcbb',transparent:true,opacity:.035,depthWrite:false}));centerGlow.rotation.x=-Math.PI/2;centerGlow.position.y=.015;scene.add(centerGlow);
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

function updateTilt(){tiltAssembly.rotation.x=THREE.MathUtils.degToRad(-state.tilt);$('#tiltValue').textContent=`${state.tilt.toFixed(0)}°`;$('#angleReadout').innerHTML=`${state.tilt.toFixed(1)}<small>°</small>`;$('#normalReadout').textContent=`${(90-state.tilt).toFixed(0)}°`;$('#driveAngle').textContent=`${state.tilt.toFixed(0)}°`;}
function updateSun(){
  const hour=new Date().getHours()+new Date().getMinutes()/60;
  const daylight=clamp((hour-5.5)/13,0,1);const isDay=hour>=5.5&&hour<18.5;const elevation=isDay?Math.sin(daylight*Math.PI)*.72+.14:-.14;const az=(daylight-.5)*Math.PI*.92;
  const direction=new THREE.Vector3(Math.cos(az)*Math.cos(elevation),Math.sin(elevation),Math.sin(az)*Math.cos(elevation)).normalize();
  sunLight.position.copy(direction).multiplyScalar(15);sunBall.position.copy(direction).multiplyScalar(8);sunHalo.position.copy(sunBall.position);
  sunRay.geometry.setFromPoints([new THREE.Vector3(0,4.6,0),direction.clone().multiplyScalar(6)]);sunRay.computeLineDistances();
  $('#sunElevation').textContent=`${Math.round(THREE.MathUtils.radToDeg(elevation))}° ELEV.`;
  $('#azimuthReadout').textContent=`${Math.round(THREE.MathUtils.radToDeg(az)+180)}°`;
  $('#sunPosition').textContent=hour>=6&&hour<19?'DAY ARC':'NIGHT STOW';
}
function updateSceneReadouts(){
  if(state.tracking&&Number.isFinite(state.values.field3)){state.tilt=clamp((state.values.field3-90)*.67,-60,60);$('#tiltSlider').value=state.tilt;updateTilt();$('#trackingCaption').textContent='Following servo angle';$('#driveStatus').textContent='SERVO · LIVE';}
  else if(state.demo&&state.tracking){state.tilt=clamp(Math.sin(Date.now()/6200)*34,-60,60);$('#tiltSlider').value=state.tilt;updateTilt();$('#trackingCaption').textContent='Solar path simulation';$('#driveStatus').textContent='AUTO TRACKING';}
}
function resize(){const w=sceneHost.clientWidth,h=sceneHost.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);labelRenderer.setSize(w,h)}
new ResizeObserver(resize).observe(sceneHost);resize();updateSun();updateTilt();
let lastFrame=0;
function animate(time){requestAnimationFrame(animate);const elapsed=time-lastFrame;if(elapsed>300){lastFrame=time;updateSun();if(state.tracking&&!state.connected&&!state.demo){state.tilt=Math.sin(Date.now()/13000)*27;updateTilt()}}
  controls.update();renderer.render(scene,camera);labelRenderer.render(scene,camera);
}requestAnimationFrame(animate);

$('#tiltSlider').addEventListener('input',event=>{state.tracking=false;state.tilt=Number(event.target.value);$('#trackingToggle').classList.remove('on');$('#trackingCaption').textContent='Manual panel control';updateTilt()});
$('#trackingToggle').addEventListener('click',()=>{state.tracking=!state.tracking;$('#trackingToggle').classList.toggle('on',state.tracking);$('#trackingCaption').textContent=state.tracking?'Following servo angle':'Manual panel control';if(state.tracking)updateSceneReadouts()});
$('#labelsButton').addEventListener('click',()=>{state.labels=!state.labels;labelRenderer.domElement.classList.toggle('hidden',!state.labels);$('#labelsButton').classList.toggle('active',state.labels);$('#labelsButton').innerHTML=`LABELS <span>${state.labels?'ON':'OFF'}</span>`});
$('#resetViewButton').addEventListener('click',()=>{camera.position.set(8.5,6.5,10.5);controls.target.set(0,2,0);controls.update();selectComponent('array')});
$('#demoButton').addEventListener('click',()=>{clearInterval(state.timer);state.demo=true;state.connected=false;state.tracking=true;$('#trackingToggle').classList.add('on');$('#sceneMode').textContent='DEMO SIMULATION';$('#driveStatus').textContent='AUTO TRACKING';$('#imuStatus').textContent='CALIBRATED';$('#feedLabel').textContent='Illustrative telemetry';setConnection('DEMO SIMULATION',true);updateGauges(demoReadings);state.timer=setInterval(()=>{const p={...demoReadings};p.field1+=Math.round((Math.random()-.5)*55);p.field2+=Math.round((Math.random()-.5)*55);p.field3=90+Math.sin(Date.now()/6200)*35;p.field4=34+Math.sin(Date.now()/12000)*1.6;p.field5=Number((Math.random()-.5)*.12).toFixed(3);p.field6=Number((Math.random()-.5)*.12).toFixed(3);p.field7=Number((Math.random()-.5)*.12).toFixed(3);p.field8=Number((9.81+(Math.random()-.5)*.08).toFixed(3));updateGauges(p)},1100)});
$('#refreshButton').addEventListener('click',()=>{if(state.demo){toast('Demo mode is running');return}pollChannel()});
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

if(state.config.channelId){connect()}else{setConnection('AWAITING TELEMETRY',false);$('#feedLabel').textContent='Set up your ThingSpeak link';}
selectComponent('array');
