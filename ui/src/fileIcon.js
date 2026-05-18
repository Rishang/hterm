/** @type {Record<string, {label:string, bg:string, color:string}>} */
export const EXT_ICONS = {
  js:    { label: 'JS',  bg: 'var(--file-yellow-bg)', color: 'var(--accent-yellow)' },
  mjs:   { label: 'JS',  bg: 'var(--file-yellow-bg)', color: 'var(--accent-yellow)' },
  jsx:   { label: 'RJ',  bg: 'var(--file-blue-bg)', color: 'var(--accent-blue)' },
  ts:    { label: 'TS',  bg: 'var(--file-blue-bg)', color: 'var(--accent-blue)' },
  tsx:   { label: 'RX',  bg: 'var(--file-cyan-bg)', color: 'var(--accent-cyan)' },
  svelte:{ label: 'SV',  bg: 'var(--file-red-bg)', color: 'var(--status-disconnected)' },
  py:    { label: 'PY',  bg: 'var(--file-green-bg)', color: 'var(--accent-green)' },
  go:    { label: 'GO',  bg: 'var(--file-cyan-bg)', color: 'var(--accent-cyan)' },
  rs:    { label: 'RS',  bg: 'var(--file-orange-bg)', color: 'var(--accent-orange)' },
  rb:    { label: 'RB',  bg: 'var(--file-red-bg)', color: 'var(--status-disconnected)' },
  java:  { label: 'JV',  bg: 'var(--file-red-bg)', color: 'var(--status-disconnected)' },
  cpp:   { label: 'C++', bg: 'var(--file-blue-bg)', color: 'var(--accent-blue)' },
  c:     { label: 'C',   bg: 'var(--file-blue-bg)', color: 'var(--accent-blue)' },
  cs:    { label: 'C#',  bg: 'var(--file-purple-bg)', color: 'var(--accent-purple)' },
  html:  { label: '<>',  bg: 'var(--file-orange-bg)', color: 'var(--accent-orange)' },
  css:   { label: '#',   bg: 'var(--file-blue-bg)', color: 'var(--accent-blue)' },
  scss:  { label: 'SC',  bg: 'var(--file-purple-bg)', color: 'var(--accent-purple)' },
  json:  { label: '{}',  bg: 'var(--file-yellow-bg)', color: 'var(--accent-yellow)' },
  yaml:  { label: 'Y',   bg: 'var(--file-purple-bg)', color: 'var(--accent-purple)' },
  yml:   { label: 'Y',   bg: 'var(--file-purple-bg)', color: 'var(--accent-purple)' },
  toml:  { label: 'TM',  bg: 'var(--file-orange-bg)', color: 'var(--accent-orange)' },
  md:    { label: 'MD',  bg: 'var(--file-gray-bg)', color: 'var(--text-primary)' },
  sh:    { label: '$',   bg: 'var(--file-green-bg)', color: 'var(--accent-green)' },
  bash:  { label: '$',   bg: 'var(--file-green-bg)', color: 'var(--accent-green)' },
  zsh:   { label: '$',   bg: 'var(--file-green-bg)', color: 'var(--accent-green)' },
  fish:  { label: '$',   bg: 'var(--file-green-bg)', color: 'var(--accent-green)' },
  sql:   { label: 'DB',  bg: 'var(--file-cyan-bg)', color: 'var(--accent-cyan)' },
  xml:   { label: '<>',  bg: 'var(--file-orange-bg)', color: 'var(--accent-orange)' },
  txt:   { label: 'TXT', bg: 'var(--file-gray-bg)', color: 'var(--text-primary)' },
};

/** @param {string} name @returns {{label:string,bg:string,color:string}|null} */
export function fileIcon(name) {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return { label: 'DK', bg: 'var(--file-blue-bg)', color: 'var(--accent-blue)' };
  if (lower === '.env' || lower.startsWith('.env')) return { label: 'ENV', bg: 'var(--file-green-bg)', color: 'var(--accent-green)' };
  const SHELL_NAMES = new Set(['.bashrc','.bash_profile','.bash_aliases','.zshrc','.zprofile','.profile','.fishrc','bashrc','zshrc','profile']);
  if (SHELL_NAMES.has(lower)) return { label: '$', bg: 'var(--file-green-bg)', color: 'var(--accent-green)' };
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_ICONS[ext] ?? null;
}
