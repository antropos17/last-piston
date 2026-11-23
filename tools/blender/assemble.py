"""Build the editable Last Piston inspection engine. Run inside Blender, see --help."""
import argparse
import json
import math
import random
import sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from viewport import join_rigid_parts, inspection_finishes

p = argparse.ArgumentParser()
p.add_argument("--take", type=Path, required=True)
p.add_argument("--out", type=Path, required=True)
args = p.parse_args(sys.argv[sys.argv.index("--")+1:])
take = json.loads((args.take/"take.json").read_text(encoding="utf-8"))
frames, spec, offsets = take["frames"], take["spec"], take["offsets"]
n, litres, wear = spec["cylinders"], spec["litres"], spec["wear"]
pi, tau, sin, cos, sqrt = math.pi, math.tau, math.sin, math.cos, math.sqrt
u = .01  # one Blender unit = 100 mm
def xyz(v): return tuple(a*u for a in v)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system='METRIC'
scene.unit_settings.scale_length=.1
scene.unit_settings.length_unit='MILLIMETERS'
scene.render.fps=24
scene.frame_start=1
scene.frame_end=len(frames)
rng=random.Random(1731)
bore=sqrt(4*litres*1e6/(n*pi*86))
r=bore/2
pitch=max(92,bore+17)
xs=[(i-(n-1)/2)*pitch for i in range(n)]
edge=n*pitch/2
depth=r+23

def group(name):
    c=bpy.data.collections.new(name)
    scene.collection.children.link(c)
    return c
rig=group("00 • Transport and mounts")
casting=group("01 • Crankcase and sectioned castings")
internals=group("02 • Crankshaft, rods and pistons")
head=group("03 • Cylinder head and valve train")
drive=group("04 • Timing and accessories")
plumbing=group("05 • Intake, exhaust and cooling")
front=group("06 • Removable outer casting")
fluids=group("07 • Oil, fragments and exhaust")
stand=group("08 • Dynamometer skid")
studio=group("09 • Studio")
col=rig
parent=None

def obj(name,data=None,loc=(0,0,0),owner=None):
    o=bpy.data.objects.new(name,data)
    col.objects.link(o)
    o.parent=parent if owner is None else owner
    o.location=xyz(loc)
    return o
def mesh(name,verts,faces,mat,loc=(0,0,0),smooth=False):
    me=bpy.data.meshes.new(name);me.from_pydata([xyz(v) for v in verts],[],faces);me.materials.append(mat);me.update()
    if smooth:
        for f in me.polygons:f.use_smooth=True
    return obj(name,me,loc)
def bevel(o,width,steps=2):
    mod=o.modifiers.new("Machined edge radius",'BEVEL');mod.width=width*u;mod.segments=steps
    mod.harden_normals=True
    norm=o.modifiers.new("Face normals",'WEIGHTED_NORMAL');norm.keep_sharp=True
    return o
def box(name,loc,size,mat,rounding=0):
    a,b,c=(v/2 for v in size)
    vs=[(i*a,j*b,k*c) for k in (-1,1) for j in (-1,1) for i in (-1,1)]
    o=mesh(name,vs,[(0,2,3,1),(4,5,7,6),(0,1,5,4),(1,3,7,5),(3,2,6,7),(2,0,4,6)],mat,loc)
    return bevel(o,rounding,3) if rounding else o
def lathe(name,profile,loc,mat,axis='Z',steps=48):
    vs=[];fs=[]
    for radius,z in profile:
        for j in range(steps):
            a=tau*j/steps;vs.append((radius*cos(a),radius*sin(a),z))
    for i in range(len(profile)-1):
        for j in range(steps):
            a=i*steps+j;b=i*steps+(j+1)%steps;fs.append((a,b,b+steps,a+steps))
    o=mesh(name,vs,fs,mat,loc,True)
    if axis=='X':o.rotation_euler.y=pi/2
    if axis=='Y':o.rotation_euler.x=pi/2
    return o
solid_cache={}
def cyl(name,a,b,rad,mat,sides=32):
    d=Vector(b)-Vector(a);length=d.length
    key=(sides,mat.name)
    if key not in solid_cache:
        vs=[(cos(j*tau/sides),sin(j*tau/sides),z) for z in (-.5,.5) for j in range(sides)]
        faces=[tuple(reversed(range(sides))),tuple(range(sides,2*sides))]
        faces.extend((j,(j+1)%sides,sides+(j+1)%sides,j+sides) for j in range(sides))
        me=bpy.data.meshes.new("Turned stock • "+mat.name);me.from_pydata(vs,[],faces);me.materials.append(mat);me.update()
        for f in list(me.polygons)[2:]:f.use_smooth=sides>8
        solid_cache[key]=me
    o=obj(name,solid_cache[key],(Vector(a)+Vector(b))/2)
    o.scale=(rad*u,rad*u,length*u);o.rotation_euler=d.to_track_quat('Z','Y').to_euler()
    return o
def axle(name,x,y,z,length,rad,mat,sides=48):
    return cyl(name,(x-length/2,y,z),(x+length/2,y,z),rad,mat,sides)
def tube(name,points,rad,mat,poly=False,loop=False):
    cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=8
    cu.bevel_depth=rad*u;cu.bevel_resolution=2;cu.use_fill_caps=True
    s=cu.splines.new('POLY' if poly else 'BEZIER')
    if poly:
        s.points.add(len(points)-1)
        for pt,v in zip(s.points,points):pt.co=(*xyz(v),1)
    else:
        s.bezier_points.add(len(points)-1)
        for pt,v in zip(s.bezier_points,points):
            pt.co=xyz(v);pt.handle_left_type=pt.handle_right_type='AUTO'
    s.use_cyclic_u=loop;cu.materials.append(mat)
    return obj(name,cu)
def ring(name,loc,outer,inner,length,mat,axis='X'):
    l=length/2;v=min(1.1,length*.17,(outer-inner)*.24)
    return lathe(name,[(inner,-l),(outer-v,-l),(outer,-l+v),(outer,l-v),(outer-v,l),(inner,l),(inner,-l)],loc,mat,axis)
