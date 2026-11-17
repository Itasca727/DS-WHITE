/**
 * 把 KaTeX 不支持、但模型常用的 LaTeX 写法改成等价的 KaTeX 写法。
 * 典型场景是用 LaTeX 画的「卡片」：\colorbox 里套 tabular，行内用 \hfill 左右对齐。
 *
 * - 去掉零宽字符（BOM 等），KaTeX 遇到会报错
 * - tabular 换成 array；tabular 的格子是文字模式，所以每格包进 \text{}
 * - 格子里的 \hfill 拆成右对齐的新列，效果同「左边一段、右边一段」
 * - 整个表格包成 \text{$…$}，这样放在 \colorbox、\fbox 里也能用
 * - 其余 KaTeX 不认、只影响排版的命令（\centering、\vspace、多余的 \hfill）去掉或换成空白
 */

const ZERO_WIDTH = /\uFEFF|\u200B|\u200C|\u200D|\u2060/g

/** 读一段配对的花括号，返回内容和结束位置（不含右括号后的位置） */
const readGroup = (source: string, open: number): [string, number] | null => {
  if (source[open] !== '{') {
    return null
  }
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const char = source[i]
    if (char === '\\') {
      i++
      continue
    }
    if (char === '{') {
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0) {
        return [source.slice(open + 1, i), i + 1]
      }
    }
  }
  return null
}

/** 按顶层（不在花括号里）的分隔符切开 */
const splitTop = (source: string, separator: RegExp) => {
  const parts: string[] = []
  let depth = 0
  let last = 0
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (depth === 0) {
      separator.lastIndex = i
      const match = separator.exec(source)
      if (match && match.index === i && match[0]) {
        parts.push(source.slice(last, i))
        last = i + match[0].length
        i = last - 1
        continue
      }
    }
    if (char === '\\') {
      // 跳过转义的下一个字符（\{、\&），\\ 换行符也整体跳过
      i++
    } else if (char === '{') {
      depth++
    } else if (char === '}') {
      depth--
    }
  }
  parts.push(source.slice(last))
  return parts
}

/** 列格式：p{3cm} 之类换成 l，去掉 | 以外 KaTeX 不认的 @{…} */
const parseColumns = (spec: string) => {
  const columns: string[] = []
  const clean = spec.replace(/[@!>]\{[^{}]*\}/g, '').replace(/[pmbX]\{[^{}]*\}/g, 'l')
  for (const char of clean) {
    if ('lcr'.includes(char)) {
      columns.push(char)
    } else if (char === '|' && columns.length) {
      columns[columns.length - 1] += '|'
    } else if (char === '|') {
      columns.push('|')
    }
  }
  return columns
}

/** 去掉命令和花括号后剩下的可见文字 */
const visibleText = (cell: string) =>
  cell
    .replace(/\\(?:textcolor|color|colorbox)\s*\{[^{}]*\}/g, '')
    .replace(/\\[A-Za-z]+\*?/g, '')
    .replace(/[{}$]/g, '')
    .trim()

/** 粗略估算文字宽度（em）：中文和全角字符 1 个字宽，其它算半个多一点 */
const textWidth = (cell: string) =>
  [...visibleText(cell)].reduce((sum, char) => sum + (/[\u2e80-\uffef]/.test(char) ? 1 : 0.55), 0)

/** 只由横线字符组成的格子：模型拿来画分隔线 */
const isDivider = (cell: string) => /^[─━—―\-=_~·•.]{4,}$/.test(visibleText(cell).replace(/\s/g, ''))

const RULES = /^\s*((?:\\(?:hline|toprule|midrule|bottomrule|cline\{[^{}]*\})\s*)+)/

