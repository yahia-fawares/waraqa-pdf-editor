import test from 'node:test';
import assert from 'node:assert/strict';
import { imageRegions, editObject } from '../dist/object-editor.mjs';
const multiply = (a,b) => [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
test('embedded image bounds account for graphics transforms and viewport coordinates', () => {
  const OPS={save:1,restore:2,transform:3,paintImageXObject:4};
  const ops={fnArray:[1,3,4,2],argsArray:[[],[100,0,0,50,20,30],['image'],[]]};
  assert.deepEqual(imageRegions(ops,{width:600,height:800,transform:[1,0,0,-1,0,800]},OPS,multiply),[{x:20,y:720,w:100,h:50}]);
});
class Node {
  constructor(){this.style={};this.children=[];this.value='';this.checked=false;}
  append(...nodes){this.children.push(...nodes);} remove(){} contains(e){return e===this||this.children.includes(e);} setAttribute(){} setPointerCapture(){}
  getBoundingClientRect(){return {left:0,top:0,width:600,height:800};}
}
function fixture(index=null){
  const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
  globalThis.document={createElement:()=>new Node(),getElementById:$,addEventListener(){},removeEventListener(){}};
  $('keepratio').checked=true;
  const page={edits:index===null?[]:[{type:'image',data:'data:image/png;base64,example',x:20,y:30,w:100,h:50}]};
  let snapshots=0,renders=0;
  const editor=editObject({paper:new Node(),canvas:new Node(),viewport:{width:600,height:800},page,index,box:{x:20,y:30,w:100,h:50},data:'data:image/png;base64,example',snapshot:()=>snapshots++,render:()=>renders++,finish(){},panel:new Node()});
  return {$,page,editor,counts:()=>({snapshots,renders})};
}
test('moving and resizing a PDF region erases the original area and saves the new geometry',()=>{
  const f=fixture();f.editor.move(10,15);f.$('objectw').value=200;f.editor.resizeFromFields('objectw');f.editor.close(true);
  assert.deepEqual(f.page.edits[0],{type:'erase',x:20,y:30,w:100,h:50});
  assert.deepEqual([f.page.edits[1].x,f.page.edits[1].y,f.page.edits[1].w,f.page.edits[1].h],[30,45,200,100]);
  assert.deepEqual(f.counts(),{snapshots:1,renders:1});
});
test('existing image can be resized without aspect lock and removed',()=>{
  const f=fixture(0);f.$('keepratio').checked=false;f.$('objectw').value=130;f.$('objecth').value=75;f.editor.resizeFromFields('objectw');f.editor.close(true);assert.equal(f.page.edits[0].w,130);assert.equal(f.page.edits[0].h,75);
  const g=fixture(0);g.editor.remove();assert.equal(g.page.edits.length,0);
});
test('cancel is reversible and deleting an original region stores only the erasure',()=>{
  const f=fixture();f.editor.move(30,20);f.editor.close(false);assert.deepEqual(f.page.edits,[]);assert.equal(f.counts().snapshots,0);
  const g=fixture();g.editor.remove();assert.deepEqual(g.page.edits,[{type:'erase',x:20,y:30,w:100,h:50}]);
});
