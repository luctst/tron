export type Kind = 'read' | 'write'

const READ = /^(select|with|values|table|explain|show)\b/i

export function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

export function classify(sql: string): Kind {
  return READ.test(stripComments(sql).trimStart()) ? 'read' : 'write'
}

export function quoteIdent(s: string): string {
  return `"${s.replace(/"/g, '""')}"`
}

export function tableQuery(schema: string, name: string, page: number, pageSize: number): string {
  return `select * from ${quoteIdent(schema)}.${quoteIdent(name)} limit ${pageSize} offset ${page * pageSize}`
}
