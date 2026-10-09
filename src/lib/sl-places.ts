// ============================================================================
// Sri Lanka place knowledge — province → district → town, with coordinates
// ============================================================================
// The Match Finder has to understand whatever an agent (or a website user)
// typed as a location: a town ("Kottawa"), a district ("Kurunegala District"),
// a province ("Western", "Down South"), a misspelling ("Rathnpure",
// "Mathara", "Avissawelle") or Sinhala ("කුරුණෑගල"). resolvePlace() turns any
// of those into a point plus its district and province, so two locations can
// be compared by distance and by area.
//
// Coordinates are town centres — good to a few km, which is all a "nearby"
// decision needs. Most website profiles carry their own Google lat/lng; this
// table is for the ones that don't, and for what agents type.
// ============================================================================

export type Province =
  | 'Western' | 'Central' | 'Southern' | 'Northern' | 'Eastern'
  | 'North Western' | 'North Central' | 'Uva' | 'Sabaragamuwa'

export interface District { name: string; province: Province; lat: number; lng: number }

export const DISTRICTS: District[] = [
  { name: 'Colombo', province: 'Western', lat: 6.9271, lng: 79.8612 },
  { name: 'Gampaha', province: 'Western', lat: 7.0917, lng: 79.9999 },
  { name: 'Kalutara', province: 'Western', lat: 6.5854, lng: 79.9607 },
  { name: 'Kandy', province: 'Central', lat: 7.2906, lng: 80.6337 },
  { name: 'Matale', province: 'Central', lat: 7.4675, lng: 80.6234 },
  { name: 'Nuwara Eliya', province: 'Central', lat: 6.9497, lng: 80.7891 },
  { name: 'Galle', province: 'Southern', lat: 6.0329, lng: 80.2168 },
  { name: 'Matara', province: 'Southern', lat: 5.9549, lng: 80.5550 },
  { name: 'Hambantota', province: 'Southern', lat: 6.1241, lng: 81.1185 },
  { name: 'Jaffna', province: 'Northern', lat: 9.6615, lng: 80.0255 },
  { name: 'Kilinochchi', province: 'Northern', lat: 9.3803, lng: 80.3770 },
  { name: 'Mannar', province: 'Northern', lat: 8.9810, lng: 79.9044 },
  { name: 'Vavuniya', province: 'Northern', lat: 8.7542, lng: 80.4982 },
  { name: 'Mullaitivu', province: 'Northern', lat: 9.2671, lng: 80.8142 },
  { name: 'Trincomalee', province: 'Eastern', lat: 8.5874, lng: 81.2152 },
  { name: 'Batticaloa', province: 'Eastern', lat: 7.7310, lng: 81.6747 },
  { name: 'Ampara', province: 'Eastern', lat: 7.2975, lng: 81.6820 },
  { name: 'Kurunegala', province: 'North Western', lat: 7.4818, lng: 80.3609 },
  { name: 'Puttalam', province: 'North Western', lat: 8.0362, lng: 79.8283 },
  { name: 'Anuradhapura', province: 'North Central', lat: 8.3114, lng: 80.4037 },
  { name: 'Polonnaruwa', province: 'North Central', lat: 7.9403, lng: 81.0188 },
  { name: 'Badulla', province: 'Uva', lat: 6.9934, lng: 81.0550 },
  { name: 'Monaragala', province: 'Uva', lat: 6.8728, lng: 81.3507 },
  { name: 'Ratnapura', province: 'Sabaragamuwa', lat: 6.6828, lng: 80.3992 },
  { name: 'Kegalle', province: 'Sabaragamuwa', lat: 7.2513, lng: 80.3464 },
]

