/**
 * Destinations for "Before you go", bundled so picking one needs no signal and sends the
 * search text nowhere (no geocoding service sees where someone is going).
 *
 * Trekking hubs, parks and travel bases in the countries Moby has official websites and
 * emergency numbers for. Coordinates are approximate (town centre or trailhead, ~1 km);
 * the briefing uses a circle of 10–100 km around them, and the screen shows the point used.
 * For anywhere else: "Use my location", or long-press the map.
 */
export interface TripPlace {
  name: string;
  /** Region or area, shown under the name and searched too. */
  area: string;
  /** ISO 3166-1 alpha-2 */
  country: string;
  lat: number;
  lon: number;
}

const P = (name: string, area: string, country: string, lat: number, lon: number): TripPlace => ({
  name, area, country, lat, lon,
});

export const TRIP_PLACES: TripPlace[] = [
  // Nepal
  P('Kathmandu', 'Bagmati', 'NP', 27.7172, 85.324),
  P('Bhaktapur', 'Bagmati', 'NP', 27.671, 85.4298),
  P('Pokhara', 'Gandaki', 'NP', 28.2096, 83.9856),
  P('Lukla', 'Everest region, Solukhumbu', 'NP', 27.6869, 86.7298),
  P('Phakding', 'Everest region, Solukhumbu', 'NP', 27.7398, 86.713),
  P('Namche Bazaar', 'Everest region, Solukhumbu', 'NP', 27.8069, 86.714),
  P('Tengboche', 'Everest region, Solukhumbu', 'NP', 27.8362, 86.7646),
  P('Dingboche', 'Everest region, Solukhumbu', 'NP', 27.8923, 86.8314),
  P('Everest Base Camp', 'Everest region, Solukhumbu', 'NP', 28.0026, 86.8528),
  P('Ghorepani', 'Annapurna region', 'NP', 28.4005, 83.7003),
  P('Annapurna Base Camp', 'Annapurna region', 'NP', 28.5308, 83.8781),
  P('Manang', 'Annapurna Circuit', 'NP', 28.6667, 84.0167),
  P('Jomsom', 'Mustang', 'NP', 28.7804, 83.723),
  P('Syabrubesi', 'Langtang', 'NP', 28.16, 85.345),
  P('Kyanjin Gompa', 'Langtang', 'NP', 28.2117, 85.5622),
  P('Sauraha', 'Chitwan', 'NP', 27.5786, 84.4989),
  // India
  P('Delhi', 'Delhi', 'IN', 28.6139, 77.209),
  P('Leh', 'Ladakh', 'IN', 34.1526, 77.5771),
  P('Manali', 'Himachal Pradesh', 'IN', 32.2432, 77.1892),
  P('Shimla', 'Himachal Pradesh', 'IN', 31.1048, 77.1734),
  P('Rishikesh', 'Uttarakhand', 'IN', 30.0869, 78.2676),
  P('Darjeeling', 'West Bengal', 'IN', 27.041, 88.2663),
  P('Munnar', 'Kerala', 'IN', 10.0889, 77.0595),
  P('Panaji', 'Goa', 'IN', 15.4909, 73.8278),
  // China
  P('Beijing', 'Beijing', 'CN', 39.9042, 116.4074),
  P('Shanghai', 'Shanghai', 'CN', 31.2304, 121.4737),
  P('Hangzhou', 'Zhejiang', 'CN', 30.2741, 120.1551),
  P('Guangzhou', 'Guangdong', 'CN', 23.1291, 113.2644),
  P("Xi'an", 'Shaanxi', 'CN', 34.3416, 108.9398),
  P('Chengdu', 'Sichuan', 'CN', 30.6586, 104.0647),
  P('Dujiangyan', 'Sichuan', 'CN', 30.9886, 103.6476),
  P('Leshan', 'Sichuan', 'CN', 29.5521, 103.7656),
  P('Emeishan', 'Mount Emei, Sichuan', 'CN', 29.5714, 103.4448),
  P('Jiuzhaigou', 'Ngawa, Sichuan', 'CN', 33.2627, 103.9188),
  P('Kangding', 'Garzê, Sichuan', 'CN', 30.05, 101.9647),
  P('Kunming', 'Yunnan', 'CN', 25.0389, 102.7183),
  P('Dali', 'Yunnan', 'CN', 25.6065, 100.2676),
  P('Lijiang', 'Yunnan', 'CN', 26.8721, 100.2299),
  P('Shangri-La', 'Dêqên, Yunnan', 'CN', 27.8257, 99.7066),
  P('Kaili', 'Qiandongnan, Guizhou', 'CN', 26.5667, 107.98),
  P('Guilin', 'Guangxi', 'CN', 25.2736, 110.29),
  P('Yangshuo', 'Guilin, Guangxi', 'CN', 24.7781, 110.4966),
  P('Zhangjiajie', 'Wulingyuan, Hunan', 'CN', 29.3477, 110.5463),
  P('Huangshan', 'Tangkou, Anhui', 'CN', 30.0846, 118.1585),
  P('Lhasa', 'Tibet', 'CN', 29.652, 91.1721),
  // Japan
  P('Tokyo', 'Kanto', 'JP', 35.6762, 139.6503),
  P('Hakone', 'Kanagawa', 'JP', 35.2324, 139.1069),
  P('Fujiyoshida', 'Mount Fuji, Yamanashi', 'JP', 35.4875, 138.807),
  P('Kyoto', 'Kansai', 'JP', 35.0116, 135.7681),
  P('Osaka', 'Kansai', 'JP', 34.6937, 135.5023),
  P('Takayama', 'Gifu', 'JP', 36.1461, 137.2522),
  P('Kamikochi', 'Northern Alps, Nagano', 'JP', 36.249, 137.638),
  P('Hiroshima', 'Chugoku', 'JP', 34.3853, 132.4553),
  P('Sapporo', 'Hokkaido', 'JP', 43.0618, 141.3545),
  P('Naha', 'Okinawa', 'JP', 26.2124, 127.6809),
  // Indonesia
  P('Jakarta', 'Java', 'ID', -6.2088, 106.8456),
  P('Yogyakarta', 'Java', 'ID', -7.7956, 110.3695),
  P('Mount Bromo', 'East Java', 'ID', -7.9425, 112.953),
  P('Ubud', 'Bali', 'ID', -8.5069, 115.2625),
  P('Denpasar', 'Bali', 'ID', -8.6705, 115.2126),
  P('Senaru', 'Mount Rinjani, Lombok', 'ID', -8.31, 116.40),
  P('Labuan Bajo', 'Flores', 'ID', -8.4964, 119.8877),
  // Philippines
  P('Manila', 'Luzon', 'PH', 14.5995, 120.9842),
  P('Banaue', 'Ifugao, Luzon', 'PH', 16.911, 121.059),
  P('Cebu City', 'Cebu', 'PH', 10.3157, 123.8854),
  P('El Nido', 'Palawan', 'PH', 11.1956, 119.4075),
  P('Boracay', 'Aklan', 'PH', 11.9674, 121.9248),
  P('General Luna', 'Siargao', 'PH', 9.784, 126.156),
  // Thailand
  P('Bangkok', 'Central Thailand', 'TH', 13.7563, 100.5018),
  P('Chiang Mai', 'Northern Thailand', 'TH', 18.7883, 98.9853),
  P('Pai', 'Mae Hong Son', 'TH', 19.3583, 98.44),
  P('Phuket', 'Andaman coast', 'TH', 7.8804, 98.3923),
  P('Ao Nang', 'Krabi', 'TH', 8.0326, 98.8237),
  P('Ko Samui', 'Surat Thani', 'TH', 9.512, 100.0136),
  // New Zealand
  P('Auckland', 'North Island', 'NZ', -36.8485, 174.7633),
  P('Whakapapa Village', 'Tongariro, North Island', 'NZ', -39.2008, 175.5401),
  P('Christchurch', 'Canterbury', 'NZ', -43.5321, 172.6362),
  P('Franz Josef', 'West Coast', 'NZ', -43.388, 170.183),
  P('Queenstown', 'Otago', 'NZ', -45.0312, 168.6626),
  P('Milford Sound', 'Fiordland', 'NZ', -44.6414, 167.8974),
  // Iceland
  P('Reykjavík', 'Capital Region', 'IS', 64.1466, -21.9426),
  P('Vík', 'South Iceland', 'IS', 63.4186, -19.006),
  P('Landmannalaugar', 'Highlands', 'IS', 63.9833, -19.0667),
  P('Húsavík', 'North Iceland', 'IS', 66.0449, -17.3389),
  // Italy
  P('Rome', 'Lazio', 'IT', 41.9028, 12.4964),
  P('Florence', 'Tuscany', 'IT', 43.7696, 11.2558),
  P('Naples', 'Campania', 'IT', 40.8518, 14.2681),
  P('Monterosso al Mare', 'Cinque Terre, Liguria', 'IT', 44.146, 9.654),
  P("Cortina d'Ampezzo", 'Dolomites, Veneto', 'IT', 46.5405, 12.1357),
  P('Courmayeur', 'Aosta Valley', 'IT', 45.7967, 6.9722),
  // Greece
  P('Athens', 'Attica', 'GR', 37.9838, 23.7275),
  P('Kalabaka', 'Meteora, Thessaly', 'GR', 39.7066, 21.6306),
  P('Chania', 'Crete', 'GR', 35.5138, 24.018),
  P('Fira', 'Santorini', 'GR', 36.4167, 25.4317),
  // Spain
  P('Madrid', 'Community of Madrid', 'ES', 40.4168, -3.7038),
  P('Barcelona', 'Catalonia', 'ES', 41.3874, 2.1686),
  P('Valencia', 'Valencian Community', 'ES', 39.4699, -0.3763),
  P('Seville', 'Andalusia', 'ES', 37.3891, -5.9845),
  P('Granada', 'Andalusia', 'ES', 37.1773, -3.5986),
  P('Santa Cruz de Tenerife', 'Canary Islands', 'ES', 28.4636, -16.2518),
  // Portugal
  P('Lisbon', 'Lisbon', 'PT', 38.7223, -9.1393),
  P('Porto', 'Norte', 'PT', 41.1579, -8.6291),
  P('Lagos', 'Algarve', 'PT', 37.1028, -8.673),
  P('Funchal', 'Madeira', 'PT', 32.6669, -16.9241),
  // Mexico
  P('Mexico City', 'CDMX', 'MX', 19.4326, -99.1332),
  P('Oaxaca', 'Oaxaca', 'MX', 17.0732, -96.7266),
  P('San Cristóbal de las Casas', 'Chiapas', 'MX', 16.737, -92.6376),
  P('Cancún', 'Quintana Roo', 'MX', 21.1619, -86.8515),
  P('Tulum', 'Quintana Roo', 'MX', 20.2114, -87.4654),
  // United States
  P('San Francisco', 'California', 'US', 37.7749, -122.4194),
  P('Guerneville', 'Russian River, California', 'US', 38.5021, -122.9961),
  P('Yosemite Valley', 'California', 'US', 37.7456, -119.5936),
  P('Grand Canyon Village', 'Arizona', 'US', 36.0544, -112.1401),
  P('Springdale', 'Zion, Utah', 'US', 37.1889, -112.9986),
  P('Moab', 'Utah', 'US', 38.5733, -109.5498),
  P('Old Faithful', 'Yellowstone, Wyoming', 'US', 44.4605, -110.8281),
  P('Denver', 'Colorado', 'US', 39.7392, -104.9903),
  P('Seattle', 'Washington', 'US', 47.6062, -122.3321),
  P('New Orleans', 'Louisiana', 'US', 29.9511, -90.0715),
  P('Miami', 'Florida', 'US', 25.7617, -80.1918),
  P('Honolulu', 'Hawaii', 'US', 21.3069, -157.8583),
];

const COUNTRY_NAMES: Record<string, string> = {
  NP: 'Nepal', IN: 'India', CN: 'China', JP: 'Japan', ID: 'Indonesia', PH: 'Philippines', TH: 'Thailand', NZ: 'New Zealand',
  IS: 'Iceland', IT: 'Italy', GR: 'Greece', ES: 'Spain', PT: 'Portugal', MX: 'Mexico', US: 'United States',
};

export function countryName(code: string | undefined | null): string | undefined {
  return code ? COUNTRY_NAMES[code] : undefined;
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Places whose name, area or country contains the query; names that start with it first. */
export function searchPlaces(query: string, limit = 6): TripPlace[] {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const hits = TRIP_PLACES.filter((p) => fold(`${p.name} ${p.area} ${COUNTRY_NAMES[p.country] ?? ''}`).includes(q));
  return hits
    .sort((a, b) => Number(!fold(a.name).startsWith(q)) - Number(!fold(b.name).startsWith(q)))
    .slice(0, limit);
}
