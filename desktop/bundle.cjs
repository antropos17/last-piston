const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname,'..'), out = path.join(root,'dist','Last Piston','app');
const source = file => fs.readFileSync(path.join(root,file),'utf8');
const adapter = require('esbuild').buildSync({entryPoints:[path.join(__dirname,'stand.js')],bundle:true,minify:true,format:'iife',legalComments:'eof',write:false}).outputFiles[0].text;
let markup = source('index.html'), styles=[], scripts=[];
markup = markup.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_,file)=>{styles.push(source(file));return '';});
markup = markup.replace(/<script defer src="([^"]+)"><\/script>/g, (_,file)=>{
  if(file==='src/app.js') scripts.push(adapter);
  scripts.push(source(file));return '';
});
markup = markup.replace('</head>','<link rel="stylesheet" href="stand.css"><script defer src="stand.js"></script></head>');
markup = markup.replace('<div class="stage-meta">','<canvas id="motor-3d" aria-label="Трёхмерный двигатель. Перетащите мышью, чтобы повернуть, колесо меняет масштаб."></canvas><span id="model-status" role="status"></span><div class="stage-meta">')
  .replace('<span class="drive-hint">Выше по педали — сильнее нажатие</span>','<button type="button" id="drawing-mode" aria-pressed="false">Схема</button><button type="button" id="open-cover" aria-pressed="false">Разрез 3D</button><span class="drive-hint" id="orbit-hint">Мышь — поворот · колесо — масштаб</span>');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'index.html'),markup);
fs.writeFileSync(path.join(out,'stand.js'),scripts.join('\n;\n'));
fs.writeFileSync(path.join(out,'stand.css'),styles.join('\n')+source('desktop/stand.css'));
for(const [file,name] of [['three/LICENSE','three-LICENSE.txt'],['gltfpack/LICENSE.md','meshoptimizer-LICENSE.txt']])
 fs.copyFileSync(path.join(__dirname,'node_modules',file),path.join(out,name));
fs.copyFileSync(path.join(root,'SOURCES.md'),path.join(out,'SOURCES.md'));
