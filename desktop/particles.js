import * as T from 'three';

// Reuse the live oil, fragment and exhaust pools. Drawing never advances the simulation.
export class MovingFluids {
  constructor(scene, texture) {
    this.transform = new T.Object3D();
    this.oil = new T.InstancedMesh(new T.SphereGeometry(1,8,5),new T.MeshStandardMaterial({color:0x533818,roughness:.16,metalness:.24}),512);
    this.chips = new T.InstancedMesh(new T.BoxGeometry(1,1,1),new T.MeshStandardMaterial({color:0x8a8674,roughness:.34,metalness:.8}),64);
    this.oil.count=this.chips.count=0;
    const geometry=new T.BufferGeometry();
    for(const [key,size] of [['position',3],['diameter',1],['tint',4]])
      geometry.setAttribute(key,new T.Float32BufferAttribute(new Float32Array(260*size),size).setUsage(T.DynamicDrawUsage));
    const material=new T.ShaderMaterial({
      uniforms:{sprite:{value:new T.CanvasTexture(texture)},height:{value:500}},transparent:true,depthWrite:false,
      vertexShader:`attribute float diameter; attribute vec4 tint; varying vec4 shade; uniform float height;
        void main(){vec4 p=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*p;
        gl_PointSize=clamp(diameter*height*projectionMatrix[1][1]/(-2.0*p.z),1.0,250.0);shade=tint;}`,
      fragmentShader:`uniform sampler2D sprite; varying vec4 shade;
        void main(){float a=texture2D(sprite,gl_PointCoord).a*shade.a;if(a<0.008)discard;gl_FragColor=vec4(shade.rgb,a);
        #include <colorspace_fragment>
        }`
    });
    this.plume=new T.Points(geometry,material);
    for(const obj of [this.oil,this.chips,this.plume]) {obj.frustumCulled=false;scene.add(obj);}
  }
  update(model,view,mount,scale,cut,height) {
    const {first,pitch,outlet}=mount.userData, t=this.transform;
    const oil=this.oil, chips=this.chips;
    oil.count=chips.count=0;
    const place=p=>t.position.set((first+(p.x-373)*pitch/144)*scale.x,-.12*scale.y,(460-p.y)*.01);
    if(cut){
      const spray=model.oilCircuit.spray;
      for(const pool of [spray.drops,spray.films]) for(const p of pool){
        if(oil.count>=oil.instanceMatrix.count)break;
        place(p);const r=Math.max(.008,Math.min(.042,Math.cbrt(p.litres*239000)*.01));
        t.scale.set(r,r*.8,r*(pool===spray.films?2.8:1.4));t.rotation.set(0,0,0);t.updateMatrix();oil.setMatrixAt(oil.count++,t.matrix);
      }
      for(const p of model.fragments.bodies){
        if(chips.count>=chips.instanceMatrix.count)break;
        place(p);t.rotation.set(0,p.a||0,0);const r=Math.max(.025,p.r*.015);
        t.scale.set(r*1.5,r*.8,p.kind==='rod'?r*3:r);t.updateMatrix();chips.setMatrixAt(chips.count++,t.matrix);
      }
    }
    oil.instanceMatrix.needsUpdate=chips.instanceMatrix.needsUpdate=true;
    const geo=this.plume.geometry,attr=geo.attributes;
    let i=0;
    for(const p of view.smoke){
      if(!p.tail||i>=260) continue;
      attr.position.setXYZ(i,(outlet[0]+(p.x-1155)*.014)*scale.x,outlet[1]*scale.y,outlet[2]+(359-p.y)*.012);
      attr.diameter.setX(i,p.r*.032);
      const steam=p.tex>=6&&p.tex<9, soot=p.tex>=9&&p.tex<12;
      const c=steam?.62:soot?.028:.16;
      attr.tint.setXYZW(i,c,c,steam?c*1.05:c*.92,Math.min(.82,p.alpha*.94)*Math.max(0,1-p.age/p.life));
      i++;
    }
    geo.setDrawRange(0,i);for(const a of Object.values(attr))a.needsUpdate=true;
    this.plume.material.uniforms.height.value=height;
  }
}
