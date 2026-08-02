export interface SearchSnippetPart {
  text: string
  highlighted: boolean
}

export function parseSearchSnippet(snippet: string): SearchSnippetPart[] {
  const parts: SearchSnippetPart[] = []
  let highlighted = false

  for (const token of snippet.split(/(<mark>|<\/mark>)/)) {
    if (token === '<mark>') {
      highlighted = true
    } else if (token === '</mark>') {
      highlighted = false
    } else if (token) {
      parts.push({ text: token, highlighted })
    }
  }

  return parts
}
