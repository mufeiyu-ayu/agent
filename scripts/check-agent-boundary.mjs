import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const repository = fileURLToPath(new URL('../', import.meta.url))

/** 编译器 AST + 实际模块解析，不靠源文件文本正则猜 import。 */
export function checkAgentBoundary(root = repository) {
  root = realpathSync(root)
  const violations = []
  const packageRoots = ['agent', 'ai', 'contracts'].map(name => resolve(root, 'packages', name))
  for (const packageRoot of packageRoots) {
    const configPath = resolve(packageRoot, 'tsconfig.json')
    const config = ts.readConfigFile(configPath, ts.sys.readFile)
    if (config.error)
      throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
    const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot)
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))
    const allowed = new Set(Object.keys(manifest.dependencies ?? {}))
    const src = resolve(packageRoot, 'src')
    for (const entry of readdirSync(src, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts'))
        continue
      const file = resolve(entry.parentPath, entry.name)
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
      const fail = text => violations.push(`${relative(root, file)}: ${text}`)
      const inspect = (literal) => {
        if (!literal || !ts.isStringLiteralLike(literal)) {
          fail('不允许无法静态核对的模块路径')
          return
        }
        const specifier = literal.text
        if (isBuiltin(specifier))
          return
        if (file.endsWith('.test.ts') && specifier === 'vitest')
          return
        // 不让修改 manifest 就绕过 agent 自身的固定边界。
        const externalAllowed = packageRoot === packageRoots[0]
          ? ['@agent/ai', '@agent/contracts'].includes(specifier)
          : allowed.has(specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/'))
        if (!specifier.startsWith('.') && !externalAllowed) {
          fail(`禁止依赖 ${specifier}`)
          return
        }
        const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule
        if (!resolved) {
          fail(`无法解析 ${specifier}`)
          return
        }
        const target = realpathSync(resolved.resolvedFileName)
        if (specifier.startsWith('.')) {
          if (!target.startsWith(`${src}${sep}`))
            fail(`相对导入越过本包 src：${specifier}`)
        }
        else if (specifier.startsWith('@agent/')) {
          const expected = resolve(root, 'packages', specifier.slice('@agent/'.length), 'src')
          if (!target.startsWith(`${expected}${sep}`))
            fail(`别名指向非声明包：${specifier}`)
        }
        else if (!target.includes(`${sep}node_modules${sep}`)) {
          fail(`第三方模块被映射到工作区源码：${specifier}`)
        }
      }
      const visit = (node) => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          if (node.moduleSpecifier)
            inspect(node.moduleSpecifier)
        }
        else if (ts.isImportTypeNode(node)) {
          inspect(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined)
        }
        else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
          inspect(node.moduleReference.expression)
        }
        else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
          inspect(node.arguments[0])
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
  return violations
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const violations = checkAgentBoundary()
  if (violations.length) {
    console.error(violations.join('\n'))
    process.exitCode = 1
  }
  else {
    console.log('agent → ai/contracts 边界检查通过（含 type、dynamic import 与 barrel）')
  }
}