// [town, district, lat, lng, ...aliases]
type TownRow = [string, string, number, number, ...string[]]
const TOWNS: TownRow[] = [
  // Colombo
  ['Colombo City Port', 'Colombo', 6.9378, 79.8368, 'Colombo Fort', 'Fort', 'Pettah'],
  ['Dehiwala-Mount Lavinia', 'Colombo', 6.8390, 79.8650, 'Dehiwala', 'Mount Lavinia'],
  ['Moratuwa', 'Colombo', 6.7730, 79.8816],
  ['Sri Jayawardenepura Kotte', 'Colombo', 6.8905, 79.9020, 'Kotte'],
  ['Nugegoda', 'Colombo', 6.8649, 79.8997, 'නුගේගොඩ'],
  ['Maharagama', 'Colombo', 6.8480, 79.9265],
  ['Kottawa', 'Colombo', 6.8412, 79.9650],
  ['Pannipitiya', 'Colombo', 6.8466, 79.9490],
  ['Homagama', 'Colombo', 6.8441, 80.0024],
  ['Piliyandala', 'Colombo', 6.8018, 79.9227],
  ['Kesbewa', 'Colombo', 6.7953, 79.9405],
  ['Boralesgamuwa', 'Colombo', 6.8414, 79.9010],
  ['Battaramulla', 'Colombo', 6.8980, 79.9223],
  ['Rajagiriya', 'Colombo', 6.9090, 79.8960],
  ['Malabe', 'Colombo', 6.9061, 79.9696],
  ['Kaduwela', 'Colombo', 6.9291, 79.9828],
  ['Athurugiriya', 'Colombo', 6.8790, 79.9970],
  ['Hokandara', 'Colombo', 6.8850, 79.9690],
  ['Hanwella', 'Colombo', 6.9010, 80.0850],
  ['Avissawella', 'Colombo', 6.9553, 80.2040],
  ['Padukka', 'Colombo', 6.8410, 80.0900],
  ['Meegoda', 'Colombo', 6.8440, 80.0470],
  ['Kosgama', 'Colombo', 6.9330, 80.1420],
  ['Kolonnawa', 'Colombo', 6.9330, 79.8880],
  ['Kotikawatta', 'Colombo', 6.9300, 79.9050],
  ['Wellawatte', 'Colombo', 6.8747, 79.8604],
  ['Ratmalana', 'Colombo', 6.8195, 79.8800, 'Rathmalana'],
  ['Polgasowita', 'Colombo', 6.7870, 79.9800],
  ['Mattegoda', 'Colombo', 6.8130, 79.9750, 'Mattehgoda'],
  ['East Colombo', 'Colombo', 6.9100, 79.9500],
  ['Mulleriyawa', 'Colombo', 6.9330, 79.9300],
  ['Thalangama', 'Colombo', 6.8960, 79.9300, 'Talangama'],
  ['Wellampitiya', 'Colombo', 6.9390, 79.8890],
  ['Mattakkuliya', 'Colombo', 6.9750, 79.8700],
  ['Dematagoda', 'Colombo', 6.9370, 79.8790],
  ['Borella', 'Colombo', 6.9150, 79.8780],
  ['Bambalapitiya', 'Colombo', 6.8890, 79.8560],
  ['Kirulapone', 'Colombo', 6.8780, 79.8770],
  // Gampaha
  ['Negombo', 'Gampaha', 7.2083, 79.8358, 'Migamuwa'],
  ['Ja-Ela', 'Gampaha', 7.0744, 79.8919],
  ['Wattala', 'Gampaha', 6.9890, 79.8920],
  ['Kelaniya', 'Gampaha', 6.9553, 79.9220],
  ['Peliyagoda', 'Gampaha', 6.9600, 79.8850],
  ['Kiribathgoda', 'Gampaha', 6.9800, 79.9290],
  ['Kadawatha', 'Gampaha', 7.0016, 79.9530],
  ['Ragama', 'Gampaha', 7.0300, 79.9220],
  ['Kandana', 'Gampaha', 7.0480, 79.8970],
  ['Welisara', 'Gampaha', 7.0250, 79.9020],
  ['Seeduwa', 'Gampaha', 7.1247, 79.8750],
  ['Katunayake', 'Gampaha', 7.1690, 79.8840],
  ['Kotugoda', 'Gampaha', 7.1300, 79.9300],
  ['Minuwangoda', 'Gampaha', 7.1667, 79.9500],
  ['Divulapitiya', 'Gampaha', 7.2240, 80.0140],
  ['Mirigama', 'Gampaha', 7.2410, 80.1270],
  ['Nittambuwa', 'Gampaha', 7.1440, 80.0960],
  ['Veyangoda', 'Gampaha', 7.1580, 80.0560],
  ['Ganemulla', 'Gampaha', 7.0640, 79.9640],
  ['Yakkala', 'Gampaha', 7.0870, 80.0310],
  ['Kirindiwela', 'Gampaha', 7.0450, 80.1280],
  ['Delgoda', 'Gampaha', 6.9900, 80.0150],
  ['Dompe', 'Gampaha', 6.9490, 80.0560],
  ['Pugoda', 'Gampaha', 6.9700, 80.1240],
  ['Badalgama', 'Gampaha', 7.2862, 79.9856],
  ['Katana', 'Gampaha', 7.2530, 79.9050],
  ['Kotadeniyawa', 'Gampaha', 7.2500, 80.0600],
  ['Biyagama', 'Gampaha', 6.9420, 79.9890],
  ['Gampaha Town', 'Gampaha', 7.0917, 79.9999, 'Gampaha City'],
  ['Weliweriya', 'Gampaha', 7.0300, 80.0250],
  ['Imbulgoda', 'Gampaha', 7.0350, 79.9920],
  // Kalutara
  ['Panadura', 'Kalutara', 6.7132, 79.9026],
  ['Horana', 'Kalutara', 6.7230, 80.0647],
  ['Bandaragama', 'Kalutara', 6.7140, 79.9880],
  ['Wadduwa', 'Kalutara', 6.6670, 79.9290],
  ['Beruwala', 'Kalutara', 6.4788, 79.9828],
  ['Aluthgama', 'Kalutara', 6.4340, 80.0000, 'Alutgama'],
  ['Matugama', 'Kalutara', 6.5220, 80.1140],
  ['Agalawatta', 'Kalutara', 6.5410, 80.1570],
  ['Ingiriya', 'Kalutara', 6.7450, 80.1640],
  ['Bulathsinhala', 'Kalutara', 6.6650, 80.1650],
  ['Baduraliya', 'Kalutara', 6.5240, 80.2380],
  ['Dodangoda', 'Kalutara', 6.5560, 80.0250],
  ['Kalutara Town', 'Kalutara', 6.5854, 79.9607, 'Kalutara City'],
  ['Dharga Town', 'Kalutara', 6.4390, 80.0080],
  ['Payagala', 'Kalutara', 6.5260, 79.9750],
  // Galle
  ['Ambalangoda', 'Galle', 6.2350, 80.0540],
  ['Hikkaduwa', 'Galle', 6.1400, 80.1030],
  ['Elpitiya', 'Galle', 6.2910, 80.1590],
  ['Bentota', 'Galle', 6.4210, 80.0000],
  ['Baddegama', 'Galle', 6.1700, 80.1780],
  ['Karapitiya', 'Galle', 6.0600, 80.2250],
  ['Pitigala', 'Galle', 6.3490, 80.2160],
  ['Udugama', 'Galle', 6.2200, 80.3300],
  ['Batapola', 'Galle', 6.2350, 80.1240],
  ['Imaduwa', 'Galle', 6.0300, 80.3800],
  ['Ahangama', 'Galle', 5.9710, 80.3620],
  ['Habaraduwa', 'Galle', 6.0050, 80.3150],
  ['Nagoda', 'Galle', 6.2000, 80.2800],
  ['Neluwa', 'Galle', 6.3800, 80.3700],
  ['Karandeniya', 'Galle', 6.2600, 80.0800],
  ['Unawatuna', 'Galle', 6.0100, 80.2490],
  ['Hiniduma', 'Galle', 6.3080, 80.3160],
  // Matara
  ['Weligama', 'Matara', 5.9750, 80.4290],
  ['Akuressa', 'Matara', 6.1006, 80.4776],
  ['Dikwella', 'Matara', 5.9670, 80.6950, 'Dickwella'],
  ['Deniyaya', 'Matara', 6.3420, 80.5590],
  ['Morawaka', 'Matara', 6.2560, 80.4870],
  ['Kamburupitiya', 'Matara', 6.0750, 80.5630],
  ['Hakmana', 'Matara', 6.0800, 80.6500],
  ['Devinuwara', 'Matara', 5.9300, 80.5900, 'Dondra'],
  ['Mirissa', 'Matara', 5.9480, 80.4560],
  ['Kotapola', 'Matara', 6.2950, 80.5300],
  ['Pitabeddara', 'Matara', 6.2050, 80.4500],
  ['Mulatiyana', 'Matara', 6.1600, 80.5600],
  ['Kekanadura', 'Matara', 5.9800, 80.6000],
  ['Gandara', 'Matara', 5.9400, 80.6200],
  // Hambantota
  ['Tangalle', 'Hambantota', 6.0240, 80.7940],
  ['Ambalantota', 'Hambantota', 6.1180, 81.0260],
  ['Tissamaharama', 'Hambantota', 6.2776, 81.2860],
  ['Beliatta', 'Hambantota', 6.0490, 80.7350],
  ['Walasmulla', 'Hambantota', 6.1490, 80.6960],
  ['Weeraketiya', 'Hambantota', 6.1380, 80.7800],
  ['Sooriyawewa', 'Hambantota', 6.3240, 81.0150],
  ['Middeniya', 'Hambantota', 6.2500, 80.7700],
  ['Weerawila', 'Hambantota', 6.2700, 81.2300],
  ['Ridiyagama', 'Hambantota', 6.2100, 81.0000],
  ['Angunakolapelessa', 'Hambantota', 6.1700, 80.9000, 'Agunukolapelessa'],
  ['Lunugamwehera', 'Hambantota', 6.3500, 81.1700, 'Lunugamvehera'],
  ['Baliaththa', 'Hambantota', 6.0900, 81.0700],
  // Kandy
  ['Gampola', 'Kandy', 7.1640, 80.5770],
  ['Nawalapitiya', 'Kandy', 7.0560, 80.5340],
  ['Peradeniya', 'Kandy', 7.2690, 80.5970],
  ['Katugastota', 'Kandy', 7.3340, 80.6230],
  ['Kundasale', 'Kandy', 7.2780, 80.6880],
  ['Pilimatalawa', 'Kandy', 7.2660, 80.5490],
  ['Digana', 'Kandy', 7.2950, 80.7350],
  ['Akurana', 'Kandy', 7.3650, 80.6170],
  ['Kadugannawa', 'Kandy', 7.2540, 80.5210],
  ['Gelioya', 'Kandy', 7.2130, 80.6010],
  ['Teldeniya', 'Kandy', 7.3000, 80.7700],
  ['Wattegama', 'Kandy', 7.3500, 80.6800],
  ['Galagedara', 'Kandy', 7.3700, 80.5200],
  ['Deltota', 'Kandy', 7.1700, 80.6700],
  ['Ampitiya', 'Kandy', 7.2830, 80.6500],
  ['Gallella', 'Kandy', 7.1500, 80.6000],
  ['Mahanuwara', 'Kandy', 7.2906, 80.6337, 'මහනුවර', 'Nuwara'],
  ['Menikhinna', 'Kandy', 7.3150, 80.7380],
  ['Madawala', 'Kandy', 7.3350, 80.6950],
  ['Hasalaka', 'Kandy', 7.3550, 80.9450],
  ['Kandy City', 'Kandy', 7.2906, 80.6337, 'Kandy Town'],
  // Matale
  ['Dambulla', 'Matale', 7.8600, 80.6517],
  ['Galewela', 'Matale', 7.7590, 80.5680],
  ['Sigiriya', 'Matale', 7.9570, 80.7600],
  ['Ukuwela', 'Matale', 7.4200, 80.6300],
  ['Rattota', 'Matale', 7.5200, 80.6800],
  ['Naula', 'Matale', 7.7080, 80.6550],
  ['Palapathwela', 'Matale', 7.5400, 80.6200],
  ['Yatawatta', 'Matale', 7.5600, 80.5800],
  ['Wilgamuwa', 'Matale', 7.6800, 80.8800],
  // Nuwara Eliya
  ['Hatton', 'Nuwara Eliya', 6.8916, 80.5955],
  ['Talawakele', 'Nuwara Eliya', 6.9370, 80.6580, 'Talawakelle'],
  ['Walapane', 'Nuwara Eliya', 7.0920, 80.8620],
  ['Maskeliya', 'Nuwara Eliya', 6.8320, 80.5670],
  ['Kotagala', 'Nuwara Eliya', 6.9200, 80.6300],
  ['Nanu Oya', 'Nuwara Eliya', 6.9440, 80.7420],
  ['Kandapola', 'Nuwara Eliya', 6.9930, 80.8170],
  ['Ginigathhena', 'Nuwara Eliya', 6.9890, 80.4880, 'Ginigathena'],
  ['Watawala', 'Nuwara Eliya', 6.9480, 80.5370],
  ['Hanguranketha', 'Nuwara Eliya', 7.1700, 80.7800],
  ['Rikillagaskada', 'Nuwara Eliya', 7.1450, 80.7800],
  ['Bogawantalawa', 'Nuwara Eliya', 6.7900, 80.6800],
  ['Ragala', 'Nuwara Eliya', 6.9950, 80.7900],
  ['Hapugastenna', 'Nuwara Eliya', 7.0600, 80.7500],
  ['Lindula', 'Nuwara Eliya', 6.9150, 80.6700],
  ['Pundaluoya', 'Nuwara Eliya', 7.0170, 80.6750],
  // Kurunegala
  ['Kuliyapitiya', 'Kurunegala', 7.4688, 80.0401],
  ['Narammala', 'Kurunegala', 7.4320, 80.2160],
  ['Wariyapola', 'Kurunegala', 7.6250, 80.2440],
  ['Pannala', 'Kurunegala', 7.3290, 79.9990],
  ['Makandura', 'Kurunegala', 7.3200, 79.9800],
  ['Polgahawela', 'Kurunegala', 7.3330, 80.3000],
  ['Alawwa', 'Kurunegala', 7.2930, 80.2410],
  ['Thulhiriya', 'Kurunegala', 7.2600, 80.2300],
  ['Mawathagama', 'Kurunegala', 7.4380, 80.4400],
  ['Ibbagamuwa', 'Kurunegala', 7.5500, 80.4500],
  ['Galgamuwa', 'Kurunegala', 7.9950, 80.2660],
  ['Nikaweratiya', 'Kurunegala', 7.7470, 80.1150],
  ['Hettipola', 'Kurunegala', 7.6000, 80.0800],
  ['Giriulla', 'Kurunegala', 7.3290, 80.1270],
  ['Maho', 'Kurunegala', 7.8230, 80.2770],
  ['Pothuhera', 'Kurunegala', 7.4200, 80.3300],
  ['Rideegama', 'Kurunegala', 7.5500, 80.5000, 'Rideepana'],
  ['Bingiriya', 'Kurunegala', 7.6000, 79.9200],
  ['Kobeigane', 'Kurunegala', 7.6556, 80.1262],
  ['Melsiripura', 'Kurunegala', 7.6400, 80.4300],
  ['Hiripitiya', 'Kurunegala', 7.6200, 80.2500],
  ['Dummalasuriya', 'Kurunegala', 7.4900, 79.9900],
  // Puttalam
  ['Chilaw', 'Puttalam', 7.5758, 79.7953, 'Halawatha'],
  ['Wennappuwa', 'Puttalam', 7.3500, 79.8500],
  ['Marawila', 'Puttalam', 7.4170, 79.8250],
  ['Nattandiya', 'Puttalam', 7.4100, 79.8700],
  ['Dankotuwa', 'Puttalam', 7.2990, 79.8840],
  ['Madampe', 'Puttalam', 7.5000, 79.8400],
  ['Anamaduwa', 'Puttalam', 7.8800, 80.0000],
  ['Kalpitiya', 'Puttalam', 8.2300, 79.7600],
  ['Mundalama', 'Puttalam', 7.7800, 79.8100],
  ['Arachchikattuwa', 'Puttalam', 7.6800, 79.8300],
  ['Mahawewa', 'Puttalam', 7.4600, 79.8200],
  // Anuradhapura
  ['Kekirawa', 'Anuradhapura', 8.0400, 80.6000],
  ['Eppawala', 'Anuradhapura', 8.1440, 80.4100],
  ['Mihintale', 'Anuradhapura', 8.3500, 80.5000, 'මිහින්තලේ'],
  ['Tambuttegama', 'Anuradhapura', 8.1500, 80.3000],
  ['Medawachchiya', 'Anuradhapura', 8.5400, 80.4900],
  ['Kebithigollewa', 'Anuradhapura', 8.5300, 80.6800],
  ['Galnewa', 'Anuradhapura', 8.0300, 80.4400],
  ['Rajanganaya', 'Anuradhapura', 8.1500, 80.2500],
  ['Nochchiyagama', 'Anuradhapura', 8.2700, 80.2100],
  ['Thalawa', 'Anuradhapura', 8.2200, 80.3500],
  ['Habarana', 'Anuradhapura', 8.0400, 80.7500],
  ['Horowpothana', 'Anuradhapura', 8.5700, 80.8600, 'Horowpathana'],
  ['Kalaoya', 'Anuradhapura', 8.2500, 80.0200],
  ['Padaviya', 'Anuradhapura', 8.8200, 80.7600],
  // Polonnaruwa
  ['Hingurakgoda', 'Polonnaruwa', 8.0400, 80.9500],
  ['Medirigiriya', 'Polonnaruwa', 8.1400, 80.9600],
  ['Kaduruwela', 'Polonnaruwa', 7.9300, 81.0300],
  ['Dimbulagala', 'Polonnaruwa', 7.8600, 81.1300],
  ['Welikanda', 'Polonnaruwa', 7.9700, 81.2300],
  ['Bakamuna', 'Polonnaruwa', 7.7800, 80.8200],
  ['Aralaganwila', 'Polonnaruwa', 7.7500, 81.1400],
  ['Minneriya', 'Polonnaruwa', 8.0400, 80.9000],
  ['Giritale', 'Polonnaruwa', 7.9900, 80.9300],
  // Badulla
  ['Bandarawela', 'Badulla', 6.8259, 80.9982],
  ['Welimada', 'Badulla', 6.9040, 80.9130],
  ['Haputale', 'Badulla', 6.7660, 80.9580],
  ['Diyathalawa', 'Badulla', 6.8070, 80.9580],
  ['Ella', 'Badulla', 6.8667, 81.0466],
  ['Mahiyanganaya', 'Badulla', 7.3190, 80.9890, 'Mahiyangana'],
  ['Passara', 'Badulla', 6.9350, 81.1500],
  ['Hali Ela', 'Badulla', 6.9500, 81.0300],
  ['Namunukula', 'Badulla', 6.9200, 81.1100],
  ['Girandurukotte', 'Badulla', 7.4300, 81.0000],
  ['Meegahakiula', 'Badulla', 7.0800, 80.9900],
  ['Kandeketiya', 'Badulla', 7.1300, 81.0000],
  // Monaragala
  ['Wellawaya', 'Monaragala', 6.7380, 81.1030],
  ['Bibile', 'Monaragala', 7.1650, 81.2240],
  ['Buttala', 'Monaragala', 6.7580, 81.2470],
  ['Kataragama', 'Monaragala', 6.4130, 81.3330],
  ['Siyambalanduwa', 'Monaragala', 6.9100, 81.5500],
  ['Badalkumbura', 'Monaragala', 6.8900, 81.2370],
  ['Medagama', 'Monaragala', 7.0000, 81.3000],
  ['Sewanagala', 'Monaragala', 6.4800, 81.0500],
  ['Thanamalwila', 'Monaragala', 6.4400, 81.1300],
  // Ratnapura
  ['Balangoda', 'Ratnapura', 6.6470, 80.7000],
  ['Embilipitiya', 'Ratnapura', 6.3430, 80.8490],
  ['Pelmadulla', 'Ratnapura', 6.6200, 80.5400],
  ['Eheliyagoda', 'Ratnapura', 6.8480, 80.2650],
  ['Kuruwita', 'Ratnapura', 6.7790, 80.3640],
  ['Rakwana', 'Ratnapura', 6.4670, 80.6100],
  ['Kahawatta', 'Ratnapura', 6.5800, 80.5700],
  ['Godakawela', 'Ratnapura', 6.5000, 80.6500],
  ['Kalawana', 'Ratnapura', 6.5300, 80.4000],
  ['Kolonna', 'Ratnapura', 6.4000, 80.6800],
  ['Nivitigala', 'Ratnapura', 6.6000, 80.4500],
  ['Kiriella', 'Ratnapura', 6.7500, 80.2700],
  ['Ayagama', 'Ratnapura', 6.6400, 80.3100],
  // Kegalle
  ['Mawanella', 'Kegalle', 7.2520, 80.4460],
  ['Warakapola', 'Kegalle', 7.2270, 80.1980],
  ['Rambukkana', 'Kegalle', 7.3220, 80.3940],
  ['Yatiyanthota', 'Kegalle', 7.0289, 80.2955],
  ['Ruwanwella', 'Kegalle', 7.0440, 80.2560],
  ['Deraniyagala', 'Kegalle', 6.9250, 80.3360],
  ['Dehiowita', 'Kegalle', 6.9690, 80.2670],
  ['Kitulgala', 'Kegalle', 6.9950, 80.4180],
  ['Galigamuwa', 'Kegalle', 7.2340, 80.3110],
  ['Aranayaka', 'Kegalle', 7.1500, 80.4600],
  ['Bulathkohupitiya', 'Kegalle', 7.1000, 80.3400],
  // Ampara
  ['Kalmunai', 'Ampara', 7.4100, 81.8300],
  ['Sammanthurai', 'Ampara', 7.3800, 81.8100],
  ['Akkaraipattu', 'Ampara', 7.2200, 81.8500],
  ['Dehiattakandiya', 'Ampara', 7.6800, 81.0600],
  ['Uhana', 'Ampara', 7.3600, 81.6400],
  ['Mahaoya', 'Ampara', 7.5400, 81.3600],
  ['Pottuvil', 'Ampara', 6.8700, 81.8300],
  ['Sainthamaruthu', 'Ampara', 7.3900, 81.8300],
  ['Addalaichenai', 'Ampara', 7.2900, 81.8400],
  ['Padiyatalawa', 'Ampara', 7.3800, 81.2400],
  ['Oluvil', 'Ampara', 7.2700, 81.8500],
  ['Lahugala', 'Ampara', 6.8900, 81.7300],
  // Trincomalee / Batticaloa
  ['Kantale', 'Trincomalee', 8.3600, 81.0000, 'Kanthale'],
  ['Nilaveli', 'Trincomalee', 8.6800, 81.1900],
  ['Kinniya', 'Trincomalee', 8.5000, 81.1800],
  ['Mutur', 'Trincomalee', 8.4500, 81.2700, 'Muttur'],
  ['Kattankudy', 'Batticaloa', 7.6800, 81.7300],
  ['Eravur', 'Batticaloa', 7.7700, 81.6000],
  ['Valaichchenai', 'Batticaloa', 7.9200, 81.5300, 'Valachchenai'],
  ['Kalkudah', 'Batticaloa', 7.9300, 81.5600],
  ['Araipattai', 'Batticaloa', 7.6700, 81.7300],
  ['Kaluwanchikudy', 'Batticaloa', 7.5150, 81.7800],
  ['Vakarai', 'Batticaloa', 8.1300, 81.4300],
  ['Chenkalady', 'Batticaloa', 7.7800, 81.5900],
  ['Kuchchaveli', 'Trincomalee', 8.8200, 81.1000],
  ['China Bay', 'Trincomalee', 8.5600, 81.1800],
  ['Seruwila', 'Trincomalee', 8.3700, 81.3200],
  // Northern
  ['Chavakachcheri', 'Jaffna', 9.6600, 80.1600],
  ['Point Pedro', 'Jaffna', 9.8200, 80.2300],
  ['Puthukkudiyiruppu', 'Mullaitivu', 9.3100, 80.7000, 'Puthukudiyiruppu'],
  ['Valvettithurai', 'Jaffna', 9.8170, 80.1650],
  ['Chunnakam', 'Jaffna', 9.7450, 80.0300],
  ['Nallur', 'Jaffna', 9.6730, 80.0290],
  ['Kopay', 'Jaffna', 9.7000, 80.0700],
  ['Karainagar', 'Jaffna', 9.7400, 79.8900],
  ['Kayts', 'Jaffna', 9.6950, 79.8640],
  ['Vaddukoddai', 'Jaffna', 9.7300, 79.9500],
  ['Tellippalai', 'Jaffna', 9.7850, 80.0400],
  ['Kankesanthurai', 'Jaffna', 9.8160, 80.0400, 'KKS'],
  ['Kodikamam', 'Jaffna', 9.6700, 80.2300],
  ['Paranthan', 'Kilinochchi', 9.4370, 80.4000],
  ['Pallai', 'Kilinochchi', 9.5900, 80.3400],
  ['Kandavalai', 'Kilinochchi', 9.4400, 80.4800],
  ['Pooneryn', 'Kilinochchi', 9.5050, 80.2100],
  ['Pesalai', 'Mannar', 9.0800, 79.8200],
  ['Murunkan', 'Mannar', 8.8300, 80.0400],
  ['Madhu', 'Mannar', 8.8500, 80.2000],
  ['Adampan', 'Mannar', 8.8600, 80.0500],
  ['Thalaimannar', 'Mannar', 9.0950, 79.7300],
  ['Cheddikulam', 'Vavuniya', 8.6640, 80.3140],
  ['Nedunkeni', 'Vavuniya', 8.9500, 80.6000],
  ['Omanthai', 'Vavuniya', 8.8800, 80.5000],
  ['Puliyankulam', 'Vavuniya', 8.9900, 80.5100],
  ['Oddusuddan', 'Mullaitivu', 9.1500, 80.6600],
  ['Mallavi', 'Mullaitivu', 9.1700, 80.3200],
  ['Weli Oya', 'Mullaitivu', 8.9500, 80.7700, 'Welioya'],
]