const convertTabular = (spec: string, body: string) => {
  const leading = spec.startsWith('|') ? '|' : ''
  const columns = parseColumns(spec.replace(/^\|/, '')).filter((column) => column !== '|')
  const rows = splitTop(body, /\\\\(?:\[[^\]]*\])?/y).map((row) => {
    const rule = row.match(RULES)?.[1] ?? ''
    const cells = splitTop(row.slice(rule.length), /(?<!\\)&/y).map((cell) => splitTop(cell, /\\hfill\b/y))
    return { rule: rule.replace(/\\(?:toprule|midrule|bottomrule)/g, '\\hline'), cells }
  })
  // 最后一行常常只剩换行符后面的空白或一条横线
  const last = rows.at(-1)
  if (last && last.cells.length === 1 && last.cells[0].length === 1 && !last.cells[0][0].trim()) {
    if (last.rule) {
      last.cells = []
    } else {
      rows.pop()
    }
  }
  const columnCount = Math.max(columns.length, ...rows.map((row) => row.cells.length))
  const dividerRow = (row: (typeof rows)[number]) =>
    row.cells.length === 1 && row.cells[0].length === 1 && isDivider(row.cells[0][0])
  // 分隔线跟着表格宽度走：按其它行的文字估算整行宽度
  const tableWidth = Math.max(
    4,
    ...rows
      .filter((row) => !dividerRow(row))
      .map((row) =>
        row.cells.reduce(
          (sum, pieces) => sum + pieces.reduce((width, piece) => width + textWidth(piece), 0) + (pieces.length - 1) * 2,
          0
        ) + (row.cells.length - 1) * 0.8
      )
  )
  // 每个原始列因为 \hfill 多出来几列
  const extra = Array.from({ length: columnCount }, (_, column) =>
    Math.max(0, ...rows.map((row) => (row.cells[column]?.length ?? 1) - 1))
  )
  const newSpec =
    leading +
    Array.from({ length: columnCount }, (_, column) => {
      const base = columns[column] ?? 'l'
      const align = base.replace('|', '')
      return extra[column] ? align + 'r'.repeat(extra[column]) + base.slice(1) : base
    }).join('')
  const lines = rows.map((row) => {
    const { rule, cells } = row
    if (!cells.length) {
      return rule
    }
    if (dividerRow(row)) {
      // 换成一条不占宽度的细线，长度和表格差不多宽，不再把第一列撑得很宽
      const color = cells[0][0].match(/\\textcolor\s*\{([^{}]*)\}/)?.[1]
      // 估算偏窄（字体回退、列间距），按实测放大一些；宁短勿长，避免伸出卡片
      const line = `\\rule[0.3em]{${(tableWidth * 1.2).toFixed(1)}em}{0.06em}`
      return `${rule}\\rlap{${color ? `\\textcolor{${color}}{${line}}` : line}}`
    }
    const parts: string[] = []
    for (let column = 0; column < columnCount; column++) {
      const pieces = cells[column] ?? ['']
      for (let piece = 0; piece <= extra[column]; piece++) {
        const content = (pieces[piece] ?? '').trim()
        // \hfill 拆出来的右半段前面留一点空隙
        parts.push(content ? `\\text{${piece > 0 ? '\\quad ' : ''}${content}}` : '')
      }
    }
    return `${rule}${parts.join(' & ')}`
  })
  return `\\text{$\\begin{array}{${newSpec}}${lines.join(' \\\\ ')}\\end{array}$}`
}

const BEGIN_TABULAR = /\\begin\{tabular\*?\}/g

export const fixLatex = (input: string): string => {
  let source = input.replace(ZERO_WIDTH, '')
  if (source.includes('\\begin{tabular')) {
    let result = ''
    let last = 0
    for (const match of source.matchAll(BEGIN_TABULAR)) {
      if (match.index < last) {
        continue
      }
      let cursor = match.index + match[0].length
      // tabular* 的宽度参数
      if (match[0].includes('*')) {
        const width = readGroup(source, cursor)
        cursor = width ? width[1] : cursor
      }
      // 可选的位置参数 [t]
      const position = source.slice(cursor).match(/^\s*\[[^\]]*\]/)
      cursor += position ? position[0].length : 0
      while (source[cursor] === ' ' || source[cursor] === '\n') {
        cursor++
      }
      const spec = readGroup(source, cursor)
      if (!spec) {
        continue
      }
      const end = source.indexOf('\\end{tabular', spec[1])
      if (end === -1) {
        continue
      }
      const closing = source.indexOf('}', end) + 1
      result += source.slice(last, match.index) + convertTabular(spec[0], source.slice(spec[1], end))
      last = closing
    }
    source = result + source.slice(last)
  }
  return source
    .replace(/\\(?:centering|raggedright|raggedleft|noindent)\b/g, '')
    .replace(/\\vspace\*?\{[^{}]*\}/g, '')
    .replace(/\\hfill\b/g, '\\quad ')
}
