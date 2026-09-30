/** Friendly nickname suggestions (English content pack). None may start with "Bot". */
export const NAME_SUGGESTIONS = [
  'Chalk Ninja',
  'Paper Plane',
  'Tiffin Boss',
  'Bench Topper',
  'Backbencher',
  'Eraser Hero',
  'Chit Master',
  'Recess King',
  'Doodle Star',
  'Sharpener',
  'Inkpot',
  'Last Bencher',
];

export function randomNameSuggestion(exclude?: string): string {
  const options = NAME_SUGGESTIONS.filter((n) => n !== exclude);
  return options[Math.floor(Math.random() * options.length)] ?? 'Player';
}