// Sinhala / colloquial names for districts.
const DISTRICT_ALIASES: Record<string, string[]> = {
  Colombo: ['කොළඹ', 'Kolomba'],
  Gampaha: ['ගම්පහ', 'Gampha', 'Gamapaha'],
  Kalutara: ['කළුතර'],
  Kandy: ['මහනුවර'],
  Matale: ['මාතලේ'],
  'Nuwara Eliya': ['නුවරඑළිය'],
  Galle: ['ගාල්ල', 'Galla'],
  Matara: ['මාතර'],
  Hambantota: ['හම්බන්තොට'],
  Jaffna: ['යාපනය'],
  Vavuniya: ['වවුනියාව'],
  Trincomalee: ['ත්‍රිකුණාමලය', 'Trinco'],
  Batticaloa: ['මඩකලපුව'],
  Ampara: ['අම්පාර'],
  Kurunegala: ['කුරුණෑගල'],
  Puttalam: ['පුත්තලම'],
  Anuradhapura: ['අනුරාධපුර'],
  Polonnaruwa: ['පොළොන්නරුව'],
  Badulla: ['බදුල්ල'],
  Monaragala: ['මොණරාගල'],
  Ratnapura: ['රත්නපුර'],
  Kegalle: ['කෑගල්ල'],
}

