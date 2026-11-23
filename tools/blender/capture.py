"""Record the installed simulator's mechanical motion and its stereo Web Audio master."""
import argparse
import base64
import json
import os
import secrets
import wave
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument("--cylinders", type=int, choices=range(1, 5), default=4)
parser.add_argument("--litres", type=float, default=2)
parser.add_argument("--wear", type=float, default=.55)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--fault", choices=["rod", "none"], default="none")
parser.add_argument("--seed", type=int, default=None)
args = parser.parse_args()
seed = args.seed if args.seed is not None else secrets.randbits(32)
if not .6 <= args.litres <= 3.2 or not 0 <= args.wear <= .8:
    parser.error("Use 0.6â€“3.2 litres and wear between 0 and 0.8")
args.output.mkdir(parents=True, exist_ok=True)
spec = dict(cylinders=args.cylinders, litres=args.litres, wear=args.wear)
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH"), args=["--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width":800, "height":600})
    page.goto((ROOT/"dist/last-piston.html").as_uri()+"?test")
    page.evaluate("__engineLab.pause()")
    page.locator("#ignition-key").click()
    page.wait_for_function("__engineLab.audio.ready")
    result = page.evaluate("""async ([spec,fault,seed])=>{
      const lab=__engineLab,a=lab.audio,v=lab.renderer;
      lab.restore(new Piston.Engine(seed,spec).snapshot());
      const m=lab.engine; m.setProfile('normal');v.reduced=false;
      const ctx=a.ctx,tap=ctx.createScriptProcessor(1024,2,2),mute=ctx.createGain(),end=a.outputNodes.at(-1);
      const blocks=[],frames=[],ids=new WeakMap(); let next=0;
      function id(p){if(!ids.has(p))ids.set(p,next++);return ids.get(p);}
      tap.onaudioprocess=e=>{const l=e.inputBuffer.getChannelData(0),r=e.inputBuffer.getChannelData(1),pcm=new Int16Array(l.length*2);
        for(let i=0;i<l.length;i++){pcm[2*i]=Math.round(Math.max(-1,Math.min(1,l[i]))*32767);pcm[2*i+1]=Math.round(Math.max(-1,Math.min(1,r[i]))*32767);}blocks.push(pcm);};
      mute.gain.value=0;end.connect(tap);tap.connect(mute).connect(ctx.destination);
      const start=ctx.currentTime;let cycle=0,prev=m.phase;
      for(let f=1;f<=336;f++){
        const t=(f-1)/24;
        if(f===9)m.requestStart();
        if(f===151&&fault==='rod'&&m.activeCount>1)m.toggleBenchFault('rod','break',1);
        if(f===218)m.requestStop();
        const gas=(t>=3&&t<4.35)?.87:(t>=6.65&&t<7.6)?.65:0;
        const brake=f>=224&&f<255?.75:0;
        for(let k=0;k<5;k++){m.step(1/120,gas,brake);for(const ev of m.drainEvents()){v.event(ev,m);a.event(ev);}}
        v.update(1/24,m);a.update(m);
        if(m.phase<prev-1)cycle+=4*Math.PI;prev=m.phase;
        const spray=m.oilCircuit.spray;
        frames.push({angle:cycle+m.phase,rpm:m.rpm,pressure:m.pressure,state:m.ignition,pose:[v.pose.x,v.pose.y,v.pose.a],
          lift:m.cylinders.map(c=>[c.cycle.intake,c.cycle.exhaust]),live:m.cylinders.map(c=>c.active),
          gas:m.throttle,carbon:m.exhaust.carbon,oil:[...spray.drops.map(p=>[id(p),p.x,p.y,0,p.litres]),
            ...spray.films.map(p=>[id(p),p.x,p.y,1,p.litres])],
          debris:m.fragments.bodies.map(p=>[p.id,p.kind,p.cylinder,p.x,p.y,p.a||0])});
        const wait=start+f/24-ctx.currentTime;if(wait>0)await new Promise(r=>setTimeout(r,wait*1000));
      }
      tap.disconnect();mute.disconnect();end.disconnect(tap);tap.onaudioprocess=null;
      let data='';for(const pcm of blocks)data+=String.fromCharCode(...new Uint8Array(pcm.buffer));
      return {frames,offsets:m.cylinders.map(c=>c.offset),failures:m.cylinders.map(c=>[c.failure,c.freeze]),rate:ctx.sampleRate,audio:btoa(data),clock:ctx.currentTime-start};
    }""",[spec,args.fault,seed])
    browser.close()
if abs(result["clock"]-14)>.28:
    raise RuntimeError("Audio and animation clock diverged, repeat the capture with less GPU load")
audio = base64.b64decode(result.pop("audio"))
with wave.open(str(args.output/"motor.wav"),"wb") as stream:
    stream.setparams((2,2,result["rate"],0,"NONE",""))
    stream.writeframes(audio)
(args.output/"take.json").write_text(json.dumps(dict(spec=spec,seed=seed,**result),separators=(",",":")),encoding="utf-8")
print(f"{len(result['frames'])} frames, {len(audio)//4/result['rate']:.2f}s stereo, {spec}")
