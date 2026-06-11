function e(){globalThis.DOMMatrix===void 0&&(globalThis.DOMMatrix=class{a;b;c;d;e;f;constructor(e){Array.isArray(e)&&e.length===6?(this.a=e[0],this.b=e[1],this.c=e[2],this.d=e[3],this.e=e[4],this.f=e[5]):(this.a=1,this.b=0,this.c=0,this.d=1,this.e=0,this.f=0)}translateSelf(e,t=0){return this.e=this.a*e+this.c*t+this.e,this.f=this.b*e+this.d*t+this.f,this}scaleSelf(e,t=e){return this.a*=e,this.b*=e,this.c*=t,this.d*=t,this}})}function t(){e()}let n;const r=globalThis.process?.release?.name===`node`;async function i(e,t={}){let{getDocument:n}=await a(),i={};if(r)try{let e=import.meta.resolve(`pdfjs-dist/package.json`);i={disableFontFace:!0,standardFontDataUrl:new URL(`./standard_fonts/`,e).href}}catch{}return await n({data:e,isEvalSupported:!1,useSystemFonts:!0,...i,...t}).promise}async function a(){return n||await o(),n}async function o(e,{reload:r=!1}={}){if(!(n&&!r)){if(t(),e)try{n=await c(e());return}catch(e){throw Error(`PDF.js could not be resolved: ${e}`)}try{n=await import(`./pdfjs-CcAeer3m.js`)}catch(e){throw Error(`Serverless PDF.js bundle could not be resolved: ${e}`)}}}function s(e){return typeof e==`object`&&!!e&&`_pdfInfo`in e}async function c(e){let t=await e;return t.default||t}
/**
* Derived from the PDF.js project by the Mozilla Foundation.
* @see https://github.com/mozilla/pdf.js/blob/b8de9a372f9bbf7e33adb362eeae5ef1919dba73/src/display/canvas_factory.js#L18
* @license Apache-2.0
*/
/**
* Derived from the PDF.js project by the Mozilla Foundation.
* @see https://github.com/mozilla/pdf.js/blob/b8de9a372f9bbf7e33adb362eeae5ef1919dba73/src/display/canvas_factory.js#L18
* @license Apache-2.0
*/
async function l(e,t={}){let{mergePages:n=!1}=t,r=s(e)?e:await i(e),a=await Promise.all(Array.from({length:r.numPages},(e,t)=>u(r,t+1)));return{totalPages:r.numPages,text:n?a.join(`
`).replace(/\s+/g,` `):a}}async function u(e,t){return(await(await e.getPage(t)).getTextContent()).items.filter(e=>e.str!=null).map(e=>e.str+(e.hasEOL?`
`:``)).join(``)}const d=async(...e)=>(await o(),await l(...e));export{d as extractText};