const PROVINCE_ALIASES: Record<Province, string[]> = {
  Western: ['Western', 'Western Province', 'Basnahira', 'බස්නාහිර'],
  Central: ['Central', 'Central Province', 'Madhyama', 'මධ්‍යම', 'Hill Country', 'Up Country'],
  Southern: ['Southern', 'Southern Province', 'Dakunu', 'දකුණ', 'Down South', 'South'],
  Northern: ['Northern', 'Northern Province', 'Uthuru', 'North'],
  Eastern: ['Eastern', 'Eastern Province', 'Negenahira', 'East'],
  'North Western': ['North Western', 'North Western Province', 'Wayamba', 'වයඹ', 'NWP'],
  'North Central': ['North Central', 'North Central Province', 'Uthuru Meda', 'උතුරු මැද', 'NCP', 'Rajarata'],
  Uva: ['Uva', 'Uva Province', 'ඌව'],
  Sabaragamuwa: ['Sabaragamuwa', 'Sabaragamuwa Province', 'සබරගමුව'],
}

// Sinhala names for towns, as counsellor briefs write them ("කඩුවෙල ප්‍රදේශයේ
// පදිංචි"). District names are in DISTRICT_ALIASES.
const TOWN_SINHALA: Record<string, string[]> = {
  'Dehiwala-Mount Lavinia': ['දෙහිවල', 'ගල්කිස්ස'], Moratuwa: ['මොරටුව'], Maharagama: ['මහරගම'],
  Kottawa: ['කොට්ටාව'], Homagama: ['හෝමාගම'], Piliyandala: ['පිළියන්දල'], Battaramulla: ['බත්තරමුල්ල'],
  Malabe: ['මාලඹේ'], Kaduwela: ['කඩුවෙල'], Athurugiriya: ['අතුරුගිරිය'], Avissawella: ['අවිස්සාවේල්ල'],
  Padukka: ['පාදුක්ක'], Hanwella: ['හංවැල්ල'], Ratmalana: ['රත්මලාන'], Kolonnawa: ['කොලොන්නාව'],
  Negombo: ['මීගමුව'], 'Ja-Ela': ['ජාඇල'], Wattala: ['වත්තල'], Kelaniya: ['කැලණිය'],
  Kiribathgoda: ['කිරිබත්ගොඩ'], Kadawatha: ['කඩවත'], Ragama: ['රාගම'], Kandana: ['කඳාන'],
  Minuwangoda: ['මිනුවන්ගොඩ'], Nittambuwa: ['නිට්ටඹුව'], Veyangoda: ['වේයන්ගොඩ'], Mirigama: ['මීරිගම'],
  Divulapitiya: ['දිවුලපිටිය'], Ganemulla: ['ගණේමුල්ල'], Yakkala: ['යක්කල'], Seeduwa: ['සීදුව'],
  Panadura: ['පානදුර'], Horana: ['හොරණ'], Beruwala: ['බේරුවල'], Aluthgama: ['අළුත්ගම'],
  Matugama: ['මතුගම'], Bandaragama: ['බණ්ඩාරගම'], Wadduwa: ['වාද්දුව'],
  Ambalangoda: ['අම්බලන්ගොඩ'], Hikkaduwa: ['හික්කඩුව'], Elpitiya: ['ඇල්පිටිය'], Bentota: ['බෙන්තොට'],
  Baddegama: ['බද්දේගම'], Karapitiya: ['කරාපිටිය'], Weligama: ['වැලිගම'], Akuressa: ['අකුරැස්ස'],
  Dikwella: ['දික්වැල්ල'], Deniyaya: ['දෙනියාය'], Tangalle: ['තංගල්ල'], Ambalantota: ['අම්බලන්තොට'],
  Tissamaharama: ['තිස්සමහාරාමය'], Gampola: ['ගම්පොළ'], Peradeniya: ['පේරාදෙණිය'],
  Katugastota: ['කටුගස්තොට'], Akurana: ['අකුරණ'], Dambulla: ['දඹුල්ල'], Hatton: ['හැටන්'],
  Nawalapitiya: ['නාවලපිටිය'], Kuliyapitiya: ['කුලියාපිටිය'], Narammala: ['නාරම්මල'],
  Pannala: ['පන්නල'], Nikaweratiya: ['නිකවැරටිය'], Chilaw: ['හලාවත'], Wennappuwa: ['වෙන්නප්පුව'],
  Marawila: ['මාරවිල'], Kekirawa: ['කැකිරාව'], Hingurakgoda: ['හිඟුරක්ගොඩ'],
  Bandarawela: ['බණ්ඩාරවෙල'], Welimada: ['වැලිමඩ'], Haputale: ['හපුතලේ'],
  Mahiyanganaya: ['මහියංගනය'], Wellawaya: ['වැල්ලවාය'], Balangoda: ['බලංගොඩ'],
  Embilipitiya: ['ඇඹිලිපිටිය'], Pelmadulla: ['පැල්මඩුල්ල'], Eheliyagoda: ['ඇහැලියගොඩ'],
  Kuruwita: ['කුරුවිට'], Mawanella: ['මාවනැල්ල'], Warakapola: ['වරකාපොල'], Rambukkana: ['රඹුක්කන'],
}

