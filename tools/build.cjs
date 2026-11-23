'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
let html=read('index.html');
html=html.replace(/<link rel="stylesheet" href="([^"]+)">/g,(_,file)=>{
 const css=read(file).replace(/^[ \t]+/gm,'').replace(/^([a-z][\w-]*:) +/gm,'$1').replace(/;\s*}$/gm,'}');
 return '<style>\n'+css+'\n</style>';
});
html=html.replace(/<script defer src="([^"]+)"><\/script>/g,(_,file)=>{
 let code=read(file);
 // Trim line indentation only outside the region that could contain template literals.
 if(file.startsWith('src/')&&!/\\\n/.test(code)){
  const keepNotes=/audio|sample-bank/.test(file)||/@license|copyright|SPDX/i.test(code);
  const trim=part=>{
   if(!keepNotes)part=part.replace(/^[ \t]*\/\/ (?![^\n]*\*\/)[^\n]*$/gm,'');
   return part.replace(/\n[ \t]+/g,'\n');
  };
  const first=code.indexOf('`'),end=code.lastIndexOf('`')+1;
  const literals=code.split('\n').filter(line=>line.includes('`'));
  // Plain single-line templates have no indentation or comment lines inside them.
  const singleLine=literals.every(line=>/^[^`]*[=>(,?:]`[^`\\]*`[^`]*$/.test(line)&&!line.includes('//'));
  code=singleLine?trim(code):trim(code.slice(0,first))+code.slice(first,end)+trim(code.slice(end));
 }
 // Drop introductory comments in our modules. Keep asset and audio provenance intact.
 if(file.startsWith('src/')&&!file.includes('audio')&&file!=='src/sample-bank.js')
  code=code.replace(/^\/\*(?![!*])[\s\S]*?\*\/[ \t]*\n/,comment=>/@license|copyright|SPDX/i.test(comment)?comment:'');
 return '<script defer>\n'+code.replace(/<\/script/gi,'<\\/script')+'\n</script>';
});
// Inline classic scripts cannot defer. Move them after the DOM to preserve initialization order.
const scripts=[];html=html.replace(/<script defer>([\s\S]*?)<\/script>/g,(_,code)=>{scripts.push('<script>'+code+'</script>');return '';});
html=html.replace('</body>',scripts.join('\n')+'\n</body>');
fs.mkdirSync(path.join(root,'dist'),{recursive:true});
fs.writeFileSync(path.join(root,'dist','last-piston.html'),html);
console.log('Built dist/last-piston.html ('+Buffer.byteLength(html)+' bytes)');
