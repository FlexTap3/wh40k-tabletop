// DOM-stub harness: runs the whole tabletop script under node, then appended tests.
// Usage: node harness.js <tests.js>
const fs = require("fs");
const html = fs.readFileSync("../../wh40k-tabletop.html", "utf8");
const grab = id => html.match(new RegExp('<script id="' + id + '" type="application/json">([\\s\\S]*?)</script>'))[1];
const dbJson = grab("db40k-data"), layoutsJson = grab("layouts40k-data");
const start = html.lastIndexOf("<script>");
const code = html.slice(start + 8, html.indexOf("</script>", start));

// ---- element stubs ----
function makeEl(id) {
  const el = {
    id, value: "", checked: false, textContent: "", innerHTML: "", tagName: "DIV",
    style: {}, dataset: {}, children: [], scrollTop: 0, scrollHeight: 0,
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    appendChild(c){ this.children.push(c); }, removeChild(){}, click(){},
    addEventListener(){}, showModal(){}, close(){},
    getBoundingClientRect(){ return { width: 800, height: 600, left: 0, top: 0 }; },
    insertAdjacentHTML(){}, setPointerCapture(){}, releasePointerCapture(){},
    parentNode: { insertBefore(){}, appendChild(){}, removeChild(){} },
  };
  if (id === "db40k-data") el.textContent = dbJson;
  if (id === "layouts40k-data") el.textContent = layoutsJson;
  if (id === "board") {
    el.width = 800; el.height = 600;
    el.parentElement = { getBoundingClientRect(){ return { width: 800, height: 600, left: 0, top: 0 }; } };
    el.getContext = () => ctxStub;
    el.handlers = {};
    el.addEventListener = (t, f) => { el.handlers[t] = e => f(Object.assign({preventDefault(){},stopPropagation(){},pointerType:'mouse',pointerId:1,isPrimary:true,button:0,clientX:e&&e.offsetX||0,clientY:e&&e.offsetY||0}, e)); };
  }
  return el;
}
const ctxStub = new Proxy({}, {
  get(t, k) {
    if (k === "measureText") return () => ({ width: 10 });
    if (k in t) return t[k];
    return () => {};
  },
  set(t, k, v) { t[k] = v; return true; },
});
const els = {};
global.document = {
  head: { insertAdjacentHTML(){}, appendChild(){} },
  getElementById: id => els[id] || (els[id] = makeEl(id)),
  createElement: tag => makeEl("_" + tag + Math.random()),
  querySelectorAll: () => [],
};
global.localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
global.navigator = {};
global.devicePixelRatio = 1;
global.winHandlers = {};
global.window = { addEventListener: (t, f) => {
  const wrapped = e => f(Object.assign({preventDefault(){},stopPropagation(){},pointerType:'mouse',pointerId:1,isPrimary:true,button:0,ctrlKey:false,metaKey:false}, e));
  const prev = global.winHandlers[t];
  global.winHandlers[t] = prev ? (e => { prev(e); wrapped(e); }) : wrapped;
}, open(){} };
global.alert = () => {}; global.confirm = () => true; global.prompt = () => "1";
global.Peer = function(){ this.on = () => {}; this.connect = () => ({ on(){} }); };
global.URL = global.URL || { createObjectURL: () => "" };
global.Blob = global.Blob || function(){};

const tests = fs.readFileSync(process.argv[2], "utf8");
eval(code + "\n" + tests);