// ── Countries: where "abroad" is ────────────────────────────────────────────
// Most customers outside Sri Lanka are in the Gulf, Korea, Japan, Italy, the
// UK, Australia… Two of them are only a match on location when they live in
// the SAME country, so "abroad" has to say which one. A country is read from
// typed words, the website's country column (ISO code or name), a lat/lng box,
// or — last resort, for a customer with no location at all — the phone's
// dialling code.
interface Country {
  name: string
  iso: string
  dial: string | null
  box: [number, number, number, number] | null   // latMin, latMax, lngMin, lngMax
  words: string[]
}

// Small countries first: lat/lng boxes overlap and the first hit wins.
const COUNTRIES: Country[] = [
  { name: 'Bahrain', iso: 'BH', dial: '973', box: [25.5, 26.4, 50.3, 50.9], words: ['bahrain', 'manama'] },
  { name: 'Qatar', iso: 'QA', dial: '974', box: [24.4, 26.3, 50.7, 51.7], words: ['qatar', 'doha'] },
  { name: 'Singapore', iso: 'SG', dial: '65', box: [1.15, 1.48, 103.6, 104.1], words: ['singapore'] },
  { name: 'Hong Kong', iso: 'HK', dial: '852', box: [22.1, 22.6, 113.8, 114.5], words: ['hong kong'] },
  { name: 'Cyprus', iso: 'CY', dial: '357', box: [34.5, 35.8, 32.2, 34.6], words: ['cyprus', 'nicosia', 'limassol', 'larnaca', 'paphos'] },
  { name: 'Lebanon', iso: 'LB', dial: '961', box: [33, 34.7, 35.1, 36.6], words: ['lebanon', 'beirut'] },
  { name: 'Israel', iso: 'IL', dial: '972', box: [29.4, 33.4, 34.2, 35.9], words: ['israel', 'tel aviv', 'jerusalem', 'haifa'] },
  { name: 'Kuwait', iso: 'KW', dial: '965', box: [28.5, 30.2, 46.5, 48.5], words: ['kuwait'] },
  { name: 'Malta', iso: 'MT', dial: '356', box: [35.7, 36.1, 14.1, 14.6], words: ['malta'] },
  { name: 'Maldives', iso: 'MV', dial: '960', box: [-0.8, 7.2, 72.5, 73.8], words: ['maldives'] },
  { name: 'Seychelles', iso: 'SC', dial: '248', box: [-10, -3.5, 46, 56.5], words: ['seychelles'] },
  { name: 'United Arab Emirates', iso: 'AE', dial: '971', box: [22.5, 26.5, 51, 56.5],
    words: ['uae', 'u a e', 'united arab emirates', 'emirates', 'dubai', 'abu dhabi', 'abudhabi', 'sharjah', 'ajman', 'al ain', 'ras al khaimah', 'fujairah'] },
  { name: 'Jordan', iso: 'JO', dial: '962', box: [29.2, 33.4, 34.9, 39.3], words: ['jordan', 'amman'] },
  { name: 'Switzerland', iso: 'CH', dial: '41', box: [45.8, 47.8, 5.9, 10.5], words: ['switzerland', 'zurich', 'geneva'] },
  { name: 'Netherlands', iso: 'NL', dial: '31', box: [50.7, 53.6, 3.3, 7.3], words: ['netherlands', 'holland', 'amsterdam'] },
  { name: 'Belgium', iso: 'BE', dial: '32', box: [49.5, 51.5, 2.5, 6.4], words: ['belgium', 'brussels'] },
  { name: 'Ireland', iso: 'IE', dial: '353', box: [51.4, 55.4, -10.5, -6], words: ['ireland', 'dublin'] },
  { name: 'Austria', iso: 'AT', dial: '43', box: [46.4, 49, 9.5, 17.2], words: ['austria', 'vienna'] },
  { name: 'Oman', iso: 'OM', dial: '968', box: [16.6, 26.5, 51.8, 59.9], words: ['oman', 'muscat', 'salalah'] },
  { name: 'South Korea', iso: 'KR', dial: '82', box: [33, 38.7, 124.5, 131], words: ['korea', 'south korea', 'seoul', 'busan', 'incheon', 'daegu', 'gimhae', 'ansan'] },
  { name: 'Greece', iso: 'GR', dial: '30', box: [34.8, 41.8, 19.3, 28.3], words: ['greece', 'athens'] },
  { name: 'Portugal', iso: 'PT', dial: '351', box: [36.9, 42.2, -9.6, -6.2], words: ['portugal', 'lisbon'] },
  { name: 'Italy', iso: 'IT', dial: '39', box: [36.6, 47.1, 6.6, 18.6],
    words: ['italy', 'italia', 'milan', 'milano', 'rome', 'roma', 'napoli', 'naples', 'florence', 'firenze', 'bologna', 'genoa', 'genova', 'palermo', 'verona', 'torino', 'turin', 'catania', 'messina'] },
  { name: 'United Kingdom', iso: 'GB', dial: '44', box: [49.8, 60.9, -8.7, 1.8],
    words: ['uk', 'u k', 'united kingdom', 'england', 'britain', 'great britain', 'scotland', 'wales', 'london', 'manchester', 'birmingham', 'leicester', 'leeds'] },
  { name: 'Germany', iso: 'DE', dial: '49', box: [47.2, 55.1, 5.8, 15.1], words: ['germany', 'berlin', 'munich', 'frankfurt', 'hamburg'] },
  { name: 'France', iso: 'FR', dial: '33', box: [41.3, 51.1, -5.2, 9.6], words: ['france', 'paris'] },
  { name: 'Spain', iso: 'ES', dial: '34', box: [36, 43.8, -9.3, 3.3], words: ['spain', 'madrid', 'barcelona'] },
  { name: 'Romania', iso: 'RO', dial: '40', box: [43.6, 48.3, 20.2, 29.7], words: ['romania', 'bucharest'] },
  { name: 'Poland', iso: 'PL', dial: '48', box: [49, 54.9, 14.1, 24.2], words: ['poland', 'warsaw'] },
  { name: 'Belarus', iso: 'BY', dial: '375', box: [51.2, 56.2, 23.2, 32.8], words: ['belarus', 'minsk'] },
  { name: 'Norway', iso: 'NO', dial: '47', box: [57.9, 71.2, 4.6, 31.1], words: ['norway', 'oslo'] },
  { name: 'Sweden', iso: 'SE', dial: '46', box: [55.3, 69.1, 11, 24.2], words: ['sweden', 'stockholm'] },
  { name: 'Denmark', iso: 'DK', dial: '45', box: [54.5, 57.8, 8, 12.7], words: ['denmark', 'copenhagen'] },
  { name: 'Finland', iso: 'FI', dial: '358', box: [59.8, 70.1, 20.5, 31.6], words: ['finland', 'helsinki'] },
  { name: 'Saudi Arabia', iso: 'SA', dial: '966', box: [16, 32.5, 34.5, 55.7], words: ['saudi', 'saudi arabia', 'ksa', 'riyadh', 'jeddah', 'dammam', 'makkah', 'mecca', 'medina'] },
  { name: 'Japan', iso: 'JP', dial: '81', box: [24, 45.6, 122.9, 146], words: ['japan', 'tokyo', 'osaka', 'nagoya', 'yokohama', 'saitama', 'chiba'] },
  { name: 'Malaysia', iso: 'MY', dial: '60', box: [0.8, 7.4, 99.6, 119.3], words: ['malaysia', 'kuala lumpur'] },
  { name: 'Thailand', iso: 'TH', dial: '66', box: [5.6, 20.5, 97.3, 105.7], words: ['thailand', 'bangkok'] },
  { name: 'New Zealand', iso: 'NZ', dial: '64', box: [-47.5, -34, 166, 179], words: ['new zealand', 'nz', 'auckland', 'wellington', 'christchurch'] },
  { name: 'Australia', iso: 'AU', dial: '61', box: [-44, -10, 112, 154], words: ['australia', 'melbourne', 'sydney', 'perth', 'brisbane', 'adelaide', 'canberra'] },
  { name: 'India', iso: 'IN', dial: '91', box: [6.5, 35.7, 68, 97.5], words: ['india', 'chennai', 'bangalore', 'bengaluru', 'mumbai', 'delhi', 'kerala', 'tamil nadu'] },
  { name: 'China', iso: 'CN', dial: '86', box: [18, 53.6, 73.5, 134.8], words: ['china', 'beijing', 'shanghai'] },
  { name: 'Russia', iso: 'RU', dial: null, box: null, words: ['russia', 'moscow'] },
  { name: 'Canada', iso: 'CA', dial: null, box: [41.7, 83, -141, -52.6], words: ['canada', 'toronto', 'montreal', 'vancouver', 'calgary', 'ottawa'] },
  { name: 'USA', iso: 'US', dial: null, box: [24.5, 49.4, -125, -66.9], words: ['usa', 'u s a', 'united states', 'america', 'new york', 'california', 'texas', 'los angeles', 'new jersey'] },
]

