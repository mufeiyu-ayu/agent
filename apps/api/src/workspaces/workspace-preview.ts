import type { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import { posix } from 'node:path'
import { parse } from 'es-module-lexer/js'
import { parseHTML } from 'linkedom'
import { Input } from 'postcss'
import { artifactPath, WorkspaceOperationError } from './workspace-files.js'

const tokenizeCss = createRequire(import.meta.url)('postcss/lib/tokenize') as (input: Input) => { nextToken: () => [string, string] | undefined }

function cssReferences(source: string): string[] {
  const tokenizer = tokenizeCss(new Input(source))
  const references: string[] = []
  let pending = ''
  let url: string | undefined
  for (let token = tokenizer.nextToken(); token; token = tokenizer.nextToken()) {
    const [type, text] = token
    if (type === 'space' || type === 'comment')
      continue
    if (url !== undefined) {
      if (type === ')') {
        references.push(url.replace(/^(["'])([\s\S]*)\1$/, '$2'))
        url = undefined
      }
      else { url += text }
      continue
    }
    if (pending === 'url' && type === 'brackets')
      references.push(text.slice(1, -1).trim())
    else if (pending === 'url' && type === '(')
      url = ''
    else if (pending === '@import' && type === 'string')
      references.push(text.slice(1, -1))
    pending = (type === 'word' || type === 'at-word') ? text.toLowerCase() : ''
  }
  return references.map(reference => reference.replace(/\\([\da-f]{1,6}[ \t\r\n\f]?|[\s\S])/gi, (_match, escaped: string) => /^[\da-f]/i.test(escaped) ? String.fromCodePoint(Number.parseInt(escaped.trim(), 16) || 0xFFFD) : escaped))
}

/** 按 srcset 的 URL/描述符边界取候选；URL 内的逗号（如 data URL）不是分隔符。 */
function srcsetReferences(source: string): string[] {
  const references: string[] = []
  let position = 0
  while (position < source.length) {
    while (position < source.length && /[\t\n\f\r ,]/.test(source[position]!))
      position++
    const start = position
    while (position < source.length && !/[\t\n\f\r ]/.test(source[position]!))
      position++
    const url = source.slice(start, position)
    if (!url)
      break
    references.push(url.replace(/,+$/, ''))
    if (url.endsWith(','))
      continue
    let inParentheses = false
    while (position < source.length) {
      const character = source[position++]!
      if (character === '(')
        inParentheses = true
      else if (character === ')')
        inParentheses = false
      else if (character === ',' && !inParentheses)
        break
    }
  }
  return references
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
}
export function artifactMime(path: string): string {
  const mime = MIME[posix.extname(path).toLowerCase()]
  if (!mime)
    throw new WorkspaceOperationError('构建包含不支持的资源类型。')
  return mime
}

/** 检查实际 dist 普通文件与静态资源引用；不修改或拼成 self-contained HTML。 */
export function validateArtifact(files: Array<{ path: string, content: Buffer }>): void {
  const paths = new Set(files.map(file => artifactPath(file.path)))
  if (!paths.has('index.html'))
    throw new WorkspaceOperationError('构建缺少 dist/index.html。')
  for (const file of files) {
    const mime = artifactMime(file.path)
    const references: string[] = []
    const source = file.content.toString('utf8')
    if (mime === 'text/html') {
      const { document } = parseHTML(source)
      for (const [selector, attribute] of [
        ['script[src],img[src],source[src],video[src],audio[src],track[src],input[type="image"][src]', 'src'],
        ['link[href]', 'href'],
        ['video[poster]', 'poster'],
      ] as const) {
        for (const element of document.querySelectorAll(selector)) {
          if (element.localName === 'link' && !(element.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).some(rel => ['stylesheet', 'modulepreload', 'preload', 'prefetch', 'icon', 'apple-touch-icon', 'mask-icon'].includes(rel)))
            continue
          references.push(element.getAttribute(attribute)!)
        }
      }
      for (const element of document.querySelectorAll('img[srcset],source[srcset]'))
        references.push(...srcsetReferences(element.getAttribute('srcset')!))
      for (const element of document.querySelectorAll('style'))
        references.push(...cssReferences(element.textContent ?? ''))
      for (const element of document.querySelectorAll('[style]'))
        references.push(...cssReferences(element.getAttribute('style')!))
    }
    if (mime === 'text/css')
      references.push(...cssReferences(source))
    if (mime === 'text/javascript') {
      // 复用仓库已有 lexer；minified JS 的字符串/注释不能被误判为 import。
      const [imports] = parse(source, file.path)
      for (const item of imports) {
        if (item.n !== undefined)
          references.push(item.n)
        if (item.d === -2) {
          const url = source.slice(Math.max(0, item.s - 1000), item.s).match(/\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*$/)
          if (url)
            references.push(url[1]!)
        }
      }
    }
    for (const value of references) {
      const reference = value.trim()
      if (/^(?:data:|#)/i.test(reference))
        continue
      if (/^(?:[a-z][\w+.-]*:|\/)/i.test(reference))
        throw new WorkspaceOperationError('构建资源必须使用项目内相对路径，不能引用外部网络。')
      const base = 'https://artifact.invalid/files/'
      const target = new URL(reference, `${base}${file.path}`)
      if (!target.href.startsWith(base))
        throw new WorkspaceOperationError('构建资源必须使用项目内相对路径，不能越出构建目录。')
      const path = artifactPath(decodeURIComponent(target.pathname.slice('/files/'.length)))
      if (!paths.has(path))
        throw new WorkspaceOperationError(`构建缺少引用资源：${path}`)
    }
  }
}

/** 入口只执行可信包装器；生成 HTML 从不作为受信任 origin 下的文档响应。 */
export function previewDocument(code: string, resourceBase: string, documentPath = 'index.html'): string {
  const data = JSON.stringify({ code, resourceBase, documentPath }).replaceAll('<', '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe title="Build preview" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe><script>
const input=${data};
const generation=new URL(location.href).searchParams.get('generation');
const fragment=new URL(location.href).hash;
const loadToken=Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
let failed=false;
const notify=type=>parent.postMessage({type,generation},'*');
const parsed=new DOMParser().parseFromString(input.code,'text/html');
parsed.querySelectorAll('base,meta[http-equiv],iframe,frame,object,embed').forEach(x=>x.remove());
const documentUrl=new URL(input.documentPath,input.resourceBase);
const base=parsed.createElement('base');base.href=new URL('.',documentUrl).href;parsed.head.prepend(base);
const guard=parsed.createElement('script');
guard.textContent="(()=>{const loadToken="+JSON.stringify(loadToken)+";const fragment="+JSON.stringify(fragment).replaceAll('<','\\u003c')+";let loaded=false;const notify=parent.postMessage.bind(parent);for(const name of ['RTCPeerConnection','webkitRTCPeerConnection','mozRTCPeerConnection','Worker','SharedWorker'])Object.defineProperty(window,name,{value:undefined,writable:false,configurable:false});addEventListener('keydown',e=>{if(e.key==='Escape')parent.postMessage({type:'artifact-close'},'*')},true);addEventListener('error',()=>parent.postMessage({type:'artifact-error'},'*'),true);addEventListener('unhandledrejection',()=>parent.postMessage({type:'artifact-error'},'*'));Object.getOwnPropertyDescriptor(Document.prototype,'currentScript').get.call(document).remove();addEventListener('load',e=>{if(e.isTrusted&&!loaded){loaded=true;if(fragment){try{const id=decodeURIComponent(fragment.slice(1));const target=document.getElementById(id)||document.getElementsByName(id)[0];if(target)target.scrollIntoView()}catch{}}notify({type:'artifact-loaded',loadToken},'*')}});})();";
parsed.head.insertBefore(guard,base.nextSibling);
const links=parsed.createElement('script');
links.textContent="addEventListener('click',e=>{const a=e.target.closest?.('a[href]');if(!a)return;const href=a.getAttribute('href');if(href.startsWith('#')){e.preventDefault();try{const id=decodeURIComponent(href.slice(1));const target=document.getElementById(id)||document.getElementsByName(id)[0];if(target)target.scrollIntoView();else if(!id)scrollTo(0,0)}catch{};return}e.preventDefault();parent.postMessage({type:'artifact-navigate',href:a.href},'*')},true);";
parsed.head.insertBefore(links,guard.nextSibling);
const frame=document.querySelector('iframe');frame.srcdoc='<!doctype html>'+parsed.documentElement.outerHTML;
addEventListener('message',e=>{if(e.source!==frame.contentWindow||e.origin!=='null')return;if(e.data?.type==='artifact-error'){failed=true;notify('artifact-error')}if(e.data?.type==='artifact-close')notify('artifact-close');if(e.data?.type==='artifact-loaded'&&e.data.loadToken===loadToken&&!failed)notify('artifact-ready');if(e.data?.type==='artifact-navigate'){try{const url=new URL(e.data.href);if(url.href.startsWith(input.resourceBase)&&url.pathname.endsWith('.html')){const path=decodeURIComponent(url.pathname.slice(new URL(input.resourceBase).pathname.length));parent.postMessage({type:'artifact-page',path,fragment:url.hash,generation},'*')}}catch{}}});
</script></body></html>`
}

export function previewCsp(resourceBase: string): string {
  return `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' ${resourceBase}; style-src 'unsafe-inline' ${resourceBase}; img-src data: ${resourceBase}; font-src data: ${resourceBase}; connect-src 'none'; frame-src 'none'; worker-src 'none'; webrtc 'block'; base-uri ${resourceBase}; form-action 'none'; object-src 'none'`
}
