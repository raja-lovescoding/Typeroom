export function RacerTag({ racer }: { racer: { isBot: boolean; isGhost: boolean } }) {
  return racer.isBot || racer.isGhost ? null : null;
}

export function racerSuffix(racer: { isBot: boolean; isGhost: boolean }): string {
  return racer.isBot || racer.isGhost ? '' : '';
}