const COUNTRY_BY_ISO = new Map(COUNTRIES.map(c => [c.iso, c]))
const COUNTRY_BY_NAME = new Map(COUNTRIES.map(c => [c.name.toLowerCase(), c]))

// ── Normalising names so spellings meet ─────────────────────────────────────
// "Rathnapura" / "Ratnapura", "Avissawelle" / "Awissawella", "Kolombo" /
// "Colombo", "Ja Ela" / "Ja-Ela" all collapse to the same key.
export function placeKey(s: string): string {
  let k = (s || '').toLowerCase().normalize('NFC')
  // Latin text: fold the usual Sri Lankan transliteration variants.
  k = k.replace(/[^a-z඀-෿]/g, '')
  if (/[a-z]/.test(k)) {
    k = k
      .replace(/th/g, 't').replace(/dh/g, 'd').replace(/ph/g, 'p').replace(/bh/g, 'b')
      .replace(/w/g, 'v').replace(/c/g, 'k').replace(/y/g, 'i')
      .replace(/(.)\1+/g, '$1')           // double letters
      .replace(/[aeiou]+$/, '')           // trailing vowel: -wela / -welle / -wella
  }
  return k
}

function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]
}

export type PlaceKind = 'town' | 'district' | 'province'
export interface Place {
  kind: PlaceKind
  name: string            // canonical: "Kottawa", "Colombo", "Western"
  district: string | null // null for a province
  province: Province
  lat: number
  lng: number
}

