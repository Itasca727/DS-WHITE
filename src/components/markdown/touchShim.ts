/**
 * 预览网页的触摸转鼠标：白写的互动页面常常只监听鼠标（mousemove / mousedown），
 * 手机上手指划过不会触发。注入一小段脚本，在页面没有自己处理触摸时，
 * 把手指拖动转成鼠标事件：开始拖动时补一个 mousedown，划动时发 mousemove，松手时发 mouseup。
 * 只是轻点的话交给浏览器自己（它本来就会补发点击），不重复发。
 */
const SHIM = `<script>(()=>{
var own=false,mouse=false;
var add=EventTarget.prototype.addEventListener;
EventTarget.prototype.addEventListener=function(type){
  if(/^(touch|pointer)/.test(type))own=true;
  if(/^mouse(move|down|up)$/.test(type))mouse=true;
  return add.apply(this,arguments);
};
var start=null,dragging=false;
function fire(type,t){
  var target=document.elementFromPoint(t.clientX,t.clientY)||document.body||document.documentElement;
  target.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,clientX:t.clientX,clientY:t.clientY,screenX:t.screenX,screenY:t.screenY,button:0,buttons:type==='mouseup'?0:1}));
}
function hasMouse(){return mouse||!!(document.onmousemove||document.body&&document.body.onmousemove||window.onmousemove);}
add.call(window,'touchstart',function(e){
  start=own?null:e.touches[0];dragging=false;
},{capture:true,passive:true});
add.call(window,'touchmove',function(e){
  if(!start||own||!hasMouse())return;
  var t=e.touches[0];
  if(!dragging){dragging=true;fire('mousemove',start);fire('mousedown',start);}
  fire('mousemove',t);
  if(e.cancelable)e.preventDefault();
},{capture:true,passive:false});
add.call(window,'touchend',function(e){
  if(dragging&&e.changedTouches[0])fire('mouseup',e.changedTouches[0]);
  start=null;dragging=false;
},{capture:true,passive:true});
})();<\/script>`

/** 把脚本放进 <head> 最前面（没有就放 <html> 或 DOCTYPE 后面），保证比页面自己的脚本先跑，也不把页面挤进怪异模式 */
export const withTouchShim = (html: string): string => {
  for (const pattern of [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /<!doctype[^>]*>/i]) {
    const match = pattern.exec(html)
    if (match) {
      const at = match.index + match[0].length
      return html.slice(0, at) + SHIM + html.slice(at)
    }
  }
  return SHIM + html
}
