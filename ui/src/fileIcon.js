/** @type {Record<string, {label:string, bg:string, color:string}>} */
export const EXT_ICONS = {
  js:    { label: 'JS',  bg: '#e5c07b22', color: '#e5c07b' },
  mjs:   { label: 'JS',  bg: '#e5c07b22', color: '#e5c07b' },
  jsx:   { label: 'RJ',  bg: '#61afef22', color: '#61afef' },
  ts:    { label: 'TS',  bg: '#61afef22', color: '#61afef' },
  tsx:   { label: 'RX',  bg: '#56b6c222', color: '#56b6c2' },
  svelte:{ label: 'SV',  bg: '#e06c7522', color: '#e06c75' },
  py:    { label: 'PY',  bg: '#98c37922', color: '#98c379' },
  go:    { label: 'GO',  bg: '#56b6c222', color: '#56b6c2' },
  rs:    { label: 'RS',  bg: '#d19a6622', color: '#d19a66' },
  rb:    { label: 'RB',  bg: '#e06c7522', color: '#e06c75' },
  java:  { label: 'JV',  bg: '#e06c7522', color: '#e06c75' },
  cpp:   { label: 'C++', bg: '#61afef22', color: '#61afef' },
  c:     { label: 'C',   bg: '#61afef22', color: '#61afef' },
  cs:    { label: 'C#',  bg: '#c678dd22', color: '#c678dd' },
  html:  { label: '<>',  bg: '#d19a6622', color: '#d19a66' },
  css:   { label: '#',   bg: '#61afef22', color: '#61afef' },
  scss:  { label: 'SC',  bg: '#c678dd22', color: '#c678dd' },
  json:  { label: '{}',  bg: '#e5c07b22', color: '#e5c07b' },
  yaml:  { label: 'Y',   bg: '#c678dd22', color: '#c678dd' },
  yml:   { label: 'Y',   bg: '#c678dd22', color: '#c678dd' },
  toml:  { label: 'TM',  bg: '#d19a6622', color: '#d19a66' },
  md:    { label: 'MD',  bg: '#abb2bf22', color: '#abb2bf' },
  sh:    { label: '$',   bg: '#98c37922', color: '#98c379' },
  bash:  { label: '$',   bg: '#98c37922', color: '#98c379' },
  zsh:   { label: '$',   bg: '#98c37922', color: '#98c379' },
  fish:  { label: '$',   bg: '#98c37922', color: '#98c379' },
  sql:   { label: 'DB',  bg: '#56b6c222', color: '#56b6c2' },
  xml:   { label: '<>',  bg: '#d19a6622', color: '#d19a66' },
  txt:   { label: 'TXT', bg: '#abb2bf22', color: '#abb2bf' },
};

/** @param {string} name @returns {{label:string,bg:string,color:string}|null} */
export function fileIcon(name) {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return { label: 'DK', bg: '#61afef22', color: '#61afef' };
  if (lower === '.env' || lower.startsWith('.env')) return { label: 'ENV', bg: '#98c37922', color: '#98c379' };
  const SHELL_NAMES = new Set(['.bashrc','.bash_profile','.bash_aliases','.zshrc','.zprofile','.profile','.fishrc','bashrc','zshrc','profile']);
  if (SHELL_NAMES.has(lower)) return { label: '$', bg: '#98c37922', color: '#98c379' };
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_ICONS[ext] ?? null;
}