const DISTRICT_BY_NAME = new Map(DISTRICTS.map(d => [d.name, d]))

type Entry = { key: string; place: Place }
const ENTRIES: Entry[] = []
function add(names: string[], place: Place) {
  for (const n of names) {
    const key = placeKey(n)
    if (key) ENTRIES.push({ key, place })
  }
}
for (const d of DISTRICTS) {
  add([d.name, d.name + ' District', ...(DISTRICT_ALIASES[d.name] ?? [])],
    { kind: 'district', name: d.name, district: d.name, province: d.province, lat: d.lat, lng: d.lng })
}
for (const [name, district, lat, lng, ...aliases] of TOWNS) {
  const d = DISTRICT_BY_NAME.get(district)!
  add([name, ...aliases, ...(TOWN_SINHALA[name] ?? [])], { kind: 'town', name, district, province: d.province, lat, lng })
}
const PROVINCE_CENTRE = (p: Province) => {
  const ds = DISTRICTS.filter(d => d.province === p)
  return { lat: ds.reduce((s, d) => s + d.lat, 0) / ds.length, lng: ds.reduce((s, d) => s + d.lng, 0) / ds.length }
}
for (const p of Object.keys(PROVINCE_ALIASES) as Province[]) {
  add(PROVINCE_ALIASES[p], { kind: 'province', name: p, district: null, province: p, ...PROVINCE_CENTRE(p) })
}

