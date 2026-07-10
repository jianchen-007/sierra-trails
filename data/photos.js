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
  { f: 'IMG_1478', lat: 38.874353, lon: -120.070106, date: '2026-07-09',
    cap: 'Fallen Leaf Lake & Tahoe panorama from the Lily Lake Trail' },
  { f: 'IMG_1482', lat: 38.874061, lon: -120.077514, date: '2026-07-09',
    cap: 'Talus crossing on the Lily Lake Trail below Angora ridge' },
  { f: 'IMG_1483', lat: 38.874472, lon: -120.078619, date: '2026-07-09',
    cap: 'Lily Lake Trail junction — ¼ mi to the Glen Alpine parking lot' },
];
const PHOTO_FILES = PHOTOS.flatMap(p => [`photos/thumb/${p.f}.jpg`, `photos/full/${p.f}.jpg`]);
