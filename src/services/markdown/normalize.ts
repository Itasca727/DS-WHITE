/**
 * 解析前把模型常见、但标准 Markdown 认不出的公式写法改成能认的写法。
 * 只处理代码块以外的内容；输入只在末尾追加时，前面已处理的部分结果不变（流式增量解析依赖这一点）。
 *
 * - 单独一行的 `$$ 公式 $$` 拆成三行的公式块（否则会被当成行内公式，\tag 之类只能在公式块里用的命令会报错）
 * - `$$ 第一行` …… `最后一行 $$` 这种首尾和内容写在同一行的公式块，把 $$ 拆到单独一行
 * - 没有包在 $$ 里的 \begin{aligned} …… \end{aligned} 等公式环境，补上 $$
 * - 表格行里行内公式中的 |（如 $|x|$）换成 \vert，不再把表格切坏
 */

const FENCE = /^\s*(`{3,}|~{3,})/

/** 只认这些公式环境；document、itemize 等排版环境不算 */
const MATH_ENVS = new Set([
  'aligned',
  'align',
  'align*',
  'alignat',
  'alignat*',
  'equation',
  'equation*',
  'gather',
  'gather*',
  'gathered',
  'cases',
  'matrix',
  'pmatrix',
  'bmatrix',
  'vmatrix',
  'Bmatrix',
  'Vmatrix',
  'smallmatrix',
  'array',
  'split',
  'multline',
  'multline*',
  'eqnarray',
  'eqnarray*',
])

const BEGIN = /^\\begin\{([A-Za-z]+\*?)\}/

/** 表格行里的行内公式：不以空格开头结尾，避免把 `$5 | $10` 这种金额误当公式 */
const INLINE_MATH_IN_ROW = /\$(?!\s)([^$\n]*?[^\s$])\$/g

const fixTableRow = (line: string) =>
  line.replace(INLINE_MATH_IN_ROW, (whole, body: string) =>
    body.includes('|')
      ? `$${body.replace(/\\\|/g, '\\Vert{}').replace(/\|/g, '\\vert{}')}$`
      : whole
  )

/** 找到与第 start 行 \begin{name} 配对的 \end{name} 所在行；还没写到（流式中）返回 -1 */
const findEnd = (lines: string[], start: number, name: string) => {
  const begin = `\\begin{${name}}`
  const end = `\\end{${name}}`
  let depth = 0
  for (let i = start; i < lines.length && i < start + 400; i++) {
    const line = lines[i]
    if (FENCE.test(line)) {
      return -1
    }
    depth += line.split(begin).length - 1
    depth -= line.split(end).length - 1
    if (depth <= 0) {
      return i
    }
  }
  return -1
}

export const normalizeMarkdown = (input: string): string => {
  if (!input.includes('$') && !input.includes('\\begin') && !input.includes('\\[')) {
    return input
  }
  const lines = input.split('\n')
  const out: string[] = []
  let fence: string | null = null
  /** 当前所在公式块的写法 */
  let math: '$$' | '\\[' | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const indent = line.slice(0, line.length - line.trimStart().length)
    const trimmed = line.trim()

    if (fence) {
      if (trimmed.startsWith(fence)) {
        fence = null
      }
      out.push(line)
      continue
    }
    const fenceMatch = line.match(FENCE)
    if (fenceMatch && !math) {
      fence = fenceMatch[1]
      out.push(line)
      continue
    }

    if (math === '$$') {
      if (trimmed === '$$') {
        math = null
        out.push(line)
      } else if (trimmed.endsWith('$$') && !trimmed.endsWith('\\$$')) {
        // `最后一行 $$`
        out.push(`${indent}${trimmed.slice(0, -2).trimEnd()}`, `${indent}$$`)
        math = null
      } else {
        out.push(line)
      }
      continue
    }
    if (math === '\\[') {
      if (trimmed.includes('\\]')) {
        math = null
      }
      out.push(line)
      continue
    }

    if (trimmed.startsWith('$$')) {
      const rest = trimmed.slice(2)
      const close = rest.indexOf('$$')
      if (close === -1) {
        // `$$` 或 `$$ 第一行`：公式块开始
        math = '$$'
        out.push(rest.trim() ? `${indent}$$` : line)
        if (rest.trim()) {
          out.push(`${indent}${rest.trim()}`)
        }
        continue
      }
      if (close === rest.length - 2 && rest.slice(0, close).trim()) {
        // 整行就是 `$$ 公式 $$`
        out.push(`${indent}$$`, `${indent}${rest.slice(0, close).trim()}`, `${indent}$$`)
        continue
      }
      out.push(line)
      continue
    }
    if (trimmed === '\\[' || (trimmed.startsWith('\\[') && !trimmed.includes('\\]'))) {
      math = '\\['
      out.push(line)
      continue
    }

    const env = trimmed.match(BEGIN)?.[1]
    if (env && MATH_ENVS.has(env)) {
      const end = findEnd(lines, i, env)
      if (end !== -1) {
        out.push(`${indent}$$`, ...lines.slice(i, end + 1), `${indent}$$`)
        i = end
        continue
      }
    }

    out.push(trimmed.startsWith('|') ? fixTableRow(line) : line)
  }
  return out.join('\n')
}