const EXACT = new Map<string, Place>()
// Districts were added first, so "Kandy" resolves to the district, not the
// "Mahanuwara" town alias; a town only wins a key nobody else claimed.
for (const e of ENTRIES) if (!EXACT.has(e.key)) EXACT.set(e.key, e.place)

function lookup(fragment: string): Place | null {
  const key = placeKey(fragment)
  if (key.length < 2) return null
  const hit = EXACT.get(key)
  if (hit) return hit
  if (key.length < 5) return null
  const maxDist = key.length >= 8 ? 2 : 1
  let best: Place | null = null
  let bestD = maxDist + 1
  for (const e of ENTRIES) {
    const d = lev(key, e.key)
    if (d < bestD) { bestD = d; best = e.place }
  }
  return best
}

const SPECIFICITY: Record<PlaceKind, number> = { town: 3, district: 2, province: 1 }
const NOISE = /\b(district|city|town|province|sri\s*lanka|srilanka|lk|area|near|road|rd|junction)\b/gi

/**
 * Best reading of a free-text location. Tries the whole string, then each
 * comma/slash part, then single words and word pairs, and keeps the most
 * specific hit ("District -Matara, City-Weligama" → Weligama, a Matara town).
 */
// The ranking pass resolves thousands of profile cities, mostly the same few
// hundred spellings — remember each answer (the fuzzy fallback is the slow part).
const RESOLVED = new Map<string, Place | null>()
export function resolvePlace(text: string | null | undefined): Place | null {
  const raw = (text || '').trim()
  if (!raw) return null
  if (RESOLVED.has(raw)) return RESOLVED.get(raw)!
  const place = resolveUncached(raw)
  if (RESOLVED.size > 20_000) RESOLVED.clear()
  RESOLVED.set(raw, place)
  return place
}

function resolveUncached(raw: string): Place | null {
  const whole = lookup(raw)
  if (whole) return whole

  const candidates: string[] = []
  for (const part of raw.split(/[,/|.()]+/)) {
    const clean = part.replace(NOISE, ' ').replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!clean) continue
    candidates.push(clean)
    const words = clean.split(' ')
    for (let i = 0; i < words.length; i++) {
      candidates.push(words[i])
      if (i + 1 < words.length) candidates.push(words[i] + ' ' + words[i + 1])
    }
  }
  let best: Place | null = null
  for (const c of candidates) {
    const p = lookup(c)
    if (p && (!best || SPECIFICITY[p.kind] > SPECIFICITY[best.kind])) best = p
  }
  return best
}

/** The country a piece of text names: "Dubai", "Abu Dhabi, UAE", "AE", "Italy". */
export function countryOf(text: string | null | undefined): string | null {
  const raw = (text || '').trim()
  if (!raw) return null
  if (/^[A-Za-z]{2}$/.test(raw)) {
    const iso = COUNTRY_BY_ISO.get(raw.toUpperCase())
    if (iso) return iso.name
  }
  const byName = COUNTRY_BY_NAME.get(raw.toLowerCase())
  if (byName) return byName.name
  const t = ` ${raw.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ')} `
  return COUNTRIES.find(c => c.words.some(w => t.includes(` ${w} `)))?.name ?? null
}

export function looksAbroad(text: string | null | undefined): boolean {
  return countryOf(text) != null
}

/** "LK", "Sri Lanka", "srilanka" — the website's country column for home. */
export function isSriLankaCountry(text: string | null | undefined): boolean {
  return /^\s*(lk|lka|sri\s*lanka)\s*$/i.test(text || '')
}

export function countryOfPoint(lat: number, lng: number): string | null {
  if (inSriLanka(lat, lng)) return null
  return COUNTRIES.find(c => c.box && lat >= c.box[0] && lat <= c.box[1] && lng >= c.box[2] && lng <= c.box[3])?.name ?? null
}

/**
 * Country from an international phone number (971… → UAE). Sri Lankan
 * numbers (94…, 07…, 7XXXXXXXX) give null. Only a hint — a family member's
 * number can be anywhere — so it is used only when nothing else says where
 * the customer lives.
 */
export function countryOfPhone(phone: string | null | undefined): string | null {
  let d = (phone || '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length < 10 || d.startsWith('94') || d.startsWith('0')) return null
  for (const len of [3, 2]) {
    const hit = COUNTRIES.find(c => c.dial && c.dial.length === len && d.startsWith(c.dial))
    if (hit) return hit.name
  }
  return null
}

export function inSriLanka(lat: number, lng: number): boolean {
  return lat > 5.7 && lat < 10.0 && lng > 79.4 && lng < 82.1
}

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Every named point, for "which district is this lat/lng in?" — nearest
// named place wins. Approximate on district borders, which is fine for a
// "same district" bonus on top of the distance score.
// Squared flat-earth distance is plenty for "which is nearest" inside one
// small island, and ~20× cheaper than haversine across every profile.
const POINTS = ENTRIES.filter(e => e.place.kind !== 'province').map(e => e.place)
const LNG_SCALE = Math.cos((7.8 * Math.PI) / 180) ** 2
export function districtOfPoint(lat: number, lng: number): District | null {
  if (!inSriLanka(lat, lng)) return null
  let best: Place | null = null
  let bestD = Infinity
  for (const p of POINTS) {
    const dLat = p.lat - lat, dLng = p.lng - lng
    const d = dLat * dLat + dLng * dLng * LNG_SCALE
    if (d < bestD) { bestD = d; best = p }
  }
  return best?.district ? DISTRICT_BY_NAME.get(best.district) ?? null : null
}

export function districtsIn(province: Province): District[] {
  return DISTRICTS.filter(d => d.province === province)
}

/** Names for the location input's suggestion list. */
export const PLACE_SUGGESTIONS: string[] = [
  ...(Object.keys(PROVINCE_ALIASES) as Province[]).map(p => `${p} Province`),
  ...DISTRICTS.map(d => `${d.name} District`),
  ...TOWNS.map(t => t[0]),
  ...COUNTRIES.map(c => c.name),
]
