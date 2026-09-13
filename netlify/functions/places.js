/*
=========================================================
 NANGKRINGACEH V3
 NETLIFY FUNCTION
=========================================================

Frontend:
    /.netlify/functions/places

Function ini menjadi perantara antara website
dengan OpenStreetMap Overpass API.

Mode:
    nearby
    aceh
=========================================================
*/


/* ======================================================
   OVERPASS SERVERS
====================================================== */

const OVERPASS_SERVERS = [

    "https://overpass-api.de/api/interpreter",

    "https://overpass.kumi.systems/api/interpreter",

    "https://overpass.private.coffee/api/interpreter"

];


/* ======================================================
   KONFIGURASI
====================================================== */

const MAX_NEARBY_RADIUS_KM = 10;


/*
   Query kategori tempat nongkrong.

   cafe
   restaurant
   fast_food
   coffee_shop
   shop=coffee
*/

const PLACE_QUERY = `
    ["amenity"~"^(cafe|restaurant|fast_food|coffee_shop)$"]
`;

const COFFEE_QUERY = `
    ["shop"="coffee"]
`;


/* ======================================================
   MAIN HANDLER
====================================================== */

exports.handler = async function(event) {

    try {

        const params =
            event.queryStringParameters || {};


        const mode =
            params.mode || "nearby";


        /* ==============================================
           MODE NEARBY
        ============================================== */

        if (
            mode === "nearby"
        ) {

            return await handleNearby(
                params
            );

        }


        /* ==============================================
           MODE ACEH
        ============================================== */

        if (
            mode === "aceh"
        ) {

            return await handleAceh();

        }


        return jsonResponse(
            400,
            {
                error:
                    "Mode tidak valid."
            }
        );

    }

    catch (error) {

        console.error(
            "places function error:",
            error
        );


        return jsonResponse(
            500,
            {
                error:
                    "Gagal mengambil data tempat.",
                detail:
                    error.message
            }
        );

    }

};


/* ======================================================
   NEARBY
====================================================== */

async function handleNearby(
    params
) {

    const lat =
        Number(
            params.lat
        );


    const lon =
        Number(
            params.lon
        );


    let radius =
        Number(
            params.radius || 1
        );


    /*
       Validasi koordinat
    */

    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon)
    ) {

        return jsonResponse(
            400,
            {
                error:
                    "Koordinat GPS tidak valid."
            }
        );

    }


    /*
       Batasi radius.
    */

    radius =
        Math.max(
            0.5,
            Math.min(
                radius,
                MAX_NEARBY_RADIUS_KM
            )
        );


    const radiusMeters =
        Math.round(
            radius * 1000
        );


    /*
       Query Overpass.
    */

    const query = `

[out:json][timeout:45];

(
    nwr(
        around:${radiusMeters},
        ${lat},
        ${lon}
    )
    ${PLACE_QUERY};

    nwr(
        around:${radiusMeters},
        ${lat},
        ${lon}
    )
    ${COFFEE_QUERY};
);

out center tags;

`;


    const data =
        await fetchOverpass(
            query
        );


    const elements =
        cleanElements(
            data.elements || []
        );


    return jsonResponse(
        200,
        {
            mode:
                "nearby",

            radius:
                radius,

            count:
                elements.length,

            elements:
                elements
        }
    );

}


/* ======================================================
   SELURUH ACEH
====================================================== */

