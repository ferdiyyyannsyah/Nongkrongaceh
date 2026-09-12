// Netlify Function:
// /.netlify/functions/places
//
// Server-side proxy untuk OpenStreetMap Overpass.
// Frontend tidak lagi menghubungi Overpass secara langsung.

const ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

const QUERIES = [
  `
  [out:json][timeout:60];
  area["ISO3166-2"="ID-AC"]->.aceh;
  (
    nwr["amenity"="cafe"](area.aceh);
    nwr["amenity"="coffee_shop"](area.aceh);
    nwr["shop"="coffee"](area.aceh);
    nwr["cuisine"="coffee"](area.aceh);
    nwr["cuisine"="coffee_shop"](area.aceh);
    nwr["name"~"coffee|kopi|warkop|warung kopi|kedai kopi",i](area.aceh);
  );
  out center tags;
  `,

  `
  [out:json][timeout:60];
  area["ISO3166-2"="ID-AC"]->.aceh;
  (
    nwr["amenity"="restaurant"](area.aceh);
    nwr["amenity"="fast_food"](area.aceh);
  );
  out center tags;
  `,

  `
  [out:json][timeout:60];
  area["ISO3166-2"="ID-AC"]->.aceh;
  (
    nwr["amenity"="bar"](area.aceh);
    nwr["amenity"="pub"](area.aceh);
  );
  out center tags;
  `,

  `
  [out:json][timeout:60];
  area["ISO3166-2"="ID-AC"]->.aceh;
  (
    nwr["tourism"="attraction"](area.aceh);
    nwr["tourism"="viewpoint"](area.aceh);
    nwr["tourism"="theme_park"](area.aceh);
    nwr["tourism"="zoo"](area.aceh);
  );
  out center tags;
  `
];

function getCategory(tags = {}) {
  const name = String(
    tags.name ||
    tags["name:id"] ||
    tags["name:en"] ||
    ""
  ).toLowerCase();

  if (
    tags.amenity === "coffee_shop" ||
    tags.shop === "coffee" ||
    tags.cuisine === "coffee" ||
    tags.cuisine === "coffee_shop" ||
    name.includes("coffee") ||
    name.includes("kopi") ||
    name.includes("warkop") ||
    name.includes("warung kopi") ||
    name.includes("kedai kopi")
  ) {
    return "coffee";
  }

  if (tags.amenity === "cafe") return "cafe";
  if (tags.amenity === "restaurant") return "restaurant";
  if (tags.amenity === "fast_food") return "fast_food";

  if (
    tags.amenity === "bar" ||
    tags.amenity === "pub"
  ) {
    return "bar";
  }

  if (
    tags.tourism === "attraction" ||
    tags.tourism === "viewpoint" ||
    tags.tourism === "theme_park" ||
    tags.tourism === "zoo"
  ) {
    return "tourism";
  }

  return null;
}

function getCoordinates(element) {
  if (
    typeof element.lat === "number" &&
    typeof element.lon === "number"
  ) {
    return {
      lat: element.lat,
      lon: element.lon
    };
  }

  if (
    element.center &&
    typeof element.center.lat === "number" &&
    typeof element.center.lon === "number"
  ) {
    return {
      lat: element.center.lat,
      lon: element.center.lon
    };
  }

  return null;
}

function getAddress(tags = {}) {
  const parts = [
    tags["addr:street"],
    tags["addr:suburb"],
    tags["addr:city"],
    tags["addr:town"],
    tags["addr:district"],
    tags["addr:postcode"]
  ].filter(Boolean);

  return (
    parts.join(", ") ||
    tags["addr:full"] ||
    tags["addr:place"] ||
    "Aceh"
  );
}

async function queryOverpass(query) {
  let lastError = null;

  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent":
            "NangkringAceh/1.0"
        },
        body:
          "data=" +
          encodeURIComponent(query)
      });

      if (!response.ok) {
        throw new Error(
          `${endpoint} HTTP ${response.status}`
        );
      }

      const data = await response.json();

      if (!data || !Array.isArray(data.elements)) {
        throw new Error(
          "Response Overpass tidak valid"
        );
      }

      return data.elements;

    } catch (error) {
      console.error(
        "Overpass gagal:",
        endpoint,
        error
      );
      lastError = error;
    }
  }

  throw lastError ||
    new Error("Semua server Overpass gagal");
}

async function buildPlaces() {
  const elements = [];

  for (const query of QUERIES) {
    try {
      const result =
        await queryOverpass(query);

      elements.push(...result);
    } catch (error) {
      console.error(
        "Satu kategori gagal:",
        error
      );
    }
  }

  const unique = new Map();

  for (const element of elements) {
    const tags = element.tags || {};
    const coords = getCoordinates(element);
    const category = getCategory(tags);

    if (!coords || !category) continue;

    const name =
      tags.name ||
      tags["name:id"] ||
      tags["name:en"];

    if (!name) continue;

    const key =
      String(name).trim().toLowerCase() +
      "|" +
      coords.lat.toFixed(5) +
      "|" +
      coords.lon.toFixed(5);

    if (unique.has(key)) continue;

    unique.set(key, {
      id: `${element.type}/${element.id}`,
      name: String(name),
      lat: coords.lat,
      lon: coords.lon,
      category,
      address: getAddress(tags),
      city:
        tags["addr:city"] ||
        tags["addr:town"] ||
        tags["addr:district"] ||
        "",
      phone:
        tags.phone ||
        tags["contact:phone"] ||
        "",
      website:
        tags.website ||
        tags["contact:website"] ||
        ""
    });
  }

  return Array.from(unique.values())
    .sort((a, b) =>
      a.name.localeCompare(b.name, "id")
    );
}

exports.handler = async function () {
  try {
    const places = await buildPlaces();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control":
          "public, max-age=600, s-maxage=600"
      },
      body: JSON.stringify({
        success: true,
        count: places.length,
        updatedAt: new Date().toISOString(),
        places
      })
    };

  } catch (error) {
    console.error(error);

    return {
      statusCode: 502,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      },
      body: JSON.stringify({
        success: false,
        error: error.message ||
          "Gagal mengambil data OpenStreetMap"
      })
    };
  }
};

