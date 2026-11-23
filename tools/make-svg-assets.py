from pathlib import Path
import math,json,hashlib
root=Path(__file__).resolve().parents[1]; out=root/'assets/svg';out.mkdir(parents=True,exist_ok=True)
def svg(name,w,h,title,body,defs=''):
    text=f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title"><title id="title">{title}</title><defs>
    <linearGradient id="steel" x1="0" y1="0" x2=".82" y2="1"><stop stop-color="#8f8b80"/><stop offset=".18" stop-color="#e8e1d3"/><stop offset=".36" stop-color="#bcb8ad"/><stop offset=".68" stop-color="#848479"/><stop offset="1" stop-color="#514f46"/></linearGradient>
    <linearGradient id="dark" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="#777567"/><stop offset=".45" stop-color="#47463a"/><stop offset="1" stop-color="#2a2922"/></linearGradient>
    <linearGradient id="brass"><stop stop-color="#805a32"/><stop offset=".3" stop-color="#dfbe7f"/><stop offset=".58" stop-color="#aa824a"/><stop offset="1" stop-color="#bf9c64"/></linearGradient>
    <pattern id="turned" width="2" height="2" patternUnits="userSpaceOnUse"><path d="M0 .5h2" stroke="#e8dfcd" opacity=".12" stroke-width=".4"/></pattern>
    <g id="bolt"><circle r="3.8" fill="#26251d"/><path d="M-2.8-1.6V1.6L0 3.2l2.8-1.6v-3.2L0-3.2Z" fill="#b4afa0" stroke="#e0dacc" stroke-width=".45"/><path d="M-1.3 0h2.6" stroke="#5d594c" stroke-width=".7"/></g>{defs}</defs>{body}</svg>'''
    (out/(name+'.svg')).write_bytes(text.encode('utf-8'))
    return text
assets={}
fins='<pattern id="fin" width="7" height="3.4" patternUnits="userSpaceOnUse"><path d="M0 .3h7M0 1.8h7" stroke="#797262" stroke-width=".6"/><path d="M0 2.9l2-2.8 2.1 2.8L6.7.3" fill="none" stroke="#a19374" stroke-opacity=".58" stroke-width=".45"/></pattern>'
tanks='<linearGradient id="tank"><stop stop-color="#201f1a"/><stop offset=".24" stop-color="#4c473b"/><stop offset=".45" stop-color="#3a362d"/><stop offset="1" stop-color="#24231e"/></linearGradient>'
copper='<linearGradient id="copper"><stop stop-color="#302c23"/><stop offset=".33" stop-color="#776047"/><stop offset=".55" stop-color="#9a7952"/><stop offset="1" stop-color="#50412f"/></linearGradient>'
body='<path d="M4 7h110l3 6v150l-7 7H8l-5-5V12Z" fill="#27261f" stroke="#605a4a" stroke-width="1.2"/>'
body+='<rect x="15" y="20" width="90" height="136" rx="1" fill="#342f24"/><rect x="15" y="20" width="90" height="136" fill="url(#fin)"/>'
for x in range(17,108,7):
    body+=f'<path d="M{x} 19v137" stroke="url(#copper)" stroke-width="2.2"/><path d="M{x-.55} 23v131" stroke="#9c8762" stroke-opacity=".43" stroke-width=".53"/>'
for x in [7,108]:
    body+=f'<rect x="{x-3}" y="13" width="13.4" height="150" rx="3.4" fill="url(#tank)" stroke="#695f50" stroke-width=".65"/>'
    body+=f'<path d="M{x+1} 17v143" stroke="#88816c" stroke-opacity=".44" stroke-width=".75"/>'
    for y in range(18,160,6):
        edge=x+6 if x<10 else x-1
        body+=f'<path d="M{edge} {y}h3v1.4h-3Z" fill="#756c58" opacity=".62"/>'
for y in [10,156]:
    body+=f'<rect x="7" y="{y}" width="106" height="9" rx="1.4" fill="#535045" stroke="#88816e" stroke-width=".65"/><path d="M14 {y+1.6}h91" stroke="#a49a81" stroke-width=".7"/>'
    for x in [11,109]:body+=f'<use href="#bolt" x="{x}" y="{y+4}"/>'
body+='<path d="M14 4h13v6H14Zm75 0h13v6H89Z" fill="#47443a" stroke="#77705e" stroke-width=".65"/><path d="M31 12h51v4H31Z" fill="#39372f"/><path d="M42 13.5h23" stroke="#7d7460" stroke-width=".65"/>'
assets['radiator-core']=svg('radiator-core',120,176,'Пластинчатый радиатор с плоскими трубками и обжатым швом бачка',body,fins+tanks+copper)
body=''
for i in range(7):
    body+=f'<g transform="rotate({i*360/7} 50 50)"><path d="M47 41C43 32 48 16 62 8C69 8 76 14 75 19C70 32 61 41 56 46Z" fill="url(#blade)" stroke="#77766a" stroke-width=".55"/><path d="M49 39C51 27 56 17 64 13" fill="none" stroke="#939182" stroke-opacity=".42" stroke-width=".65"/><path d="M56 45C64 34 71 23 73 17" fill="none" stroke="#1d201c" stroke-width="1.1"/></g>'
body+='<circle cx="50" cy="50" r="12.7" fill="#35372e" stroke="#797769" stroke-width=".8"/><circle cx="50" cy="50" r="9.2" fill="#262821" stroke="#53554a" stroke-width=".65"/><use href="#bolt" x="50" y="50"/>'
blade='<linearGradient id="blade" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#6c6b5e"/><stop offset=".42" stop-color="#484b42"/><stop offset="1" stop-color="#30322a"/></linearGradient>'
assets['fan-rotor']=svg('fan-rotor',100,100,'Семилопастной вытяжной вентилятор из армированного полимера',body,blade)
body='<path d="M13 13H59L65 19V76L56 84H16L7 76V19Z" fill="url(#steel)" stroke="#c4ccc5" stroke-width="1.2"/><rect x="14" y="20" width="44" height="52" rx="4" fill="#14272e" stroke="#758b90"/>'
for i in range(14):
    x=17+i*2.8
    body+=f'<path d="M{x} 24v43l1.3 2 .8-2V24Z" fill="#ba9058" stroke="#654732" stroke-width=".4"/>'
body+='<rect x="30" y="21" width="12" height="49" rx="1" fill="url(#steel)" stroke="#c3cdc4" stroke-width=".5"/>'
for y in range(25,66,5):
 for x in [33,39]:body+=f'<circle cx="{x}" cy="{y}" r="1" fill="#22343b"/>'
body+='<path d="M19 17h34M16 73h40" stroke="#293c44" stroke-width="3"/><path d="M18 74h37" stroke="#c4c3aa"/><path d="M32 72l8 2-8 2 8 2-8 2" fill="none" stroke="#5f7174" stroke-width="1"/><rect x="25" y="5" width="22" height="10" rx="2" fill="url(#dark)" stroke="#acbcba"/><path d="M29 6v8m4-8v8m4-8v8m4-8v8" stroke="#a4b6b6" stroke-width=".7"/><rect x="13" y="20" width="46" height="52" rx="4" fill="none" stroke="#bdcec9" stroke-width="1"/><path d="M17 23v44" stroke="#d9e5df" stroke-opacity=".3" stroke-width="2"/>'
assets['filter-cutaway']=svg('filter-cutaway',72,88,'Разрез масляного фильтра: складчатый элемент, перфорированный канал, пружина и уплотнения',body)
body='<path d="M8 24L22 7h27l22 18v29L53 72H24L8 56Z" fill="url(#steel)" stroke="#cbd2ca" stroke-width="1.2"/><circle cx="40" cy="40" r="27" fill="#182e36" stroke="#96a9ab" stroke-width="1.2"/><circle cx="40" cy="40" r="23" fill="#25424c" stroke="#4a6971" stroke-width=".8"/><path d="M14 26H3v13h11M65 40h12v17H61" fill="url(#dark)" stroke="#a8b8b8" stroke-width="1"/><path d="M16 51a25 25 0 0 0 42 8" fill="none" stroke="#adbaa8" stroke-width="1"/>'
for x,y in [(21,18),(60,23),(60,62),(20,61)]:body+=f'<use href="#bolt" x="{x}" y="{y}"/>'
assets['pump-cutaway']=svg('pump-cutaway',80,80,'Корпус центробежной помпы с разрезом улитки и видимым рабочим колесом',body)
body='<circle cx="35" cy="35" r="27" fill="url(#brass)" stroke="#baac85" stroke-width="1"/><circle cx="35" cy="35" r="22" fill="#374947"/>'
for i in range(6):body+=f'<path transform="rotate({i*60} 35 35)" d="M32 31C23 25 28 12 37 10L41 15C32 18 32 24 39 29Z" fill="url(#brass)" stroke="#d0c3a3" stroke-width=".6"/>'
body+='<circle cx="35" cy="35" r="9" fill="url(#steel)" stroke="#d7dccf"/><circle cx="35" cy="35" r="4" fill="#263d47"/>'
assets['pump-impeller']=svg('pump-impeller',70,70,'Шестилопастное рабочее колесо насоса',body)
body='<path d="M4 23L19 7h30l15 16v22L48 62H20L4 45Z" fill="url(#steel)" stroke="#bac6be"/><circle cx="34" cy="34" r="23" fill="#1b333b" stroke="#9ab0b2"/><path d="M12 30h44v8H12Z" fill="#5c757b" stroke="#b2c3bc"/><rect x="27" y="19" width="14" height="30" rx="5" fill="url(#brass)" stroke="#c6b98f"/><path d="M26 21l16 4-16 4 16 4-16 4 16 4-16 4" fill="none" stroke="#d5d8c6" stroke-width="1.2"/>'
for x,y in [(16,18),(51,18),(16,50),(51,50)]:body+=f'<use href="#bolt" x="{x}" y="{y}"/>'
assets['thermostat-cutaway']=svg('thermostat-cutaway',68,68,'Восковой термостат в разрезе: капсула, пружина, седло и обходной канал',body)
defs='<linearGradient id="shell" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#625b4e"/><stop offset=".17" stop-color="#cec1a8"/><stop offset=".35" stop-color="#a59a83"/><stop offset=".75" stop-color="#776c5c"/><stop offset="1" stop-color="#443e34"/></linearGradient>'
body='<path d="M20 7h133q15 0 20 12l6 17v31l-6 14q-5 11-20 11H19Q5 87 2 75V29Q5 13 20 7Z" fill="url(#shell)" stroke="#393229" stroke-width="1.6"/>'
body+='<path d="M20 10h133q13 0 16 8M18 86h135q10 0 16-7" fill="none" stroke="#bfb096" stroke-width=".85"/>'
body+='<rect x="8" y="15" width="162" height="69" rx="9" fill="#29251e" stroke="#a19279" stroke-width="1.1"/>'
for x in [5,171]:
    for y in range(22,82,3):
        body+=f'<path d="M{x} {y}l3 1.7 2-1.7" fill="none" stroke="#dbccb0" stroke-opacity=".59" stroke-width=".64"/>'
body+='<path d="M20 90h133M24 87h128" stroke="#aa9c81" stroke-opacity=".82" stroke-width=".7"/><path d="M12 19v59m157-58v59" stroke="#b6a98c" stroke-opacity=".42" stroke-width="1.3"/>'
assets['muffler-cutaway']=svg('muffler-cutaway',180,104,'Овальный корпус глушителя, кромка разреза и сварные швы',body,defs)
body='<circle cx="30" cy="30" r="25" fill="url(#steel)" stroke="#cad3cb" stroke-width="1"/><circle cx="30" cy="30" r="20" fill="none" stroke="#455d67" stroke-width="2"/><circle cx="30" cy="30" r="15" fill="#172a33" stroke="#9dafb0" stroke-width="1.2"/><path d="M9 29h42" stroke="#d2d9d0" stroke-opacity=".18"/>'
for i in range(4):
 a=i*math.pi/2+math.pi/4; x=30+21*math.cos(a);y=30+21*math.sin(a);body+=f'<use href="#bolt" x="{x:.3f}" y="{y:.3f}"/>'
assets['flange']=svg('flange',60,60,'Стальной четырёхболтовый фланец, прокладка и расточка',body)
manifest=[{'id':k,'path':f'assets/svg/{k}.svg','bytes':len(v.encode()),'sha256':hashlib.sha256(v.encode()).hexdigest(),'provenance':'Original procedural SVG authored for Last Piston 0.13; no external images'} for k,v in assets.items()]
(root/'assets/svg-manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False),encoding='utf-8')
(root/'assets/mechanical-atlas.js').write_text('/* Original vector parts; embedded by the single-file packager. */\nwindow.Piston.MECHANICAL_SVG='+json.dumps(assets,ensure_ascii=False)+';\n',encoding='utf-8')
print('SVG assets:',len(assets),'source bytes:',sum(len(s) for s in assets.values()))