async function handleAceh() {

    /*
       Cari boundary Provinsi Aceh
       menggunakan ISO3166-2 ID-AC.
    */

    const query = `

[out:json][timeout:180];

area
    ["boundary"="administrative"]
    ["ISO3166-2"="ID-AC"]
    ->.aceh;

(
    nwr(area.aceh)
        ${PLACE_QUERY};

    nwr(area.aceh)
        ${COFFEE_QUERY};
);

out center tags;

`;


    try {

        const data =
            await fetchOverpass(
                query
            );


        const elements =
            cleanElements(
                data.elements || []
            );


        return jsonResponse(
            200,
            {

                mode:
                    "aceh",

                count:
                    elements.length,

                elements:
                    elements

            }
        );

    }

    catch (error) {

        console.warn(
            "Area Aceh query gagal:",
            error.message
        );


        /*
           FALLBACK BOUNDING BOX ACEH.

           Selatan: 2.5
           Barat:   94.5
           Utara:   6.2
           Timur:   98.7
        */

        const fallbackQuery = `

[out:json][timeout:180];

(
    nwr
        (2.5,94.5,6.2,98.7)
        ${PLACE_QUERY};

    nwr
        (2.5,94.5,6.2,98.7)
        ${COFFEE_QUERY};
);

out center tags;

`;


        const fallbackData =
            await fetchOverpass(
                fallbackQuery
            );


        const elements =
            cleanElements(
                fallbackData.elements || []
            );


        return jsonResponse(
            200,
            {

                mode:
                    "aceh-fallback",

                count:
                    elements.length,

                elements:
                    elements

            }
        );

    }

}


/* ======================================================
   FETCH OVERPASS
====================================================== */

async function fetchOverpass(
    query
) {

    let lastError =
        null;


    for (
        const server of OVERPASS_SERVERS
    ) {

        try {

            console.log(
                "Menghubungi Overpass:",
                server
            );


            const controller =
                new AbortController();


            const timeout =
                setTimeout(
                    function() {

                        controller.abort();

                    },
                    190000
                );


            const response =
                await fetch(
                    server,
                    {

                        method:
                            "POST",

                        headers:
                            {
                                "Content-Type":
                                    "text/plain;charset=UTF-8",

                                "User-Agent":
                                    "NangkringAceh/3.0"
                            },

                        body:
                            query,

                        signal:
                            controller.signal

                    }
                );


            clearTimeout(
                timeout
            );


            if (
                !response.ok
            ) {

                throw new Error(
                    `Overpass HTTP ${response.status}`
                );

            }


            const data =
                await response.json();


            if (
                !data ||
                !Array.isArray(
                    data.elements
                )
            ) {

                throw new Error(
                    "Data Overpass tidak valid."
                );

            }


            return data;

        }

        catch (error) {

            console.warn(
                "Overpass gagal:",
                server,
                error.message
            );


            lastError =
                error;

        }

    }


    throw (
        lastError ||
        new Error(
            "Semua server Overpass gagal."
        )
    );

}


/* ======================================================
   CLEAN ELEMENTS
====================================================== */

function cleanElements(
    elements
) {

    const result = [];

    const seen = new Set();


    for (
        const element of elements
    ) {

        if (
            !element
        ) {

            continue;

        }


        const key =
            `${element.type}_${element.id}`;


        if (
            seen.has(key)
        ) {

            continue;

        }


        seen.add(
            key
        );


        /*
           Pastikan punya koordinat.

           Node:
               lat / lon

           Way / Relation:
               center.lat / center.lon
        */

        const lat =
            Number(
                element.lat ??
                element.center?.lat
            );


        const lon =
            Number(
                element.lon ??
                element.center?.lon
            );


        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lon)
        ) {

            continue;

        }


        /*
           Hanya simpan data yang
           punya tags.
        */

        if (
            !element.tags
        ) {

            continue;

        }


        /*
           Tambahkan koordinat standar
           supaya frontend lebih mudah.
        */

        result.push({

            type:
                element.type,

            id:
                element.id,

            lat:
                lat,

            lon:
                lon,

            center:
                element.center,

            tags:
                element.tags

        });

    }


    return result;

}


/* ======================================================
   JSON RESPONSE
====================================================== */

function jsonResponse(
    statusCode,
    body
) {

    return {

        statusCode:
            statusCode,

        headers:
            {

                "Content-Type":
                    "application/json; charset=utf-8",

                "Cache-Control":
                    "public, max-age=300, s-maxage=300",

                "Access-Control-Allow-Origin":
                    "*"

            },

        body:
            JSON.stringify(
                body
            )

    };

                }
