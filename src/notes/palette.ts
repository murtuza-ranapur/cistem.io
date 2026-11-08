/** Colours a note can use. Only these are accepted when a note is read, so a file can't inject styles. */
export const HIGHLIGHTS = [
  { name: 'Yellow', value: '#fde68a' },
  { name: 'Green', value: '#bbf7d0' },
  { name: 'Blue', value: '#bfdbfe' },
  { name: 'Pink', value: '#fbcfe8' },
  { name: 'Orange', value: '#fed7aa' },
  { name: 'Purple', value: '#e9d5ff' },
] as const;

export const TEXT_COLORS = [
  { name: 'Red', value: '#c73a3a' },
  { name: 'Orange', value: '#b86a12' },
  { name: 'Green', value: '#2f8f5b' },
  { name: 'Blue', value: '#2b6cb0' },
  { name: 'Purple', value: '#8a3fa8' },
  { name: 'Grey', value: '#687079' },
] as const;
