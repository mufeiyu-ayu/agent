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
      for (const element of document.querySelectorAll('script[src],img[src],link[href],source[src],video[src],audio[src]'))
        references.push(element.getAttribute(element.hasAttribute('src') ? 'src' : 'href')!)
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
    for (const reference of references) {
      if (/^(?:data:|#)/i.test(reference))
        continue
      if (/^(?:[a-z][\w+.-]*:|\/)/i.test(reference))
        throw new WorkspaceOperationError('构建资源必须使用项目内相对路径，不能引用外部网络。')
      const target = new URL(reference, `https://artifact.invalid/${file.path}`)
      const path = artifactPath(decodeURIComponent(target.pathname.slice(1)))
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
let failed=false;
const notify=type=>parent.postMessage({type,generation},'*');
const parsed=new DOMParser().parseFromString(input.code,'text/html');
parsed.querySelectorAll('base,meta[http-equiv],iframe,frame,object,embed').forEach(x=>x.remove());
const documentUrl=new URL(input.documentPath,input.resourceBase);
const base=parsed.createElement('base');base.href=new URL('.',documentUrl).href;parsed.head.prepend(base);
const guard=parsed.createElement('script');
guard.textContent="for(const name of ['RTCPeerConnection','webkitRTCPeerConnection','mozRTCPeerConnection','Worker','SharedWorker'])Object.defineProperty(window,name,{value:undefined,writable:false,configurable:false});addEventListener('keydown',e=>{if(e.key==='Escape')parent.postMessage({type:'artifact-close'},'*')},true);addEventListener('error',()=>parent.postMessage({type:'artifact-error'},'*'),true);addEventListener('unhandledrejection',()=>parent.postMessage({type:'artifact-error'},'*'));addEventListener('load',()=>parent.postMessage({type:'artifact-loaded'},'*'),{once:true});";
parsed.head.insertBefore(guard,base.nextSibling);
const links=parsed.createElement('script');
links.textContent="addEventListener('click',e=>{const a=e.target.closest?.('a[href]');if(!a)return;const href=a.getAttribute('href');if(href.startsWith('#')){e.preventDefault();try{const id=decodeURIComponent(href.slice(1));const target=document.getElementById(id)||document.getElementsByName(id)[0];if(target)target.scrollIntoView();else if(!id)scrollTo(0,0)}catch{};return}e.preventDefault();parent.postMessage({type:'artifact-navigate',href:a.href},'*')},true);";
parsed.head.insertBefore(links,guard.nextSibling);
const frame=document.querySelector('iframe');frame.srcdoc='<!doctype html>'+parsed.documentElement.outerHTML;
addEventListener('message',e=>{if(e.source!==frame.contentWindow||e.origin!=='null')return;if(e.data?.type==='artifact-error'){failed=true;notify('artifact-error')}if(e.data?.type==='artifact-close')notify('artifact-close');if(e.data?.type==='artifact-loaded'&&!failed)notify('artifact-ready');if(e.data?.type==='artifact-navigate'){try{const url=new URL(e.data.href);if(url.href.startsWith(input.resourceBase)&&url.pathname.endsWith('.html')){const path=decodeURIComponent(url.pathname.slice(new URL(input.resourceBase).pathname.length));parent.postMessage({type:'artifact-page',path,generation},'*')}}catch{}}});
</script></body></html>`
}

export function previewCsp(resourceBase: string): string {
  return `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' ${resourceBase}; style-src 'unsafe-inline' ${resourceBase}; img-src data: ${resourceBase}; font-src data: ${resourceBase}; connect-src 'none'; frame-src 'none'; worker-src 'none'; webrtc 'block'; base-uri ${resourceBase}; form-action 'none'; object-src 'none'`
}
