"""Offline preparation of rigid engine assemblies and their inspection finish."""
from collections import defaultdict
import bpy
import numpy as np

def join_rigid_parts(scene, moving):
    layer=bpy.context.view_layer
    layer.update()
    graph=bpy.context.evaluated_depsgraph_get()
    batches=defaultdict(list)
    for o in list(scene.objects):
        if o.type not in {'CURVE','MESH'} or o in moving or o.animation_data or o.children:
            continue
        batches[o.users_collection[0],o.parent].append(o)
    for (col,parent),parts in batches.items():
        if len(parts)<2:
            continue
        pieces=[]
        for o in parts:
            # Evaluate fillets and pipes once. The editable mesh follows its own mechanical pivot.
            me=bpy.data.meshes.new_from_object(o.evaluated_get(graph),depsgraph=graph)
            piece=bpy.data.objects.new(o.name+' geometry',me)
            col.objects.link(piece);piece.parent=parent;piece.matrix_basis=o.matrix_basis.copy()
            pieces.append(piece)
        joined=bpy.data.objects.new((parent.name+' / ' if parent else '')+col.name.split(' • ')[-1],bpy.data.meshes.new('Rigid assembly'))
        col.objects.link(joined);joined.parent=parent
        layer.update()
        with bpy.context.temp_override(active_object=joined,selected_editable_objects=[joined,*pieces]):
            bpy.ops.object.join()
        for o in parts:bpy.data.objects.remove(o,do_unlink=True)

def inspection_finishes(scene, painted, wear, pitch):
    # Packed albedo shared by Workbench and Cycles. Coordinates are in millimetres,
    # so the scratches and seepage have the same size across neighbouring cast parts.
    N=768
    z,x=np.mgrid[:N,:N].astype(np.float32)*512/N-256
    z+=80
    rng=np.random.default_rng(721)
    def noise(nx,ny):
        g=rng.random((ny+1,nx+1))
        xx=np.arange(N)[None,:]*nx/N;yy=np.arange(N)[:,None]*ny/N
        ix=xx.astype(int);iy=yy.astype(int);fx=xx-ix;fy=yy-iy
        fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy)
        return (1-fy)*((1-fx)*g[iy,ix]+fx*g[iy,ix+1])+fy*((1-fx)*g[iy+1,ix]+fx*g[iy+1,ix+1])
    broad=noise(8,8);grain=rng.random((N,N));pits=noise(180,180)
    speck=.58*noise(46,45)+.23*pits+.19*grain
    into_seam=sum(np.exp(-np.abs(z-h)/4) for h in (-15,63,210,240,273))
    drips=noise(95,4)**4*np.exp(-((z-161)/58)**2)
    # Wet streaks start at specific seals/plugs. They broaden on the rough cast surface.
    pools=np.zeros_like(z)
    for i in range(scene['Cylinders']):
        cx=(i-(scene['Cylinders']-1)/2)*pitch
        for dx,top,length,width in [(-pitch*.31,212,92,2.4),(4,125,54,3.2),(pitch*.38,275,42,2.4)]:
            fall=np.clip((top-z)/length,0,1)
            line=x-cx-dx-1.9*np.sin(5*fall+i)
            pools+=np.exp(-(line/(width+fall*2.6))**2)*np.clip((top-z)*.42,0,1)*(1-fall)**.6
    seep=np.clip((.44*into_seam+.27*drips+.92*pools)*(.22+.90*wear),0,.96)
    fastener=np.exp(-((np.mod(x+pitch*.5,pitch)-pitch*.5)/6)**2)
    for mat,kind in painted.items():
        base={'block':(.256,.309,.254),'cover':(.173,.181,.169),'pan':(.192,.189,.162),'exhaust':(.308,.205,.137),'head':(.40,.406,.375),'iron':(.245,.257,.245)}[kind]
        if kind=='exhaust':
            t=np.clip((speck-.36)*2.8,0,1)*(0.50+.35*wear)
            tint=np.array((.45,.252,.126))
            grime=.12+.27*broad+.39*np.exp(-((z-220)/12)**2)
        elif kind in {'head','iron'}:
            t=np.clip((speck-.57)*2.2,0,1)*(.25+.28*wear)
            tint=np.array((.32,.292,.234) if kind=='head' else (.291,.236,.165))
            grime=(.18*broad+.20*into_seam+.46*drips)*(.45+wear)+.65*seep
        else:
            edge=np.clip(into_seam+fastener*.57,0,1)
            t=np.clip((speck+edge*.36+broad*.12-(.86-.17*wear))*10,0,1)*(.15+.76*wear)
            tint=np.array((.43,.235,.12))
            grime=(.15*into_seam+.36*drips)*(.30+wear)+.68*seep
        variation=.74+.29*broad+.23*grain
        rgb=(np.array(base)[None,None,:]*(1-t[:,:,None])+tint[None,None,:]*t[:,:,None])
        rgb*=((1-np.clip(grime,0,.79))*variation)[:,:,None]
        # Store sRGB in a byte image. Node sampling converts the packed pixels back to scene linear.
        img=bpy.data.images.new(mat.name+' • finish',width=N,height=N,alpha=False)
        rgba=np.ones((N,N,4),dtype=np.float32);rgba[:,:,:3]=np.clip(rgb,0,1)
        img.pixels.foreach_set(rgba.ravel());img.pack()
        nt=mat.node_tree;tex=nt.nodes.new('ShaderNodeTexImage');tex.image=img
        nt.links.new(tex.outputs['Color'],nt.nodes.get('Principled BSDF').inputs['Base Color'])
        bs=nt.nodes.get('Principled BSDF')
        mask=bpy.data.images.new(mat.name+' • roughness',width=N,height=N,alpha=False)
        mask.colorspace_settings.name='Non-Color'
        dry=.71 if kind=='exhaust' else (.54 if kind in {'head','iron'} else .42)
        rough=np.clip(dry+.21*(pits-.5)+.19*t-(.06 if kind=='exhaust' else .36)*seep,.12,.94)
        rgba[:,:,:3]=rough[:,:,None]
        mask.pixels.foreach_set(rgba.ravel());mask.pack()
        finish=nt.nodes.new('ShaderNodeTexImage');finish.image=mask
        nt.links.new(finish.outputs['Color'],bs.inputs['Roughness'])
        nt.nodes.active=tex
    for obj in scene.objects:
        if obj.type!='MESH' or not any(m in painted for m in obj.data.materials):
            continue
        me=obj.data
        if me.users>1:obj.data=me=me.copy()
        uv=me.uv_layers.new(name='Casting finish');me.uv_layers.active=uv;uv.active_render=True
        verts=np.empty(len(me.vertices)*3,dtype=np.float32);me.vertices.foreach_get('co',verts)
        mat=np.array(obj.matrix_world)
        pos=verts.reshape(-1,3)@mat[:3,:3].T*100+mat[:3,3]*100
        axes=np.linalg.inv(mat[:3,:3]).T
        uvdata=np.zeros((len(me.loops),2),np.float32)
        for face in me.polygons:
            normal=axes@np.array(face.normal);axis=np.abs(normal).argmax()
            v=pos[list(face.vertices)]
            uu=v[:,1] if axis==0 else v[:,0]
            vv=v[:,1]+185 if axis==2 else v[:,2]
            uvdata[face.loop_start:face.loop_start+face.loop_total]=np.column_stack(((uu+256)/512,(vv+176)/512))
        uv.uv.foreach_set('vector',uvdata.ravel())

