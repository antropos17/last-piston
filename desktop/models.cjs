// Export the same mechanical assemblies as the editable Blender model.
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {Engine} = require('../src/simulation.js');
const root = path.resolve(__dirname,'..');
const work = fs.mkdtempSync(path.join(os.tmpdir(),'piston-rigs-'));
const target = path.join(root,'dist','Last Piston','app');
fs.mkdirSync(target,{recursive:true});
try {
  for (const cylinders of [4,1,2,3]) {
    const model = new Engine(42571,{cylinders,litres:cylinders*.5,wear:.55});
    const take = {frames:[{pressure:0}], spec:model.build, offsets:model.cylinders.map(c=>c.offset)};
    fs.writeFileSync(path.join(work,'take.json'), JSON.stringify(take));
    const raw = path.join(work,'raw.glb');
    execFileSync(process.env.BLENDER_PATH || (fs.existsSync('X:/Blender/blender.exe')?'X:/Blender/blender.exe':'blender'),
      ['-b','-noaudio','--python-exit-code','1','-P',path.join(root,'tools/blender/assemble.py'),'--','--take',work,'--out',raw],{stdio:'inherit'});
    execFileSync(process.execPath,[require.resolve('gltfpack/cli.js'),'-i',raw,'-o',path.join(target,'motor-'+cylinders+'.glb'),'-cc','-noq','-kn','-ke','-si','0.48','-se','0.0015'],{stdio:'inherit'});
  }
} finally { fs.rmSync(work,{recursive:true,force:true}); }
