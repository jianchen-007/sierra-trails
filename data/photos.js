// Geotagged photos shown as thumbnails on the map (GPS from EXIF)
const PHOTOS = [
  { f: 'IMG_1440', lat: 38.875339, lon: -120.097267, date: '2026-07-08',
    cap: 'Glen Alpine Springs entrance gate' },
  { f: 'IMG_1441', lat: 38.875317, lon: -120.097244, date: '2026-07-08',
    cap: 'Glen Alpine Springs — history sign' },
  { f: 'IMG_1442', lat: 38.874150, lon: -120.102378, date: '2026-07-08',
    cap: 'Grass Lk / Mt. Tallac junction post' },
  { f: 'IMG_1444', lat: 38.872733, lon: -120.104125, date: '2026-07-08',
    cap: 'Pond along the Grass Lake Trail' },
  { f: 'IMG_1447', lat: 38.875450, lon: -120.097017, date: '2026-07-08',
    cap: 'Giant Jenga at Glen Alpine Springs' },
];
const PHOTO_FILES = PHOTOS.flatMap(p => [`photos/thumb/${p.f}.jpg`, `photos/full/${p.f}.jpg`]);
