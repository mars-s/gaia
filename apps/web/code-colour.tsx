const languages: Record<string, string> = {
  typescript: "TypeScript", ts: "TypeScript", tsx: "TSX",
  javascript: "JavaScript", js: "JavaScript", jsx: "JSX",
  json: "JSON", python: "Python", py: "Python",
  bash: "Bash", sh: "Shell", css: "CSS", html: "HTML",
};

export function languageLabel(language?: string) {
  return language ? languages[language.toLowerCase()] ?? language[0].toUpperCase() + language.slice(1) : "Code";
}

export function ColourCode({ text, language }: { text: string; language?: string }) {
  if (!language || !/^(typescript|ts|tsx|javascript|js|jsx|json|python|py)$/.test(language.toLowerCase()))
    return <>{text}</>;
  const python = /^(python|py)$/.test(language.toLowerCase());
  const pattern = python
    ? /(#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(def|class|return|if|else|elif|for|in|import|from|as|True|False|None|and|or|not|with|async|await)\b|\b(\d+(?:\.\d+)?)\b/gm
    : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(const|let|var|function|return|if|else|for|of|in|import|from|export|default|class|new|true|false|null|undefined|async|await|interface|type|extends|typeof|number|string|boolean)\b|\b(\d+(?:\.\d+)?)\b/g;
  const parts = [];
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push(text.slice(end, match.index));
    const kind = match[1] ? "comment" : match[2] ? "string" : match[3] ? "keyword" : "number";
    parts.push(<span key={match.index} className={`code-${kind}`}>{match[0]}</span>);
    end = match.index + match[0].length;
  }
  parts.push(text.slice(end));
  return <>{parts}</>;
}
