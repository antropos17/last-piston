import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {MovingFluids} from './particles.js';

const Base = window.Piston.Renderer;
const element = id => document.getElementById(id);
class WorkshopRenderer extends Base {
  constructor(canvas) {
    super(canvas);
    this.surface3D = element('motor-3d');
    this.coverButton = element('open-cover');
    this.modeButton = element('drawing-mode');
    this.notice = element('model-status');
    this.coverOpen = false;
    this.showDrawing = false;
    this.coverButton.onclick = () => {
      this.coverOpen=!this.coverOpen;
      this.coverButton.setAttribute('aria-pressed',String(this.coverOpen));
      this.setDrawing(false);
    };
    this.modeButton.onclick=()=>this.setDrawing(!this.showDrawing);
    element('zoom-out').addEventListener('click',()=>{if(this.rig&&!this.showDrawing)this.frameRig();});
    try {
      this.gpu=new T.WebGLRenderer({canvas:this.surface3D,antialias:true,powerPreference:'high-performance'});
      this.gpu.toneMapping=T.ACESFilmicToneMapping;
      this.gpu.toneMappingExposure=1.19;
      this.scene3D=new T.Scene();
      this.scene3D.background=new T.Color(0x323934);
      this.scene3D.fog=new T.FogExp2(0x323934,.038);
      const pmrem=new T.PMREMGenerator(this.gpu),room=new RoomEnvironment();
      this.roomLight=pmrem.fromScene(room,.04);room.dispose();pmrem.dispose();
      this.scene3D.environment=this.roomLight.texture;
      this.scene3D.environmentIntensity=1.35;
      const fill=new T.HemisphereLight(0xfff3d8,0x766f62,1.3);
      fill.position.set(0,0,1);this.scene3D.add(fill);
      const key=new T.DirectionalLight(0xffebcc,2.05);
      key.position.set(-4,-5,9);this.scene3D.add(key);
      const rim=new T.DirectionalLight(0xc2d8ef,2);
      rim.position.set(3,5,6);this.scene3D.add(rim);
      const floor=new T.Mesh(new T.PlaneGeometry(250,250),new T.MeshStandardMaterial({color:0x343831,roughness:.9}));
      floor.position.z=-1.44;this.scene3D.add(floor);
      const pad=document.createElement('canvas');pad.width=pad.height=128;
      const brush=pad.getContext('2d'),grad=brush.createRadialGradient(64,64,5,64,64,64);
      grad.addColorStop(0,'rgba(0,0,0,.87)');grad.addColorStop(.65,'rgba(0,0,0,.52)');grad.addColorStop(1,'rgba(0,0,0,0)');
      brush.fillStyle=grad;brush.fillRect(0,0,128,128);
      this.contact=new T.Mesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial({map:new T.CanvasTexture(pad),transparent:true,depthWrite:false}));
      this.contact.position.z=-1.432;this.scene3D.add(this.contact);
      this.eye=new T.PerspectiveCamera(32,1,.05,170);
      this.eye.up.set(0,0,1);this.eye.position.set(-6,-13,5);
      this.orbit=new OrbitControls(this.eye,this.surface3D);this.orbit.enablePan=false;
      this.orbit.maxPolarAngle=Math.PI*.51;this.orbit.minDistance=2.1;this.orbit.maxDistance=32;
      this.orbit.addEventListener('change',()=>this.paint());
      this.loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      this.fluids=new MovingFluids(this.scene3D,this.textures[0]);
      this.surface3D.addEventListener('webglcontextlost',e=>{
        e.preventDefault();this.fallback('Видеоконтекст потерян. Включена схема.');
      });
    } catch(err) {this.fallback('3D недоступен. Стенд работает в режиме схемы.');console.error(err);}
  }
  fallback(message){
    this.failed3D=true;this.setDrawing(true);this.notice.textContent=message;
    this.coverButton.disabled=this.modeButton.disabled=true;
  }
  setDrawing(enabled){
    this.showDrawing=enabled||this.failed3D;
    this.surface3D.hidden=!!this.showDrawing;
    this.modeButton.setAttribute('aria-pressed',String(!!this.showDrawing));
    this.modeButton.textContent=this.showDrawing?'Вернуться в 3D':'Схема';
    element('orbit-hint').hidden=!!this.showDrawing;
    if(!this.failed3D)this.notice.textContent='';
    if(!this.showDrawing)super.setGeneral();
    if(this.live)this.render(this.live);
  }
  setPart(id){this.setDrawing(true);super.setPart(id);}
  setFocus(i){this.setDrawing(true);super.setFocus(i);}
  setView(mode){this.setDrawing(true);super.setView(mode);}
  paint(){if(this.rig&&!this.showDrawing)this.gpu.render(this.scene3D,this.eye);}
  frameRig(){
    const bounds=new T.Box3().setFromObject(this.rig.root);
    const size=bounds.getSize(new T.Vector3());
    this.orbit.target.copy(bounds.getCenter(new T.Vector3()));
    const k=Math.tan(this.eye.fov*Math.PI/360);
    const distance=Math.max(size.z*1.08,size.x/Math.max(.6,this.eye.aspect))*.60/k+size.y*.43;
    this.eye.position.copy(this.orbit.target).addScaledVector(new T.Vector3(-.42,-1,.32).normalize(),distance);
    this.contact.position.x=this.orbit.target.x;this.contact.scale.set(size.x*1.25,size.y*1.60,1);
    this.orbit.update();
  }
  async loadRig(count){
    this.pendingCount=count;
    this.notice.textContent='Загружается 3D-мотор…';
    if(this.rig)this.rig.root.visible=false;
    try {
      const {scene:root}=await this.loader.loadAsync('motor-'+count+'.glb');
      if(this.pendingCount!==count||this.failed3D){this.freeRig(root);return;}
      const joints=[],covers=[];let mount;
      root.traverse(node=>{
        if(node.userData.joint){joints.push(node);if(node.userData.joint==='mount')mount=node;}
        if(node.userData.removable)covers.push(node);
      });
      if(!mount||joints.filter(node=>node.userData.joint==='piston').length!==count)throw Error('Неполная сборка мотора');
      if(this.rig){this.scene3D.remove(this.rig.root);this.freeRig(this.rig.root);}
      this.scene3D.add(root);this.rig={root,mount,joints,covers,count};
      this.pendingCount=null;this.lastBuild=null;this.notice.textContent='';
      this.render(this.live);
    } catch(e){if(this.pendingCount===count){this.pendingCount=null;this.fallback('Не удалось открыть 3D-мотор. Включена схема.');console.error(e);}}
  }
  freeRig(root){
    const textures=new Set(),materials=new Set(),meshes=new Set();
    root.traverse(n=>{if(!n.isMesh)return;meshes.add(n.geometry);
      for(const m of [].concat(n.material)){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}
    });
    for(const t of textures){t.source?.data?.close?.();t.dispose();}
    for(const m of materials)m.dispose();
    for(const g of meshes)g.dispose();
  }
  render(model){
    this.live=model;
    if(this.showDrawing||!this.loader){super.render(model);return;}
    const count=model.cylinders.length;
    if(this.pendingCount!==null&&this.pendingCount!==undefined&&this.pendingCount!==count)this.pendingCount=null;
    if(this.rig?.count!==count){if(this.pendingCount!==count)this.loadRig(count);return;}
    this.rig.root.visible=true;
    const {root,joints,covers,mount}=this.rig;
    const width=this.surface3D.clientWidth,height=this.surface3D.clientHeight;
    if(!width||!height)return;
    const ratio=Math.min(devicePixelRatio||1,this.pixelRatioLimit||1.5,1.5);
    if(this.drawWidth!==width||this.drawHeight!==height||this.gpu.getPixelRatio()!==ratio){
      this.drawWidth=width;this.drawHeight=height;this.gpu.setPixelRatio(ratio);this.gpu.setSize(width,height,false);
      this.eye.aspect=width/height;this.eye.updateProjectionMatrix();this.lastBuild=null;
    }
    const refit=this.lastBuild!==model.build;
    if(refit){
      const bore=Math.sqrt(4*model.build.litres*1e6/(count*Math.PI*86));
      root.scale.set(Math.max(92,bore+17)/(100*mount.userData.pitch),(.5*bore+23)/65.99,1);
      this.lastBuild=model.build;
    }
    for(const part of covers)part.visible=!this.coverOpen;
    for(const joint of joints){
      const {joint:kind,cylinder,port}=joint.userData,cy=model.cylinders[cylinder];
      switch(kind){
        case 'mount':
          joint.position.set(this.pose.x*.0065,0,-this.pose.y*.007);
          joint.rotation.set(this.pose.a*.62,this.pose.a*.46,0);break;
        case 'crank':joint.rotation.x=model.phase;break;
        case 'cam':joint.rotation.x=model.timingDrive.camAngle;break;
        case 'oilPressure':joint.rotation.y=(-125+250*Math.min(1,model.pressure/6))*Math.PI/180;break;
        case 'valve':joint.position.z=-.08*cy.cycle[port];break;
        case 'spring':joint.scale.z=1-8/27*cy.cycle[port];break;
        case 'piston':
          joint.visible=cy.active||cy.failure!=='ejected';
          joint.position.z=(460-window.Piston.pistonGeometry(cy.active?model.phase:cy.freeze,cy).pinY)*.01;break;
        case 'rod':{
          const angle=model.phase-cy.offset,y=-.43*Math.sin(angle);
          joint.visible=cy.active;joint.position.y=y;joint.position.z=.43*Math.cos(angle);
          joint.rotation.x=Math.asin(y/1.42);break;
        }
      }
    }
    this.fluids.update(model,this,mount,root.scale,this.coverOpen,this.surface3D.height);
    if(refit)this.frameRig();
    this.paint();
  }
}
window.Piston.Renderer=WorkshopRenderer;
