'use strict';
// Greek landline area code → region (the 13 peripheries). Approximate: an area code is where the line is
// registered, not where the caller stands, and mobiles (69…) carry no place at all.

const REGIONS = {
  attica: { en: 'Attica', el: 'Αττική', lat: 38.0, lon: 23.75 },
  central_macedonia: { en: 'Central Macedonia', el: 'Κεντρική Μακεδονία', lat: 40.7, lon: 23.0 },
  east_macedonia_thrace: { en: 'East Macedonia and Thrace', el: 'Ανατολική Μακεδονία και Θράκη', lat: 41.1, lon: 25.0 },
  west_macedonia: { en: 'West Macedonia', el: 'Δυτική Μακεδονία', lat: 40.4, lon: 21.6 },
  epirus: { en: 'Epirus', el: 'Ήπειρος', lat: 39.6, lon: 20.8 },
  thessaly: { en: 'Thessaly', el: 'Θεσσαλία', lat: 39.5, lon: 22.3 },
  central_greece: { en: 'Central Greece', el: 'Στερεά Ελλάδα', lat: 38.7, lon: 22.8 },
  ionian_islands: { en: 'Ionian Islands', el: 'Ιόνια Νησιά', lat: 38.7, lon: 20.4 },
  west_greece: { en: 'West Greece', el: 'Δυτική Ελλάδα', lat: 38.3, lon: 21.6 },
  peloponnese: { en: 'Peloponnese', el: 'Πελοπόννησος', lat: 37.4, lon: 22.3 },
  north_aegean: { en: 'North Aegean', el: 'Βόρειο Αιγαίο', lat: 39.2, lon: 26.2 },
  south_aegean: { en: 'South Aegean', el: 'Νότιο Αιγαίο', lat: 36.9, lon: 25.4 },
  crete: { en: 'Crete', el: 'Κρήτη', lat: 35.2, lon: 24.9 }
};

// Longest prefix wins. Digits after +30.
const PREFIXES = [
  ['21', 'attica'],
  ['222', 'central_greece'], ['223', 'central_greece'],
  ['224', 'south_aegean'],
  ['225', 'north_aegean'],
  ['226', 'central_greece'], ['2263', 'attica'],
  ['227', 'north_aegean'],
  ['228', 'south_aegean'],
  ['229', 'attica'],
  ['23', 'central_macedonia'], ['2385', 'west_macedonia'], ['2386', 'west_macedonia'],
  ['241', 'thessaly'], ['242', 'thessaly'], ['243', 'thessaly'], ['244', 'thessaly'],
  ['246', 'west_macedonia'],
  ['25', 'east_macedonia_thrace'],
  ['26', 'west_greece'],
  ['2645', 'ionian_islands'],
  ['265', 'epirus'],
  ['266', 'ionian_islands'], ['2664', 'epirus'], ['2665', 'epirus'], ['2666', 'epirus'],
  ['267', 'ionian_islands'],
  ['268', 'epirus'],
  ['2695', 'ionian_islands'],
  ['27', 'peloponnese'],
  ['28', 'crete']
].sort((a, b) => b[0].length - a[0].length);

// 'mobile' for Greek mobiles, a region id for Greek landlines we can place, null otherwise.
function regionForPhone(e164) {
  if (!e164 || !String(e164).startsWith('+30')) return null;
  const n = String(e164).slice(3);
  if (n.startsWith('69')) return 'mobile';
  const hit = PREFIXES.find(([p]) => n.startsWith(p));
  return hit ? hit[1] : null;
}

module.exports = { REGIONS, regionForPhone };