def metal(name,colors,metalness,rough,grain=135,bump=.025):
    m=bpy.data.materials.new(name);m.diffuse_color=(*colors[-1][1],1);m.metallic=metalness;m.roughness=rough;m.use_nodes=True
    nt=m.node_tree;bs=nt.nodes.get('Principled BSDF');bs.inputs['Metallic'].default_value=metalness
    def node(t):return nt.nodes.new(t)
    def wire(a,i,b,j):nt.links.new(a.outputs[i],b.inputs[j])
    coord=node('ShaderNodeTexCoord')
    noise=node('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=3.8;noise.inputs['Detail'].default_value=5.5;noise.inputs['Roughness'].default_value=.72
    wire(coord,'Object',noise,'Vector')
    ramp=node('ShaderNodeValToRGB');cr=ramp.color_ramp
    for idx,(pos,color) in enumerate(colors):
        e=cr.elements[idx] if idx<2 else cr.elements.new(pos)
        e.position=pos;e.color=(*color,1)
    wire(noise,'Fac',ramp,'Fac');wire(ramp,'Color',bs,'Base Color')
    fine=node('ShaderNodeTexNoise');fine.inputs['Scale'].default_value=grain;fine.inputs['Detail'].default_value=2.5;wire(coord,'Object',fine,'Vector')
    bm=node('ShaderNodeBump');bm.inputs['Strength'].default_value=.22;bm.inputs['Distance'].default_value=bump;wire(fine,'Fac',bm,'Height');wire(bm,'Normal',bs,'Normal')
    rr=node('ShaderNodeMapRange');rr.inputs['To Min'].default_value=max(.03,rough-.12);rr.inputs['To Max'].default_value=min(.98,rough+.14)
    wire(noise,'Fac',rr,'Value');wire(rr,'Result',bs,'Roughness')
    return m
def alloy(name,dark,light,metalness=.85,rough=.32):
    return metal(name,[(.2,dark),(.8,light)],metalness,rough,185,.007)
# Linear RGB. Thin exposed iron between paint, oxide and oil-darkened patches.
paint=metal("Cast block • chipped petrol enamel",[(.20,(.043,.022,.012)),(.29+.15*wear,(.14,.058,.022)),(.32+.15*wear,(.061,.069,.053)),(.36+.15*wear,(.030,.077,.060)),(.70,(.083,.173,.134)),(.81,(.031,.043,.033))],.64,.43)
iron=metal("Graphite cast iron • oily pores",[(.23,(.022,.020,.017)),(.48,(.061,.069,.064)),(.75,(.155,.145,.119))],.78,.39)
rust=metal("Exhaust • oxidised cast iron",[(.2,(.029,.024,.021)),(.42,(.080,.045,.025)),(.54,(.219,.085,.031)),(.77,(.080,.060,.049))],.59,.66,100,.052)
steel=alloy("Ground steel • tool tracks",(.115,.132,.13),(.36,.395,.39),.94,.28)
bright=alloy("Machined aluminium • cut faces",(.25,.27,.24),(.57,.59,.55),.87,.27)
pistonmat=alloy("Piston skirt • oil polished",(.145,.155,.14),(.39,.41,.36),.89,.24)
black=alloy("Phosphate • bolt heads",(.019,.022,.023),(.080,.090,.087),.76,.31)
gold=alloy("Tarnished brass",(.14,.074,.028),(.55,.34,.108),.81,.32)
rubber=alloy("Vulcanised rubber",(.004,.005,.005),(.017,.019,.017),.03,.76)
oil=alloy("Used crank oil • amber meniscus",(.012,.008,.003),(.107,.052,.012),.22,.115)
b=oil.node_tree.nodes.get('Principled BSDF');b.inputs['Coat Weight'].default_value=.85;b.inputs['Coat Roughness'].default_value=.065
basepaint=metal("Skid • worn ochre enamel",[(.2,(.051,.033,.017)),(.38,(.114,.060,.024)),(.41,(.181,.124,.048)),(.68,(.39,.255,.086)),(.81,(.115,.088,.053))],.68,.5)
ivory=alloy("Ivory • ceramic and lettering",(.50,.46,.33),(.85,.82,.65),.15,.31)
gasket=alloy("Fibre gasket • dark copper",(.112,.044,.019),(.34,.155,.071),.48,.52)
floor=metal("Workshop floor • sealed concrete",[(.15,(.034,.040,.043)),(.55,(.065,.072,.072)),(.82,(.108,.107,.097))],.14,.53,60,.045)
liner=alloy("Bore • plateau honed steel",(.12,.14,.13),(.29,.32,.30),.94,.265)
# Opposed honing passes produce fine diagonal scratches below the polished surface.
nt=liner.node_tree;coord=nt.nodes.new('ShaderNodeTexCoord')
waves=[]
for angle in (-.57,.57):
    mapping=nt.nodes.new('ShaderNodeMapping');mapping.inputs['Rotation'].default_value[1]=angle
    nt.links.new(coord.outputs['Object'],mapping.inputs['Vector'])
    wave=nt.nodes.new('ShaderNodeTexWave');wave.bands_direction='Z';wave.inputs['Scale'].default_value=74
    wave.inputs['Distortion'].default_value=.6;nt.links.new(mapping.outputs['Vector'],wave.inputs['Vector']);waves.append(wave)
cross=nt.nodes.new('ShaderNodeMath');cross.operation='MULTIPLY'
for j,w in enumerate(waves):nt.links.new(w.outputs['Fac'],cross.inputs[j])
honing=nt.nodes.new('ShaderNodeBump');honing.inputs['Strength'].default_value=.10;honing.inputs['Distance'].default_value=.0015
nt.links.new(cross.outputs[0],honing.inputs['Height']);nt.links.new(honing.outputs['Normal'],nt.nodes.get('Principled BSDF').inputs['Normal'])
headmat=alloy("Cylinder head • aged aluminium",(.19,.185,.157),(.37,.38,.34),.72,.43)
covermat=alloy("Valve cover • baked black enamel",(.020,.023,.020),(.048,.055,.046),.42,.37)
panmat=alloy("Oil pan • pressed steel",(.035,.032,.024),(.082,.073,.049),.58,.40)
paint.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value=.26
motor=obj("ENGINE • resiliently mounted assembly")
parent=motor
def bolt(name,point,vec=(0,0,1),size=4,finish=black):
    pt=Vector(point);d=Vector(vec)
    cyl(name+" washer",pt,pt+d*1.1,size*1.29,steel,20)
    return cyl(name,pt+d*.8,pt+d*(size*.82+1),size,finish,6)
def label(name,txt,loc,size,mat=ivory):
    cu=bpy.data.curves.new(name,'FONT');cu.body=txt;cu.align_x='CENTER';cu.align_y='CENTER';cu.size=size*u;cu.extrude=.09*u
    cu.materials.append(mat);o=obj(name,cu,loc);o.rotation_euler.x=pi/2;return o


def sleeve(name,x,z0,z1,inner,half,deep,angles,material):
    # Cast cell from the rectangular outer jacket to the round honed bore.
    vs=[];fs=[];materials=[]
    for a in angles:
        sx,sy=sin(a),-cos(a)
        k=min(half/max(abs(sx),1e-8),deep/max(abs(sy),1e-8))
        vs.extend([(sx*k,sy*k,z0),(sx*k,sy*k,z1),(sx*inner,sy*inner,z1),(sx*inner,sy*inner,z0)])
    for j in range(len(angles)-1):
        for q in range(4):
            i=j*4;t=(q+1)%4
            fs.append((i+q,i+4+q,i+4+t,i+t));materials.append([0,1,2,0][q])
    fs.extend([(0,1,2,3),tuple(reversed(range(len(vs)-4,len(vs))))]);materials.extend([1,1])
    o=mesh(name,vs,fs,material,(x,0,0));o.data.materials.append(bright);o.data.materials.append(liner)
    for face,mi in zip(o.data.polygons,materials):
        face.material_index=mi;face.use_smooth=mi==2
    return o
def pan_half(name,side,material):
    # Pressed sheet, with a deep pickup pocket and a shallow nose. Half shells meet on the centre plane.
    layers=[(-83,edge*.57,depth*.64,edge*.19,12),(-81,edge*.61,depth*.69,edge*.19,14),
            (-68,edge*.68,depth*.76,edge*.16,16),(-58,edge*.73,depth*.81,edge*.14,17),
            (-52,edge*.91,depth*.85,edge*.035,16),(-46,edge*.97,depth*.89,0,15),
            (-18,edge,depth*.94,0,11),(-15,edge+4,depth+2,0,10),(-12,edge+4,depth+2,0,10)]
    vs=[];fs=[]
    def rim(z,w,h,cx,rad):
        pts=[(cx+w,0,z)]
        for corner in range(2):
            for k in range(10):
                a=(corner+k/9)*pi/2
                pts.append((cx+(w-rad)*(1 if corner==0 else -1)+rad*cos(a),side*(h-rad+rad*sin(a)),z))
        return pts+[(cx-w,0,z)]
    rings=[rim(*layer) for layer in layers]
    rings+= [rim(z+1.5,w-2.4,h-2.4,c,rr-1) for z,w,h,c,rr in reversed(layers)]
    k=len(rings[0])
    for row in rings:vs.extend(row)
    for j in range(len(rings)-1):
        for i in range(k-1):
            a=j*k+i;fs.append((a,a+1,a+1+k,a+k))
    fs.extend([tuple(reversed(range(k))),tuple(range(len(vs)-k,len(vs)))])
    if side<0:fs=[tuple(reversed(f)) for f in fs]
    o=mesh(name,vs,fs,material)
    for face in list(o.data.polygons)[:-2]:face.use_smooth=True
    return o

def crank_skirt(side):
    # Drafted upper crankcase with a machined pan flange and a bolted access door.
    section=[(-14,depth-1),(-10,depth+1),(-6,depth-3),(10,depth-3),
             (42,depth-10),(58,depth-9),(66,depth*.89)]
    vs=[];fs=[]
    for x in (-edge,edge):
        vs+= [(x,side*d,z) for z,d in section]
        vs+= [(x,side*(d-4.5),z) for z,d in reversed(section)]
    k=len(section)*2
    for i in range(k):fs.append((i,(i+1)%k,(i+1)%k+k,i+k))
    fs.extend([tuple(reversed(range(k))),tuple(range(k,k*2))])
    if side<0:fs=[tuple(reversed(f)) for f in fs]
    bevel(mesh("Upper crankcase • cast skirt",vs,fs,paint),.9)
    # Inspection port narrows at each end; the bosses land on the cast wall.
    w=edge*.70
    profile=[(-w,-5),(-w+6,-9),(w-7,-9),(w,-3),(w-6,23),(w-14,32),
             (-w+19,32),(-w+9,26)]
    for offset,mat,name in [(1.0,rubber,'Access door gasket'),(3.4,iron,'Oil-side access cover')]:
        vv=[(x,side*(depth-3-z*.20+d),z) for d in (-1.3,offset) for x,z in profile]
        k=len(profile);ff=[tuple(reversed(range(k))),tuple(range(k,2*k))]
        ff+=[(j,(j+1)%k,(j+1)%k+k,j+k) for j in range(k)]
        bevel(mesh(name,vv,ff,mat),1.2)
    for z in (4,16):
        y=side*(depth+.1-z*.20)
        tube("Pressed access door bead",[(-w*.81,y,z),(0,y+side*1.8,z),(w*.80,y,z)],1.8,iron)
    if side<0:
        bx=w*.34
        box("Engine number pad",(bx,-depth-1,10),(min(w*.64,72),3,17),iron,2.3)
        label("Casting stamp",f"LP   {n}    /    {round(litres*1000)}",(bx,-depth-2.6,10),5.6,bright)
    for x in (-w*.86,0,w*.86):
        for z in (-3,24):
            bolt("Access door screw",(x,side*(depth+.5-z*.20),z),(0,side,0),3.4)

def rocker_cover():
    # One pressed, twin-hump shell with a recessed plug trough and rounded end returns.
    profile=[(-1,276),(-1,284),(-.94,293),(-.80,300),(-.65,307),(-.48,310),(-.31,309),
             (-.22,305),(-.16,300),(.16,300),(.22,305),(.31,309),(.48,310),(.65,307),
             (.80,300),(.94,293),(1,284),(1,276)]
    vs=[];fs=[]
    sections=[(-edge-3,.81,.75),(-edge+.5,.93,.91),(-edge+9,1,1),
              (edge-9,1,1),(edge-.5,.93,.91),(edge+3,.81,.75)]
    for x,span,h in sections:vs.extend((x,y*depth*span,276+(z-276)*h) for y,z in profile)
    k=len(profile)
    for j in range(len(sections)-1):
        for i in range(k-1):
            a=j*k+i;fs.append((a,a+1,a+k+1,a+k))
    fs.extend([tuple(reversed(range(k))),tuple(range(len(vs)-k,len(vs)))])
    o=mesh("Pressed twin-cam cover",vs,[tuple(reversed(face)) for face in fs],covermat)
    for f in list(o.data.polygons)[:-2]:f.use_smooth=True
    return o

def arc(a,b):return [a+(b-a)*i/54 for i in range(55)]
cut=1.045
def sector(part,x,source,angles):
    global col
    col=source
    jacket=sleeve(part+" • water jacket",x,64,205,r+.8,pitch/2,depth,angles,paint)
    vs=jacket.data.vertices
    for i,a in enumerate(angles):
        for j in (0,1):
            v=vs[4*i+j]
            xx,yy=v.co.x/u,v.co.y/u
            scallop=1-.15*(abs(xx)/(pitch/2))**2
            v.co.y=yy*u*scallop*(.89 if j==0 else 1)
    jacket.data.update()
    sleeve(part+" • deck",x,205,212,r+.8,pitch/2,depth+2,angles,bright)
    sleeve(part+" • head gasket",x,212,213.7,r+.8,pitch/2,depth+1.3,angles,gasket)
    sleeve(part+" • cylinder head",x,213.7,238,r*1.02,pitch/2,depth+1,angles,headmat)
for i,x in enumerate(xs):
    sector(f"Bore {i+1:02d}",x,casting,arc(cut,tau-cut))
    sector(f"Closing section {i+1:02d}",x,front,arc(-cut,cut))
# The sump and upper cover are genuinely three dimensional when the section is closed.
col=casting
pan_half("Deep sump • fixed half",1,panmat)
box("Oil bath • surface",(edge*.15,1,-69),(edge*1.23,depth*1.26,3.5),oil,4)
bolt("Magnetic drain plug",(edge*.39,-depth*.65,-78),(0,-.94,-.34),6,gold)
for x in [-edge,edge]:
    box("Main end bearing pedestal",(x,0,-11),(17,58,50),iron,4)
    ring("End seal • crankshaft",(x,0,0),26,14,18,iron)
for y in (-depth,depth):
    box("Sump flange",(0,y,-13),(2*edge+8,8,4),iron,1.6)
    for x in [xs[0]-pitch*.44]+[a+pitch*.44 for a in xs]:
        bolt("Sump M6",(x,y,-11),size=3.7)
crank_skirt(1)
for j in range(n+1):
    x=-edge+pitch*j
    box("Main bearing web",(x,9,34),(12,38,65),iron,3)
    ring("Split bearing cap",(x,0,0),23,14,16,iron)
    for y in (-21,21):
        bolt("Main cap stud",(x,y,-14),(0,0,-1),4.5)
col=front
pan_half("Deep sump • inspection half",-1,panmat)
crank_skirt(-1)
rocker_cover()
# Continuous walls close the cam box down to the cylinder-head gasket.
for y in (-depth+2.5,depth-2.5):
    box("Cam chest • oil-tight wall",(0,y,256),(2*edge+4,7,40),headmat,3.4)
    for x in [-edge+11]+[x+pitch*.39 for x in xs]:
        side=1 if y>0 else -1
        cyl("Cover fastener tower",(x,y-side*1.3,236),(x,y-side*1.3,276),6.4,headmat)
        bolt("Rocker housing fastener",(x,y,276),size=3.9)
    box("Oil return gallery",(0,y,246),(2*edge-12,11,8),headmat,3.4)
    box("Rocker box gasket",(0,y,276),(2*edge+4,9,2.4),rubber,.8)
for side in (-1,1):
    box("Cam chest end",(side*edge,0,260),(8,2*depth,46),headmat,3.2)
    for sy in (-1,1):
        ring("Camshaft end seal",(side*(edge+4),sy*max(12,min(r*.54,32)),282),12,7.5,4,iron)
for side in (-1,1):
    col=front if side<0 else casting
    for x in xs:
        y=side*depth*.94
        cyl("Sand-core plug seat",(x,y-side*5,127),(x,y+side*2,127),15,paint)
        cyl("Pressed core plug",(x,y,127),(x,y+side*2.8,127),12.5,black)
        ring("Core plug lip",(x,y+side*3,127),13,10.7,2,iron,'Y')
col=front
for sy in (-1,1):
    for i in (0,1,2):
        yy=sy*depth*(.34+i*.11)
        box("Stamped strengthening bead",(0,yy,309-i*.3),(2*edge-36,3.4,3.3),covermat,1.5)
for x in xs:
    for sy in (-1,1):
        y=sy*depth*.78
        cyl("Cover screw boss",(x,y,295),(x,y,301),5.7,covermat)
        bolt("Cam cover screw",(x,y,301),size=3.8)
cyl("Filler neck",(xs[-1]-9,0,298),(xs[-1]-9,0,307),12,black)
cyl("Oil filler cap",(xs[-1]-9,0,306),(xs[-1]-9,0,316),16,black,18)
box("Oil cap grip",(xs[-1]-9,0,316),(25,6,4),rubber,2)
col=internals
crank=obj("Crankshaft • 720° cycle")
parent=crank
# Only the journals between neighbouring throws lie on the main-bearing axis.
for j in range(n-1):
    axle("Main shaft between throws",(xs[j]+xs[j+1])*.5,0,0,pitch-44,14,steel)
for side,x in [(-1,xs[0]),(1,xs[-1])]:
    end=side*(edge+47);cheek=x+side*22
    axle("Crank nose" if side<0 else "Flywheel drive flange",(end+cheek)/2,0,0,abs(end-cheek),14,steel)
def web(name,x,a):
    # Counterweighted cheeks carry the eccentric rod journal on the light side.
    vs=[];fs=[];k=48
    for xx in (-6,6):
        for j in range(k):
            q=tau*j/k
            rad=26+22*max(0,-cos(q))**.6+31*max(0,cos(q))**3
            yy=-rad*sin(q);zz=rad*cos(q)
            vs.append((xx,yy*cos(a)-zz*sin(a),yy*sin(a)+zz*cos(a)))
    fs=[tuple(reversed(range(k))),tuple(range(k,2*k))]+[(i,(i+1)%k,(i+1)%k+k,i+k) for i in range(k)]
    return bevel(mesh(name,vs,fs,iron,(x,0,0)),1.35)
pistons=[];rods=[];rod_meshes=[];valves=[];spring_objs=[]
for i,(x,offset) in enumerate(zip(xs,offsets)):
    parent=crank;a=-offset;y=-43*sin(a);z=43*cos(a)
    for d in (-19,19):web("Forged crank cheek",x+d,a)
    axle("Ground rod journal",x,y,z,31,13.8,steel)
    axle("Main journal",x-pitch/2,0,0,30,14.3,steel)
    parent=motor
    wrist=obj(f"{i+1:02d} • Piston / wrist pin");pistons.append(wrist);parent=wrist
    radius=r-.48
    profile=[(.001,-24),(radius-2.6,-24),(radius,-21),(radius,6),(radius-.8,8),(radius-.8,18),(radius-1,20),(radius-2,23),(radius*.71,23),(radius*.54,20.8),(.001,20.8)]
    lathe("Aluminium piston • dished crown",profile,(0,0,0),pistonmat)
    for h,w in [(8.5,2.7),(13,1.7),(17,1.7)]:
        ring("Compression ring" if w<2 else "Oil scraper ring",(0,0,h),radius+.06,radius-1.15,w,black,'Z')
    ring("Hollow wrist pin",(0,0,0),6.4,3.7,2*radius-1.2,steel)
    for side in (-1,1):ring("Wrist pin circlip",(side*(radius+.55),0,0),5.6,4.5,1,steel)
    parent=motor
    rod=obj(f"{i+1:02d} • Connecting rod");rods.append(rod);parent=rod
    ring("Big end • forged shoulder",(0,0,0),20.5,14.05,16.8,steel)
    ring("Small end • bronze bush",(0,0,142),11.5,6.5,13,gold)
    poly=[(-14,10),(-9,33),(-6.2,114),(-8.2,136),(8.2,136),(6.2,114),(9,33),(14,10)]
    vs=[(xx,y,z) for xx in (-5.6,5.6) for y,z in poly];k=len(poly)
    fs=[tuple(reversed(range(k))),tuple(range(k,k*2))]+[(j,(j+1)%k,(j+1)%k+k,j+k) for j in range(k)]
    bevel(mesh("Rod • tapered H-beam",vs,fs,steel),1.35)
    for side in (-1,1):
        tube("Forged rod flange",[(0,side*12,12),(0,side*7.2,51),(0,side*6,116),(0,side*8,133)],2,bright)
        cyl("Big-end cap screw",(0,side*16,-13),(0,side*16,8),3.5,black,12)
        bolt("Conrod nut",(0,side*16,-11),(0,0,-1),4)
    rod_meshes.append(list(rod.children))
parent=motor
col=head
cam_y=max(12,min(r*.54,32))
valve_radius=min(11.5,r*.265)
cams=[]
for side in (-1,1):
    cam=obj(("Exhaust" if side==1 else "Intake")+" camshaft • 2:1",(None),(0,side*cam_y,282))
    cams.append(cam);parent=cam
    axle("Ground camshaft",-8,0,0,2*edge+22,7.4,steel)
    for x,of in zip(xs,offsets):
        peak=of+(1.5 if side==1 else 2.5)*pi
        for xx in (-r*.39,r*.39):
            vs=[];k=42
            for dx in [-3.4,3.4]:
                for j in range(k):
                    q=tau*j/k
                    radius=14+8*max(0,cos(q-(pi-peak/2)))**8
                    vs.append((dx,-radius*sin(q),radius*cos(q)))
            fs=[tuple(reversed(range(k))),tuple(range(k,2*k))]+[(j,(j+1)%k,(j+1)%k+k,j+k) for j in range(k)]
            bevel(mesh("Ground cam lobe",vs,fs,steel,(x+xx,0,0)),.65)
    parent=motor
    for j in range(n+1):
        x=-edge+j*pitch
        box("Cam tower",(x,side*cam_y,255),(14,24,43),iron,3)
        ring("Split cam bearing",(x,side*cam_y,282),13.3,7.5,14,bright)
        for sy in (-1,1):bolt("Cam cap",(x,side*cam_y+sy*10,285),size=2.8)
    for i,x in enumerate(xs):
        for xx in (-r*.39,r*.39):
            v=obj("Valve • "+("exhaust" if side==1 else "intake"),None,(x+xx,side*cam_y,0));parent=v
            cyl("Valve stem",(0,0,215),(0,0,265),2.45,steel)
            lathe("Valve head",[(.001,215),(valve_radius*.94,215),(valve_radius,216.6),(valve_radius*.74,218),(2.5,223)],(0,0,0),steel)
            cyl("Tappet",(0,0,258),(0,0,268),7.8,black)
            cyl("Valve spring retainer",(0,0,256),(0,0,258),8.4,steel)
            parent=motor
            pts=[(7.2*cos(tau*5.75*j/92),7.2*sin(tau*5.75*j/92),27*j/92) for j in range(93)]
            spring=tube("Valve spring • music wire",pts,1.42,black,True)
            spring.location=xyz((x+xx,side*cam_y,229))
            valves.append((v,i,int(side>0),x+xx,side*cam_y));spring_objs.append(spring)
            ring("Valve spring seat",(x+xx,side*cam_y,229),9,3,3,steel,'Z')
for x in xs:
    lathe("Spark plug • ceramic",[(2.8,231),(5,240),(4,241),(5,244),(4,246),(5,249),(4,251),(5,254),(3,257),(2.8,263)],(x,0,0),ivory)
    cyl("Plug hex",(x,0,227),(x,0,236),7,steel,6)
    cyl("Plug well boot",(x,0,260),(x,0,305),4.2,rubber)
    ring("Plug well grommet",(x,0,301.5),7,4,3,rubber,'Z')
    terminal=xs[0]+(xs.index(x)-(n-1)/2)*10
    tube("HT lead",[(x,0,303),(x+4,3,314),(x+11,24,318),(x+15,depth+11,288),
                    (terminal+9,depth+18+xs.index(x)*4,264),(terminal,depth+26,257)],2.6,rubber)
    cyl("Coil tower",(terminal,depth+26,248),(terminal,depth+26,258),4.1,black)
box("Ignition coil pack",(xs[0],depth+25,242),(n*10+13,23,17),black,3.5)
box("Coil mounting bracket",(xs[0],depth+11,234),(n*10+19,32,4),iron,1.5)


col=drive;parent=motor
def wheel(name,x,y,z,rad,count,width,mat):
    hub=obj(name,None,(x,y,z))
    global parent
    old=parent;parent=hub
    ring("Toothed rim",(0,0,0),rad,rad*.76,width,mat)
    axle("Keyed hub",0,0,0,width+4,rad*.32,steel)
    for j in range(6):
        q=tau*j/6
        cyl("Cast spoke",(0,0,0),(0,rad*.85*sin(q),rad*.85*cos(q)),rad*.095,mat,10)
    # Cut a single continuous toothed profile around the rim.
    k=count*4;vs=[];fs=[]
    for xx in (-width/2,width/2):
        for j in range(k):
            rr=rad+(1.6 if j%4 in (1,2) else -.5);q=tau*j/k
            vs.append((xx,rr*sin(q),rr*cos(q)))
    for j in range(k):fs.append((j,(j+1)%k,(j+1)%k+k,j+k))
    mesh("Tooth flanks",vs,fs,black)
    bolt("Retaining bolt",(-width/2-2,0,0),(-1,0,0),rad*.19)
    parent=old
    return hub
timex=-edge-19
cam_radius=min(28,cam_y-2.8)
crank_radius=cam_radius/2
timers=[wheel("Crank timing wheel",timex,0,0,crank_radius,18,10,steel)]
for side in (-1,1):timers.append(wheel("Cam timing wheel",timex,side*cam_y,282,cam_radius,36,10,iron))
# Outer common tangents of the crank wheel and twin cam wheels.
small,big=crank_radius+1.5,cam_radius+1.5
length=math.hypot(cam_y,282)
q=math.atan2(282,cam_y)-math.acos((small-big)/length)
def belt_arc(y,z,rad,start,end,steps):
    return [(y+rad*cos(start+(end-start)*i/steps),z+rad*sin(start+(end-start)*i/steps)) for i in range(steps+1)]
path=(belt_arc(cam_y,282,big,q,pi/2,22)+belt_arc(-cam_y,282,big,pi/2,pi-q,22)
      +belt_arc(0,0,small,pi-q,tau+q,36))
vs=[];fs=[]
for i,(yy,zz) in enumerate(path):
    prev=path[i-1];nxt=path[(i+1)%len(path)]
    # Average unit tangents so the short arc segments meet the long straight runs without a kink.
    t=Vector((yy-prev[0],zz-prev[1])).normalized()+Vector((nxt[0]-yy,nxt[1]-zz)).normalized()
    t.normalize();ny,nz=t.y,-t.x
    for dx,h in [(-5.7,0),(5.7,0),(5.7,2.2),(-5.7,2.2)]:
        vs.append((timex+dx,yy+h*ny,zz+h*nz))
for i in range(len(path)):
    for j in range(4):
        a=i*4+j;b=((i+1)%len(path))*4+j
        fs.append((a,b,b-j+(j+1)%4,a-j+(j+1)%4))
mesh("Reinforced timing belt",vs,fs,rubber)
# Speed wheel, flywheel, flywheel ring gear, starter and coupling.
parent=crank
fly=wheel("Flywheel and starter ring",edge+25,0,0,60,82,15,iron)
axle("Flywheel friction face",edge+36,0,0,6,52,steel)
for j in range(8):
    a=tau*j/8
    bolt("Flywheel fastener",(edge+40,26*sin(a),26*cos(a)),(1,0,0),3.5)
parent=motor
sx=edge+43
axle("Starter solenoid",sx,45,-29,49,12,black)
axle("Starter motor can",sx,49,-47,87,18,iron)
for dx in (-36,36):ring("Starter end band",(sx+dx,49,-47),19,16,5,bright)
# Oil filter and spin-on cap, accessible from the left end.
fx=-edge-11
cyl("Oil filter • drum",(fx,depth-1,23),(fx,depth-1,83),17,black)
for zz in (27,78):ring("Oil filter rolled seam",(fx,depth-1,zz),17.5,15,2,steel,'Z')
belt_y=-(small+126*(-sin(q)))/cos(q)
axle("Timing tensioner",timex,belt_y+12/cos(q),126,10,12,steel)
col=plumbing
manifold_y=depth+31
for x in xs:
    box("Exhaust flange",(x,depth+1,221),(40,8,24),rust,3)
    for xx in [-15,15]:bolt("Exhaust flange stud",(x+xx,depth+6,221),(0,1,0),3.8)
    tube("Cast exhaust runner",[(x,depth,221),(x,manifold_y+4,220),(x+15,manifold_y+19,188),(x+25,manifold_y,166)],10.6,rust)
tube("Exhaust collector",[(xs[0]+21,manifold_y,166),(xs[-1],manifold_y,163),(edge+38,manifold_y,153),(edge+53,manifold_y,103),(edge+82,manifold_y,81)],15,rust)
for xx in [edge+60,edge+66]:
    tube("Exhaust clamp",[(xx,manifold_y,93),(xx+1.5,manifold_y,91)],19.5,steel,True)
mx=edge+121
axle("Absorptive silencer",mx,manifold_y,81,88,24,iron)
for xx in (mx-42,mx+42):ring("Rolled silencer seam",(xx,manifold_y,81),25,21,3,steel)
tube("Tail pipe bend",[(mx+42,manifold_y,81),(mx+58,manifold_y,81),(mx+76,manifold_y,90)],10.5,black)
tip=(mx+81,manifold_y,92)
ring("Open soot-black tailpipe",tip,11,8.8,13,rust)
# Intake components come away together with the inspection section.
col=front
for x in xs:
    tube("Intake runner",[(x,-depth+2,222),(x,-depth-18,218),(x+9,-depth-28,193)],10,iron)
plenum_y=-depth-29
lathe("Cast intake plenum",[(.1,-edge+4),(10,-edge+5),(15,-edge+11),(16,-edge+22),
      (16,edge-16),(14,edge-6),(12,edge+1),(10,edge+5)],(0,plenum_y,188),headmat,'X')
ring("Throttle flange",(edge+5,plenum_y,188),18,10,6,iron)
ring("Throttle body",(edge+16,plenum_y,188),13,9,19,headmat)
for j in range(3):
    q=tau*j/3;bolt("Throttle flange bolt",(edge+8,plenum_y+15*sin(q),188+15*cos(q)),(1,0,0),2.5)
tube("Intake elbow",[(edge+23,plenum_y,188),(edge+39,plenum_y,188),(edge+54,plenum_y,181),(edge+59,plenum_y,163)],11.8,rubber)
for x in (edge+25,edge+32):
    ring("Hose band",(x,plenum_y,188),12.6,11.3,2.4,steel)
xx=edge+59
lathe("Oil bath air cleaner",[(.1,110),(19,110),(23,114),(23,122),(22,123),(22,151),
      (25,153),(25,156),(19,159),(12,160),(11,164)],(xx,plenum_y,0),covermat)
for zz in (119,123,151):
    ring("Air cleaner rolled bead",(xx,plenum_y,zz),23.9,21.3,2,black,'Z')
for j in range(16):
    q=tau*j/16
    tube("Air cleaner inlet slot",[(xx+22.1*cos(q),plenum_y+22.1*sin(q),140),
         (xx+22.1*cos(q),plenum_y+22.1*sin(q),147)],1.05,black,True)
box("Air cleaner support",(xx,plenum_y+16,123),(11,25,4),iron,2)
tube("Filter support arm",[(xx,plenum_y+23,123),(xx-12,-depth+5,118),(edge-4,-depth*.88,110)],3.5,iron)
col=plumbing
radx=-edge-87
box("Radiator core",(radx,44,101),(57,25,118),black,3)
for j in range(33):
    box("Heat exchanger fin",(radx,29,47+3.35*j),(53,5,1.05),steel)
for z in (39,162):box("Radiator header",(radx,42,z),(64,32,15),iron,5)
cyl("Coolant filler",(radx+9,41,167),(radx+9,41,175),9,gold,8)
for z in (46,157):
    tube("Fabric reinforced coolant hose",[(radx+24,42,z),(radx+39,44,z+2),(-edge-31,depth+19,z+15),(-edge+8,depth+14,198 if z>100 else 61)],5.2,rubber)
    ring("Worm drive hose clip",(radx+30,42,z),6.3,5.2,3,steel)
for side in (-1,1):
    tube("Rigid oil line",[(edge-8,side*(depth-8),-54),(edge+12,side*(depth-1),-45),(edge+12,side*(depth-1),133),(edge-4,side*(depth-4),166)],2.0,gold)
col=stand;parent=None
skidmid=15;span=2*edge+300
for y in (-101,101):
    box("Welded channel rail",(skidmid,y,-122),(span,24,27),iron,2.2)
    box("Channel • polished edge",(skidmid,y,-112),(span+3,26,4),basepaint,1.1)
    for x in (skidmid-span/2+10,skidmid+span/2-10):
        box("Anchor foot",(x,y,-139),(43,46,8),black,2);bolt("Anchoring stud",(x,y,-135),size=6)
for x in (xs[0]-27,xs[-1]+27,edge+86):
    box("Skid crossmember",(x,0,-115),(23,215,18),basepaint,2.2)
for x in (xs[0]-20,xs[-1]+20):
    for y in (-55,55):
        box("Mount sole",(x,y,-99),(51,37,7),iron,2)
        cyl("Rubber isolator",(x,y,-96),(x,y,-82),13.5,rubber)
        parent=motor
        box("Engine mounting lug",(x,y,-81),(37,32,6),paint,2)
        tube("Cast mount ear",[(x,y,-79),(x,math.copysign(depth+3,y),-62),(x,math.copysign(depth-2,y),-26),(x,math.copysign(depth-5,y),-6)],5.6,paint)
        parent=None
        bolt("Isolator through bolt",(x,y,-78),size=5)
dx=edge+91
box("Dynamometer pedestal",(dx,0,-65),(58,60,94),iron,6)
axle("Eddy-current brake housing",dx,0,0,73,41,paint)
for j in range(9):
    ring("Absorber cooling fin",(dx-27+j*6.5,0,0),43,38,2.2,iron)
axle("Dynamometer spindle",edge+55,0,0,41,12,steel)
for y in [-80,80]:
    box("Radiator support",(radx,y/2,-34),(10,10,136),iron,2)
# Engraved maker plate fixed to the skid, legible from the inspection side.
box("Stamped identity plate",(0,-114,-117),(min(218,span*.45),2.2,20),black,1.3)
label("Skid identification","LAST PISTON    /    MOTOR  LAB",(0,-115.4,-115),7.4)
label("Spec stamping",f"INLINE {n}     •     {litres:.1f} L     /     DOHC     •     4-STROKE",(0,-115.4,-122),3.4,gold)
for x in (-min(101,span*.20),min(101,span*.20)):
    bolt("Plate rivet",(x,-115,-117),(0,-1,0),1.9)


# Recessed water jacket ribs, sealing studs and an oil-stained parting line.
col=casting;parent=motor
for j in range(n+1):
    x=-edge+j*pitch
    for sy in (-1,1):
        y=sy*(depth-16)
        box("Cylinder bank • tie rib",(x,y,136),(8,10,139),paint,3)
        cyl("Head bolt boss",(x,y,200),(x,y,242),5.8,iron)
        bolt("Head stud • washer and nut",(x,y,242),size=4.6)
    if j not in (0,n):
        box("Window mullion • cast fillet",(x,-depth+15,68),(13,13,20),iron,3)
for x in (-edge,edge):
    col=casting
    box("Crankcase end diaphragm",(x,0,37),(11,2*depth-2,56),paint,4)
    ring("Crank seal carrier",(x,0,0),26.5,16,12,iron)
    for yy,zz in [(-22,9),(22,9),(-20,-13),(20,-13)]:
        bolt("Seal carrier fastener",(x+(6 if x>0 else -6),yy,zz),(1 if x>0 else -1,0,0),3.2)
# Head bridge and individual guide bosses support the visible valve seats and springs.
col=head
box("Central plug gallery",(0,0,237),(2*edge+3,22,20),iron,4)
for x in xs:
    for xx in (-r*.39,r*.39):
        for sy in (-1,1):
            y=sy*cam_y
            box("Seat bridge",(x+xx,y*.51,228),(18,abs(y)+6,10),iron,2.8)
            ring("Cast guide boss",(x+xx,y,230),10.3,3,9,iron,'Z')
            ring("Phosphor bronze valve guide",(x+xx,y,234),4.2,2.5,10,gold,'Z')
col=front
for x in xs:
    for side in (-1,1):
        col=front if side<0 else casting
        for dx in (-pitch*.32,pitch*.32):
            # Filleted cast webs are wide at the main-bearing bulkhead and die into the cylinder wall.
            vs=[]
            for z,spread,raise_by in [(67,7,8),(79,5,7),(147,3.7,4.5),(193,2.5,1.5)]:
                f=(z-64)/141
                hit=depth*(1-.15*(abs(dx)/(pitch/2))**2)*(.89+.11*f)
                xx=x+dx*(1.04-.12*f)
                for dd,yy in [(-spread,hit-2),(spread,hit-2),(spread*.46,hit+raise_by),(-spread*.46,hit+raise_by)]:
                    vs.append((xx+dd,side*yy,z))
            faces=[(0,3,2,1),(12,13,14,15)]+[(j*4+k,j*4+(k+1)%4,(j+1)*4+(k+1)%4,(j+1)*4+k) for j in range(3) for k in range(4)]
            bevel(mesh("Drafted bulkhead rib",vs,faces,paint),1.35)
col=front
# Piston crown carbon, thrust-face scuffs and scraper returns.
for i,wrist in enumerate(pistons):
    parent=wrist;col=internals
    lathe("Combustion deposits • bowl",[(.01,20.95),(r*.53,20.95),(r*.70,23.10),(r*.76,23.1)],(0,0,0),iron)
    for j in range(12):
        a=tau*j/12
        pt=Vector(((r-.8)*cos(a),(r-.8)*sin(a),6.15));normal=Vector((cos(a),sin(a),0))
        cyl("Oil scraper return drill",pt-normal*.65,pt+normal*.12,1.1,black,12)
    for j in range(7):
        a=-pi/2+rng.uniform(-.62,.62);z=rng.uniform(-17,-4)
        if rng.random()>wear+.18:continue
        rr=r-.45
        tube("Skirt witness mark",[(rr*cos(a),rr*sin(a),z),(rr*cos(a+.002),rr*sin(a+.002),z+rng.uniform(3,12))],.19,steel,True)
# Stand electrics, rubber cable grommets and local oil gauge.
col=stand;parent=None
bx=-edge-86;by=-54
box("Battery tray",(bx,by,-94),(69,54,5),black,1.7)
box("Starter battery • moulded case",(bx,by,-70),(62,47,45),rubber,3)
box("Battery lid",(bx,by,-46),(64,49,6),black,1.6)
for j in range(6):
    cyl("Cell vent",(bx-22+8.8*j,by+4,-44),(bx-22+8.8*j,by+4,-40),2.5,black)
red=alloy("Positive cable • faded oxide red",(.071,.013,.009),(.29,.043,.022),.03,.62)
for side in (-1,1):
    xx=bx+side*23;yy=by-12
    cyl("Battery terminal",(xx,yy,-44),(xx,yy,-36),3.5,steel)
    ring("Terminal clamp",(xx,yy,-38),5.4,3.3,3.2,gold,'Z')
    cable=red if side>0 else rubber
    dest=(edge+34,48,-23) if side>0 else (xs[0]-14,-50,-80)
    tube("Battery cable",[(xx,yy,-36),(xx+side*7,yy-4,-39),(xx+side*10,yy-2,-79),(xx+18,-24,-91),(10,13,-92),dest],2.5,cable)
box("Battery type plate",(bx,by-24,-65),(44,1,14),ivory,.7)
label("Battery stamp","12 V   /   Pb",(bx,by-24.8,-65),5.3,black)
col=drive;parent=motor
# Tubular dipstick and the pull loop.
tube("Dipstick tube",[(edge-12,-depth+3,-44),(edge-3,-depth-11,19),(edge-9,-depth-12,75),(edge-16,-depth-11,89)],2.3,gold)
ring("Dipstick handle",(edge-16,-depth-11,94),6.3,3.9,2.5,basepaint,'Y')
col=plumbing;parent=None
gx=-edge-79;gy=-6;gz=92;rr=17
tube("Copper pressure takeoff",[(xs[0]-30,-depth+8,62),(xs[0]-41,-depth+2,45),(gx+17,gy+8,49),(gx,gy+8,gz)],1.6,gold)
cyl("Gauge cup",(gx,gy+11,gz),(gx,gy-1,gz),rr+2,black)
cyl("Enamel dial",(gx,gy-.9,gz),(gx,gy-2,gz),rr,ivory)
ring("Gauge bezel",(gx,gy-3,gz),rr+2.3,rr-1.6,3.5,steel,'Y')
for j in range(17):
    a=math.radians(-125+250*j/16)
    tube("Pressure graduation",[(gx+(12 if j%4 else 10.5)*sin(a),gy-2.5,gz+(12 if j%4 else 10.5)*cos(a)),(gx+14*sin(a),gy-2.5,gz+14*cos(a))],.47,black,True)
label("Gauge units","bar",(gx,gy-2.8,gz-7),4.1,black)
needle=obj("Oil pressure • needle pivot",None,(gx,gy-4,gz));parent=needle
tube("Black enamel pointer",[(0,0,-2.3),(0,0,12.3)],.72,red,True)
parent=None
cyl("Needle jewel",(gx,gy-4,gz),(gx,gy-5,gz),1.7,black)
for frame,sample in enumerate(frames,1):
    pressure=sample['pressure']
    needle.rotation_euler.y=math.radians(-125+250*min(1,pressure/6))
    needle.keyframe_insert(data_path="rotation_euler",frame=frame)
# Brushed maker lettering stands slightly proud of the closed rocker cover.
parent=motor;col=front
top_label=label("Cam cover casting mark","L A S T   P I S T O N",(-pitch*.12,-depth*.75,303.8),6.5,bright);top_label.rotation_euler.x=0

def key(o,prop,val,f):
    setattr(o,prop,val);o.keyframe_insert(data_path=prop,frame=f,group="Stand recording")
def visibility(o,f,show):
    key(o,'hide_render',not show,f);key(o,'hide_viewport',not show,f)
def rotation(o,v,f):key(o,'rotation_euler',v,f)
def position(o,v,f):key(o,'location',xyz(v),f)
def scale(o,v,f):key(o,'scale',v,f)
# Each moving joint stays independent; bolt sets, castings and pipes move as rigid meshes.
join_rigid_parts(scene,set(spring_objs))
rod_meshes=[list(rod.children) for rod in rods]
bpy.context.view_layer.update()
scene["Cylinders"]=n
inspection_finishes(scene,{paint:'block',covermat:'cover',panmat:'pan',rust:'exhaust',headmat:'head',iron:'iron'},wear,pitch)
if args.out.suffix.lower()=='.glb':
    from runtime_export import export_rig
    export_rig(args.out, motor, crank, timers, cams, rods, pistons, valves, spring_objs,
               needle, front, xyz(tip), pitch*u, xyz((xs[0],0,0))[0])
    sys.exit(0)
scene["Cutaway"]=False
scene["Displacement (L)"]=litres;scene["Initial wear (%)"]=round(wear*100)
scene.id_properties_ui("Cutaway").update(description="Hide the removable casting, sump, intake and cam cover to inspect the running gear")
for o in front.objects:
    for prop in ('hide_render','hide_viewport'):
        curve=o.driver_add(prop);driver=curve.driver;driver.type='AVERAGE'
        var=driver.variables.new();var.name='section';var.type='SINGLE_PROP'
        var.targets[0].id_type='SCENE';var.targets[0].id=scene;var.targets[0].data_path='["Cutaway"]'
# Native simple drivers let a paused crank turn the rods, pistons and valves together.
# Only the recorded driving angle and the transient mount / fluid states need keys.
scene["Crank trim (degrees)"]=0.0
scene.id_properties_ui("Crank trim (degrees)").update(min=-720,max=720,soft_min=0,soft_max=720,description="Rotate the crank by hand while playback is paused")
motor["Recorded crank (rad)"]=0.0
def driven(o,channel,index,expr,inputs):
    d=o.driver_add(channel,index).driver;d.type='SCRIPTED'
    for name,target,path in inputs:
        v=d.variables.new();v.name=name;v.type='SINGLE_PROP'
        v.targets[0].id_type='SCENE' if target==scene else 'OBJECT'
        v.targets[0].id=target;v.targets[0].data_path=path
    d.expression=expr
driven(crank,'rotation_euler',0,'record+trim*0.0174532925199433',[
    ('record',motor,'["Recorded crank (rad)"]'),('trim',scene,'["Crank trim (degrees)"]')])
shaft=[('a',crank,'rotation_euler[0]')]
for i,g in enumerate(timers):driven(g,'rotation_euler',0,'a/2' if i else 'a',shaft)
for cam in cams:driven(cam,'rotation_euler',0,'a/2',shaft)
for i,(x,of) in enumerate(zip(xs,offsets)):
    phase=f'(a-{of:.12f})';y=f'(-0.43*sin({phase}))';z=f'(0.43*cos({phase}))'
    rods[i].location.x=x*u;pistons[i].location.x=x*u
    driven(rods[i],'location',1,y,shaft);driven(rods[i],'location',2,z,shaft)
    driven(rods[i],'rotation_euler',0,f'asin({y}/1.42)',shaft)
    top=f'{z}+sqrt(1.42**2-{y}**2)'
    failure=next((j for j,s in enumerate(frames) if not s['live'][i]),None)
    if failure is not None:
        kind,freeze=take['failures'][i]
        phase_at_break=freeze-of
        parked=.43*cos(phase_at_break)+sqrt(1.42**2-(.43*sin(phase_at_break))**2)
        top=f'{top} if frame<{failure+1} else {parked:.10f}'
        for o in rod_meshes[i]:
            visibility(o,1,True);visibility(o,failure+1,False)
        # The cap remains on the live journal. The broken upper shank stays on the wrist.
        parent=crank;col=internals
        j_y=43*sin(of);j_z=43*cos(of)
        remnant=ring("Fractured big end • retained bearing",(x,j_y,j_z),20.5,14.05,16.8,steel)
        lower=cyl("Torn lower shank",(x,j_y,j_z+11),(x,j_y+11,j_z+26),5.2,iron,6)
        parent=pistons[i]
        upper=cyl("Torn upper shank",(0,0,-5),(0,-3,-37),5.4,steel,6)
        for part in (remnant,lower,upper):
            visibility(part,1,False);visibility(part,failure+1,True)
        if kind=='ejected':
            for part in pistons[i].children:
                visibility(part,1,part!=upper);visibility(part,failure+1,False)
    driven(pistons[i],'location',2,top,shaft)
for (v,i,side,x,y),sp in zip(valves,spring_objs):
    start=offsets[i]+(pi if side else tau)
    d=f'((a-{start:.12f})%{2*tau:.12f})'
    lift=f'(sin({d})**2 if {d}<3.14159265359 else 0)'
    driven(v,'location',2,'-0.08*'+lift,shaft)
    driven(sp,'scale',2,'1-8/27*'+lift,shaft)
# Mount displacement and angular input follow the full captured run.
for f,s in enumerate(frames,1):
    px,py,rock=s['pose']
    position(motor,(px*.65,0,-py*.70),f);rotation(motor,(rock*.62,rock*.46,0),f)
    motor["Recorded crank (rad)"]=s['angle']
    motor.keyframe_insert(data_path='["Recorded crank (rad)"]',frame=f,group="Crankshaft")
# Track the actual finite oil packets and debris from the engine save/model.
col=fluids;parent=motor
def bead_data():
    vs=[];fs=[];k=12;h=7
    for i in range(h+1):
        a=pi*i/h
        for j in range(k):
            q=tau*j/k;vs.append((sin(a)*cos(q),sin(a)*sin(q),cos(a)))
    for i in range(h):
        for j in range(k):
            a=i*k+j;b=i*k+(j+1)%k;fs.append((a,b,b+k,a+k))
    me=bpy.data.meshes.new("Oil meniscus");me.from_pydata(vs,[],fs);me.materials.append(oil)
    for face in me.polygons:face.use_smooth=True
    return me
bead=bead_data()
tracks={};shards={}
for f,s in enumerate(frames,1):
    for ident,x,y,film,volume in s['oil']:
        tracks.setdefault(ident,[]).append((f,x,y,film,volume))
    for ident,kind,cy,x,y,angle in s['debris']:
        shards.setdefault((ident,kind,cy),[]).append((f,x,y,angle))
def map_point(x,y,depth_y):
    return ((x-373)/144*pitch+xs[0],depth_y,460-y)
for ident,trail in tracks.items():
    o=obj("Oil • "+str(ident),bead)
    f0=trail[0][0];scale(o,(0,0,0),1);scale(o,(0,0,0),max(1,f0-1))
    yplane=rng.uniform(-depth*.75,depth*.65)
    for f,x,y,film,vol in trail:
        pos=map_point(x,y,yplane if not film else yplane*.94)
        position(o,pos,f);rr=max(.65,min(3.7,(vol*1e6*.239)**(1/3)))*u
        scale(o,(rr*.75,rr*.66,rr*(2.2 if film else 1.25)),f)
    if trail[-1][0]<len(frames):scale(o,(0,0,0),trail[-1][0]+1)
for (ident,kind,cy),trail in shards.items():
    o=box("Fragment • "+kind,(0,0,0),(10,7,31) if kind=='rod' else (6,3,3),steel,.75)
    visibility(o,1,False);visibility(o,trail[0][0],True)
    yplane=rng.uniform(-17,17)
    for f,x,y,a in trail:
        position(o,map_point(x,y,yplane),f);rotation(o,(a,.12,ident*.7),f)
    if trail[-1][0]<len(frames):visibility(o,trail[-1][0]+1,False)
# Bounded noise volumes leave the open end of the actual tail pipe.
smoke=bpy.data.materials.new("Soot in suspension • volume");smoke.use_nodes=True
nt=smoke.node_tree;nt.nodes.remove(nt.nodes.get('Principled BSDF'))
def link(a,out,b,slot):nt.links.new(a.outputs[out],b.inputs[slot])
tc=nt.nodes.new('ShaderNodeTexCoord')
dist=nt.nodes.new('ShaderNodeVectorMath');dist.operation='DISTANCE';dist.inputs[1].default_value=(.5,.5,.5);link(tc,'Generated',dist,0)
fall=nt.nodes.new('ShaderNodeMapRange');fall.inputs['From Min'].default_value=.11;fall.inputs['From Max'].default_value=.51;fall.inputs['To Min'].default_value=1;fall.inputs['To Max'].default_value=0;link(dist,'Value',fall,'Value')
tex=nt.nodes.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=4.1;tex.inputs['Detail'].default_value=3.5;link(tc,'Generated',tex,'Vector')
mask=nt.nodes.new('ShaderNodeMapRange');mask.inputs['From Min'].default_value=.37;mask.inputs['From Max'].default_value=.68;mask.inputs['To Max'].default_value=6;link(tex,'Fac',mask,'Value')
mul=nt.nodes.new('ShaderNodeMath');mul.operation='MULTIPLY';link(fall,'Result',mul,0);link(mask,'Result',mul,1)
vol=nt.nodes.new('ShaderNodeVolumePrincipled');vol.inputs['Color'].default_value=(.064,.058,.050,1);link(mul,0,vol,'Density');link(vol,'Volume',nt.nodes.get('Material Output'),'Volume')
# The solid viewport displays soft puffs on the same closed volume bounds used by Eevee.
# A real exhaust jet starts at the lip; its first key must precede its first downstream sample.
smoke.diffuse_color=(.13,.12,.105,.24)
puff=bead.copy();puff.name='Exhaust plume envelope';puff.materials.clear();puff.materials.append(smoke)
uv=puff.uv_layers.new(name='Plume')
for loop in puff.loops:
    v=puff.vertices[loop.vertex_index].co
    uv.uv[loop.index].vector=(.5+.49*v.x,.5+.49*v.z)
for v in puff.vertices:
    v.co.x*=16*u;v.co.y*=12*u;v.co.z*=12.5*u
import numpy as np
gy,gx=np.mgrid[-1:1:96j,-1:1:96j]
density=np.clip(1-gx*gx-gy*gy,0,1)**2
wisps=.68+.16*np.sin(9*gx+6*gy)+.14*np.cos(8*gy-3*gx)
pixels=np.ones((96,96,4),np.float32)
pixels[:,:,:3]=(.35+.15*wisps)[:,:,None];pixels[:,:,3]=density*wisps*.58
cloud=bpy.data.images.new('Soot • viewport opacity',width=96,height=96,alpha=True)
cloud.pixels.foreach_set(pixels.ravel());cloud.pack()
thumbnail=nt.nodes.new('ShaderNodeTexImage');thumbnail.image=cloud;nt.nodes.active=thumbnail
for f in range(35,216,5):
    s=frames[f-1];loaded=s['gas']>.22
    if s['state']!='running' or (not loaded and f%3):continue
    o=obj("Exhaust • entrained soot",puff,tip);o.show_transparent=True
    position(o,(tip[0]+7,tip[1],tip[2]),f)
    scale(o,(0,0,0),1);scale(o,(0,0,0),f-1)
    scale(o,(.32,.3,.3),f)
    strength=.85+s['gas'];life=15+int(9*strength)
    for k in (.38,.74,1):
        rr=(.60+strength)*k
        position(o,(tip[0]+6+(49+strength*48)*k,tip[1]+sin(f)*k*9,tip[2]+k**1.6*(35+strength*18)),f+round(k*life))
        scale(o,(rr*2.8,rr*1.7,rr*2.1),f+round(k*life))
    scale(o,(0,0,0),f+life+1)
# Flight recorder and the original runtime stay independent of camera settings.
col=studio;parent=None
box("Shop floor",(0,0,-148),(15000,15000,9),floor,2)
world=bpy.data.worlds.new("Workshop • cool ambient");world.use_nodes=True;scene.world=world
world.node_tree.nodes['Background'].inputs[0].default_value=(.36,.40,.43,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.38
def camera(name,loc,aim,span):
    data=bpy.data.cameras.new(name);o=obj(name,data,loc)
    o.rotation_euler=(Vector(xyz(aim))-o.location).to_track_quat('-Z','Y').to_euler()
    data.type='ORTHO';data.ortho_scale=span*u;data.lens=55;return o
width=2*edge+346
cam=camera("01 • Bench / inspection",(-660,-1250,480),(22,6,82),width*1.29)
cam2=camera("02 • Big ends / crankcase",(225,-608,144),(0,0,48),pitch*2.65)
cam3=camera("03 • Rear manifold",(520,990,480),(12,13,82),width*1.31)
scene.camera=cam
def light(name,loc,aim,energy,size,color,width=None):
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.color=color
    data.shape='RECTANGLE';data.size=size*u;data.size_y=(width or size)*u
    o=obj(name,data,loc);o.rotation_euler=(Vector(xyz(aim))-o.location).to_track_quat('-Z','Y').to_euler()
light("Large northern window",(-340,-410,690),(0,0,80),1280,470,(.89,.94,1),350)
light("Warm service strip",(230,260,520),(0,0,90),1780,390,(1,.77,.53),125)
light("Pit reflection",(160,-470,110),(0,0,80),280,300,(1,.88,.73),120)
light("Flywheel rim",(440,110,310),(0,0,120),680,190,(.72,.85,1))
light("Soft roof",(-120,110,580),(0,0,85),440,420,(.85,.90,1))
scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.cycles.preview_samples=8;scene.cycles.use_preview_denoising=True
# Use the realtime renderer when the inspection viewport is switched to rendered shading.
scene.render.engine='BLENDER_EEVEE'
scene.eevee.taa_samples=12;scene.eevee.volumetric_samples=24
scene.cycles.max_bounces=6;scene.cycles.volume_bounces=1
scene.render.resolution_x=1440;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.view_settings.view_transform='AgX'
scene.render.film_transparent=False
for f,title in [(1,"OFF"),(9,"KEY  /  STARTER"),(49,"IDLE"),(73,"THROTTLE"),(106,"LIFT"),(161,"THROTTLE"),(184,"LIFT"),(218,"KEY OFF"),(255,"OIL DRAIN")]:
    scene.timeline_markers.new(title,frame=f)
if not all(frames[150]['live']):scene.timeline_markers.new("02  /  ROD FAILURE",frame=151)
seq=scene.sequence_editor_create()
strip=seq.strips.new_sound("Bench • original stereo mix",str(args.take/"motor.wav"),1,1)
# An audio-only sequence keeps the camera image and includes the mix on movie export.
scene.render.use_sequencer=True
strip.sound.pack()
strip.sound.filepath='//motor.wav'
# Drive frames from the playback clock; coarse device-position updates can repeat pictures.
scene.sync_mode='FRAME_DROP'
readme=bpy.data.texts.new("Начать здесь")
readme.write('LAST PISTON  /  СТЕНД\n\nПробел — воспроизведение 14-секундной записи. Num 0 — камера. Средняя кнопка мыши — облететь мотор.\nСвойства сцены → Custom Properties → Cutaway: включите, чтобы открыть разрез.\nCrank trim (degrees) в той же панели — повернуть коленвал вручную на паузе.\nКонструктор.cmd рядом с исходной сборкой создаёт новый мотор с выбранными параметрами.\nКамеры 02 и 03 — крупный план кривошипа и вид со стороны выпуска.\nНа шкале времени отмечены стартер, перегазовка, сброс и остановка. Если задан обрыв шатуна, он отмечен отдельным маркером.\nВ этом дубле встроен стереозвук действующей модели стенда. Фазы механизма замедлены так же, как в её разрезе.\nЧисло цилиндров, литраж и начальный износ задаются при записи дубля; параметры на панели сцены указывают, какой двигатель записан.\n')
for sc in bpy.data.screens:
    for ar in sc.areas:
        if ar.type=='PROPERTIES':ar.spaces.active.context='SCENE'
        if ar.type=='VIEW_3D':
            space=ar.spaces.active;space.region_3d.view_perspective='ORTHO'
            space.region_3d.view_rotation=cam.rotation_euler.to_quaternion();space.region_3d.view_location=xyz((15,0,85));space.region_3d.view_distance=width*u*.89
            space.overlay.show_overlays=False;space.clip_end=300;space.show_region_ui=False
            space.shading.type='SOLID';space.shading.color_type='TEXTURE';space.shading.light='STUDIO';space.shading.studio_light='paint.sl';space.shading.show_cavity=False;space.shading.show_shadows=False
scene.frame_set(1)
# Save an orbitable inspection view around the motor, with camera framing on entry.
args.out.parent.mkdir(parents=True,exist_ok=True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(args.out.resolve()),compress=True)

