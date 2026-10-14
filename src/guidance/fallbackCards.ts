import type { GuidanceCard } from '@/api/types';

/**
 * Critical fallback cards: shipped inside the app, so they show with no network, no
 * synced bundle and no model (plan v3 §8.2: "hard-coded fallbacks for critical
 * actions, model-independent").
 *
 * Wording is taken closely from the cited official pages (checked 2026-10-04).
 * Keep it that way: change these only by re-reading the source, and update
 * REVIEWED when you do. Synced cards with the same card_id replace these.
 */
const REVIEWED = '2026-10-04T12:00:00Z'; // midday UTC, so it reads as the same date in every time zone

const READY = 'FEMA Ready.gov';

export const FALLBACK_CARDS: GuidanceCard[] = [
  {
    card_id: 'fallback-flood-warning',
    hazard_type: 'flood',
    applies_when: 'Flood warning, or water rising',
    title: 'Flood: get to higher ground',
    body:
      'Find safe shelter right away. Do not walk, swim or drive through flood waters. Turn Around, Don’t Drown! ' +
      'Just six inches of moving water can knock you down, and one foot of moving water can sweep your vehicle away. ' +
      'Stay off bridges over fast-moving water. Evacuate if told to do so, or move to higher ground or a higher floor.',
    priority: 5,
    source_name: READY,
    source_url: 'https://www.ready.gov/floods',
    last_reviewed_at: REVIEWED,
    is_critical_fallback: true,
  },
  {
    card_id: 'fallback-flood-trapped',
    hazard_type: 'flood',
    applies_when: 'Trapped by flood water',
    title: 'Flood: if you are trapped',
    body:
      'Stay inside your car if it is trapped in rapidly moving water. Get on the roof if water is rising inside the car. ' +
      'If trapped in a building, get to the highest level. Only get on the roof if necessary, and signal for help. ' +
      'Do not climb into a closed attic.',
    priority: 6,
    source_name: READY,
    source_url: 'https://www.ready.gov/floods',
    last_reviewed_at: REVIEWED,
    is_critical_fallback: true,
  },
  {
    card_id: 'fallback-earthquake-shaking',
    hazard_type: 'earthquake',
    applies_when: 'The ground is shaking',
    title: 'Earthquake: Drop, Cover, Hold On',
    body:
      'Drop where you are onto hands and knees. Cover your head and neck with one arm and hand; if a sturdy table or desk ' +
      'is nearby, crawl underneath it. Hold on until the shaking stops. If you are inside, stay and do not run outside; ' +
      'avoid doorways. If you are in bed, turn face down and cover your head and neck with a pillow. If you are outside, ' +
      'stay there and move away from buildings, trees, streetlights and power lines.',
    priority: 5,
    source_name: READY,
    source_url: 'https://www.ready.gov/earthquakes',
    last_reviewed_at: REVIEWED,
    is_critical_fallback: true,
  },
  {
    card_id: 'fallback-earthquake-after',
    hazard_type: 'earthquake',
    applies_when: 'After the shaking stops',
    title: 'Earthquake: after the shaking',
    body:
      'Expect aftershocks; be ready to Drop, Cover and Hold On again. If you are in an area that may experience tsunamis, ' +
      'go inland or to higher ground immediately after the shaking stops. If you are trapped, send a text or bang on a pipe ' +
      'or wall. Cover your mouth with your shirt and use a whistle instead of shouting.',
    priority: 8,
    source_name: READY,
    source_url: 'https://www.ready.gov/earthquakes',
    last_reviewed_at: REVIEWED,
    is_critical_fallback: true,
  },
  {
    card_id: 'fallback-fire-evacuate',
    hazard_type: 'fire',
    applies_when: 'Wildfire nearby',
    title: 'Wildfire: leave when told',
    body:
      'Evacuate immediately if authorities tell you to do so. If trapped, call 9-1-1 and give your location, but be aware ' +
      'that emergency response could be delayed or impossible. Turn on lights to help rescuers find you. Use an N95 mask ' +
      'to protect yourself from smoke. If you are not ordered to evacuate but it is smoky, stay inside in a safe location.',
    priority: 5,
    source_name: READY,
    source_url: 'https://www.ready.gov/wildfires',
    last_reviewed_at: REVIEWED,
    is_critical_fallback: true,
  },
  {
    card_id: 'fallback-storm-tornado',
    hazard_type: 'storm',
    applies_when: 'Tornado or severe weather warning',
    title: 'Tornado: take shelter now',
    body:
      'Immediately go to a safe location: a safe room, storm shelter, or a small, interior, windowless room or basement on ' +
      'the lowest level of a sturdy building. Stay away from windows, doors and outside walls. Use your arms to protect ' +
      'your head and neck. Watch out for flying debris. Do not shelter under bridges.',
    priority: 5,
    source_name: READY,
    source_url: 'https://www.ready.gov/tornadoes',
    last_reviewed_at: REVIEWED,
    is_critical_fallback: true,
  },
  {
    card_id: 'fallback-storm-tornado-car',
    hazard_type: 'storm',
    applies_when: 'Caught in a tornado while driving',
    title: 'Tornado: if you are in a car',
    body:
      'If you are caught by extreme winds or flying debris, park the car as quickly and safely as possible, out of the ' +
      'traffic lanes. Stay in the car with the seat belt on. Put your head down below the windows and cover your head ' +
      'with your hands and a blanket, coat or other cushion if possible.',
    priority: 6,
    source_name: READY,
    source_url: 'https://www.ready.gov/tornadoes',
    last_reviewed_at: REVIEWED,
    is_critical_fallback: true,
  },
  {
    card_id: 'fallback-storm-lightning',
    hazard_type: 'storm',
    applies_when: 'Thunderstorm',
    title: 'Thunderstorm: when thunder roars, go indoors',
    body:
      'When thunder roars, go indoors! Move from outdoors into a building or car with a roof. Do not drive through flooded ' +
      'roadways: just six inches of fast-moving water can knock you down, and one foot of moving water can sweep your ' +
      'vehicle away.',
    priority: 10,
    source_name: READY,
    source_url: 'https://www.ready.gov/thunderstorms-lightning',
    last_reviewed_at: REVIEWED,
    is_critical_fallback: true,
  },
  {
    card_id: 'fallback-landslide',
    hazard_type: 'landslide',
    applies_when: 'Landslide or debris flow danger',
    title: 'Landslide: move uphill, don’t wait',
    body:
      'Leave if you have been told to evacuate or feel it is unsafe to stay. By the time you are sure a debris flow is coming, ' +
      'it will be too late to get away safely. If you are in its path, move uphill as quickly as possible. Never cross a road ' +
      'with water or mud flowing, or a bridge if you see a flow approaching. Avoid river valleys and low-lying areas.',
    priority: 5,
    source_name: READY,
    source_url: 'https://www.ready.gov/landslides-debris-flow',
    last_reviewed_at: REVIEWED,
    is_critical_fallback: true,
  },
  {
    card_id: 'fallback-other-power-outage',
    hazard_type: 'other',
    applies_when: 'Power is out',
    title: 'Power outage: avoid carbon monoxide',
    body:
      'Use a generator only outdoors, at least 20 feet away from windows, doors and attached garages. Do not use a gas stove ' +
      'or oven to heat your home: it increases your risk of carbon monoxide poisoning. Keep freezers and refrigerators closed.',
    priority: 20,
    source_name: READY,
    source_url: 'https://www.ready.gov/power-outages',
    last_reviewed_at: REVIEWED,
    is_critical_fallback: true,
  },
];
