// [Agent] Shared by the data scripts and the app. The array index is the category id stored in the DB and in events.bin, so reordering means refetching with --refresh.
// This is an allowlist on purpose. The generic "occurrence" class is half sports seasons, award shows and pageants, so only class trees that are actual history get in.
// Order also decides ties: an item matching several classes keeps the lowest category. Epidemic sits before disaster because Wikidata files epidemics under disasters, and the catch-all "historical event" comes last.
// weight scales the ranking score. A founding or a landmark is ranked by its *place's* article, and London's links are about modern London, not its founding in 47 AD. So places are damped until they compete with actual events instead of drowning them. Games and fairs are damped for the same reason in another form: every Olympian's biography links their Games, so the in-links count athletes, not significance.
export const CATEGORIES = [
  { name: 'battle', color: '#d63031', weight: 1, classes: ['Q178561', 'Q188055', 'Q645883'] },
  { name: 'war', color: '#8e1537', weight: 1, classes: ['Q198', 'Q350604', 'Q831663', 'Q3199915', 'Q2223653'] },
  { name: 'politics', color: '#5f4bb6', weight: 1, classes: ['Q131569', 'Q10931', 'Q45382', 'Q124734', 'Q124757', 'Q3882219', 'Q209715', 'Q175331'] },
  { name: 'epidemic', color: '#6ab04c', weight: 1, classes: ['Q44512', 'Q3241045'] },
  { name: 'disaster', color: '#e67e22', weight: 1, classes: ['Q3839081', 'Q8065', 'Q7944', 'Q7692360', 'Q168983', 'Q852190', 'Q744913'] },
  { name: 'exploration', color: '#0984e3', weight: 1, classes: ['Q2401485'] },
  { name: 'culture', color: '#e84393', weight: 0.3, classes: ['Q172754', 'Q135976384'] },
  { name: 'founding', color: '#00a887', weight: 0.15, classes: ['Q515'] },
  { name: 'landmark', color: '#c79a00', weight: 0.3, classes: ['Q23413', 'Q2977', 'Q44539', 'Q16560', 'Q12516', 'Q44613', 'Q32815', 'Q57821'] },
  { name: 'history', color: '#a0785a', weight: 1, classes: ['Q13418847'] },
] as const
