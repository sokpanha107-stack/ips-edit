/** Natural ("human") ordering: Voice Clone-2 comes before Voice Clone-10, scene_03 before scene_12. Never uses size or time. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const naturalCompare = (a: string, b: string): number => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

/** Folders first, then everything in strict ascending natural order by file name. */
export function sortByName<T extends { name: string; kind?: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((x, y) => (Number(y.kind === 'folder') - Number(x.kind === 'folder')) || naturalCompare(x.name, y.name));
}
