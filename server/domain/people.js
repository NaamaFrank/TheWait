/**
 * How a person is represented: the pin colours everyone picks from, and the
 * stand-in names used to populate a world that has not filled up yet.
 *
 * Both were duplicated across presence, the leaderboard and devices. They are
 * the same eight colours and the same cast of sample people wherever they
 * appear, so they live here.
 */

/** The eight pin colours offered on the profile screen. */
export const TINTS = [
  '#FFC53D',
  '#9BE8FF',
  '#FF9E7A',
  '#3DDC84',
  '#00E5D0',
  '#FFB3E1',
  '#D6D0FF',
  '#E8E2D4'
];

/**
 * The avatars people choose from.
 *
 * Characters rather than photographs: nothing is uploaded, so there is no face
 * on the server, nothing to moderate and nothing to leak - and a pin is still
 * recognisable at sixteen pixels, which a cropped photo is not.
 */
export const AVATARS = [
  '🐻', '🦊', '🐼', '🐨', '🐸', '🐙', '🦉', '🐧',
  '🦄', '🐝', '🐢', '🦋', '🐳', '🌵', '🍄', '⭐'
];

/** Deterministic, so an account keeps the same one until it picks another. */
export function defaultAvatar(id) {
  const sum = [...String(id)].reduce((total, char) => total + char.charCodeAt(0), 0);
  return AVATARS[sum % AVATARS.length];
}

/**
 * Stand-in people, one available per region.
 *
 * These are display names, because a display name is the only identity this app
 * has - they used to be handles (`kev_wu`, `anke_h`) carried over from the
 * design, which read as somebody else's leftover account once the handle field
 * was removed.
 *
 * Everywhere these appear they are flagged `simulated: true` and labelled in
 * the interface. They are not people.
 */
export const SAMPLE_NAMES = [
  'Kev Wu',
  'Marisol',
  'Tom B',
  'Anke H',
  'Priya',
  'Rin Ishida',
  'Dag S',
  'Lu Ferraz',
  'Wei Z',
  'Nayeli',
  'Adebayo O',
  'Camille',
  'Soo Park',
  'Jess Tran',
  'Noam',
  'Freja',
  'Inês M',
  'Barış',
  'Tuomas',
  'Chi Okonkwo',
  'Ravi S',
  'Mei Lin',
  'Jonas B',
  'Aiko',
  'Santi',
  'Petra',
  'Kwame',
  'Elif K',
  'Dmitri'
];
