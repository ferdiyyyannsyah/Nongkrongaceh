/*
=========================================================
NANGKRINGACEH V3
NETLIFY FUNCTION

Fungsi:
- Proxy ke Overpass
- Cache response
- Pencarian sekitar
- Pencarian seluruh Aceh
=========================================================
*/


const OVERPASS_SERVERS = [

    "https://overpass-api.de/api/interpreter",

    "https://overpass.kumi.systems/api/interpreter",

    "https://overpass.private.coffee/api/interpreter"

];


/*
   Cache di memory server.

   Catatan:
   Netlify Function bersifat serverless,
   sehingga memory cache tidak permanen.

   Tetapi selama instance function masih hidup,
   request berikutnya dapat menggunakan cache.
*/

const cache = new Map();


const ACEH_BBOX =
    "2.5,94.5,6.2,98.7";


/* =====================================================
   MAIN
===================================================== */

exports.handler =
async function(event){

    try{

        const params =
            event.queryStringParameters || {};


        const mode =
            params.mode || "aceh";


        /*
           CACHE KEY
        */

        let cacheKey;


        if(
            mode === "nearby"
        ){

            const lat =
                Number(params.lat);

            const lon =
                Number(params.lon);

            const radius =
                Number(params.radius || 10);


            if(
                !Number.isFinite(lat) ||
                !Number.isFinite(lon)
            ){

                return json(
                    {
                        error:
                        "Koordinat tidak valid"
                    },
                    400
                );

            }


            /*
               Bulatkan koordinat supaya
               request yang berdekatan bisa
               menggunakan cache yang sama.
            */

            const roundedLat =
                Math.round(
                    lat * 100
                ) / 100;


            const roundedLon =
                Math.round(
                    lon * 100
                ) / 100;


            cacheKey =
                `nearby-${roundedLat}-${roundedLon}-${radius}`;

        }

        else{

            cacheKey =
                "aceh-all";

        }


        /*
           CACHE
        */

        const cached =
            cache.get(
                cacheKey
            );


        if(
            cached &&
            cached.expires >
            Date.now()
        ){

            return json(
                {
                    places:
                    cached.places,

                    cached:true,

                    updated:
                    cached.updated
                },
                200,
                {
                    "Cache-Control":
                    "public, max-age=1800"
                }
            );

        }


        /*
           QUERY
        */

        let query;


        if(
            mode === "nearby"
        ){

            const lat =
                Number(params.lat);

            const lon =
                Number(params.lon);

            const radius =
                Number(
                    params.radius || 10
                );


            query =
            nearbyQuery(
                lat,
                lon,
                radius
            );

        }

        else{

            query =
            acehQuery();

        }


        /*
           AMBIL DATA
        */

        const data =
            await fetchOverpass(
                query
            );


        /*
           NORMALIZE
        */

        const places =
            normalize(
                data.elements || []
            );


        /*
           SIMPAN CACHE
        */

        const cacheTime =
            mode === "aceh"
            ?
            1000 * 60 * 60 * 6
            :
            1000 * 60 * 30;


        cache.set(
            cacheKey,
            {

                places:

                places,

                expires:

                Date.now() +
                cacheTime,

                updated:

                new Date()
                .toISOString()

            }
        );


        /*
           RESPONSE
        */

        return json(
            {

                places:

                places,

                cached:false,

                updated:

                new Date()
                .toISOString()

            },

            200,

            {

                "Cache-Control":
                mode === "aceh"
                ?
                "public, max-age=3600, s-maxage=21600"
                :
                "public, max-age=300, s-maxage=1800"

            }

        );

    }

    catch(error){

        console.error(
            error
        );


        return json(
            {
                error:
                "Gagal mengambil data tempat",
                message:
                error.message
            },
            500
        );

    }

};


/* =====================================================
   ACEH QUERY
===================================================== */

function acehQuery(){

    return `

[out:json][timeout:180];

(
    nwr(${ACEH_BBOX})["amenity"="cafe"];

    nwr(${ACEH_BBOX})["amenity"="restaurant"];

    nwr(${ACEH_BBOX})["amenity"="fast_food"];

    nwr(${ACEH_BBOX})["amenity"="coffee_shop"];

    nwr(${ACEH_BBOX})["shop"="coffee"];
);

out center tags;

`;

}


/* =====================================================
   NEARBY QUERY
===================================================== */

function nearbyQuery(
    lat,
    lon,
    radiusKm
){

    const meters =
        Math.min(
            Math.max(
                radiusKm * 1000,
                500
            ),
            50000
        );


    return `

[out:json][timeout:60];

(
    nwr(
        around:${meters},
        ${lat},
        ${lon}
    )["amenity"="cafe"];

    nwr(
        around:${meters},
        ${lat},
        ${lon}
    )["amenity"="restaurant"];

    nwr(
        around:${meters},
        ${lat},
        ${lon}
    )["amenity"="fast_food"];

    nwr(
        around:${meters},
        ${lat},
        ${lon}
    )["amenity"="coffee_shop"];

    nwr(
        around:${meters},
        ${lat},
        ${lon}
    )["shop"="coffee"];
);

out center tags;

`;

}


/* =====================================================
   OVERPASS
===================================================== */

async function fetchOverpass(
    query
){

    let lastError;


    for(
        const server
        of OVERPASS_SERVERS
    ){

        try{

            const controller =
                new AbortController();


            const timeout =
                setTimeout(
                    () =>
                    controller.abort(),
                    190000
                );


            const response =
                await fetch(
                    server,
                    {

                        method:"POST",

                        headers:{
                            "Content-Type":
                            "text/plain;charset=UTF-8"
                        },

                        body:query,

                        signal:
                        controller.signal

                    }
                );


            clearTimeout(
                timeout
            );


            if(
                !response.ok
            ){

                throw new Error(
                    `Overpass HTTP ${response.status}`
                );

            }


            return await response.json();

        }

        catch(error){

            console.error(
                "Overpass failed:",
                server,
                error
            );


            lastError =
                error;

        }

    }


    throw(
        lastError ||
        new Error(
            "Semua server Overpass gagal"
        )
    );

}


/* =====================================================
   NORMALIZE
===================================================== */

function normalize(
    elements
){

    const result=[];

    const seen=
        new Set();


    for(
        const element
        of elements
    ){

        const id=
            `${element.type}-${element.id}`;


        if(
            seen.has(id)
        )
            continue;


        seen.add(id);


        const tags=
            element.tags || {};


        const lat=
            Number(
                element.lat ??
                element.center?.lat
            );


        const lon=
            Number(
                element.lon ??
                element.center?.lon
            );


        if(
            !Number.isFinite(lat) ||
            !Number.isFinite(lon)
        ){

            continue;

        }


        /*
           Tempat tanpa nama masih disimpan,
           tetapi diberikan nama yang jelas.
        */

        const name=
            tags.name ||
            tags["name:id"] ||
            tags["name:en"] ||
            "Tempat tanpa nama";


        result.push({

            id:id,

            name:
            clean(name),

            category:
            getCategory(tags),

            address:
            getAddress(tags),

            lat:lat,

            lon:lon

        });

    }


    /*
       Hapus duplikasi berdasarkan
       nama + koordinat yang sangat dekat.
    */

    return deduplicate(
        result
    );

}


/* =====================================================
   CATEGORY
===================================================== */

function getCategory(
    tags
){

    if(
        tags.amenity ===
        "coffee_shop"
    )
        return "coffee";


    if(
        tags.shop ===
        "coffee"
    )
        return "coffee";


    if(
        tags.amenity ===
        "cafe"
    )
        return "cafe";


    if(
        tags.amenity ===
        "restaurant"
    )
        return "restaurant";


    if(
        tags.amenity ===
        "fast_food"
    )
        return "fast_food";


    return "other";

}


/* =====================================================
   ADDRESS
===================================================== */

function getAddress(
    tags
){

    const fields=[

        "addr:housenumber",

        "addr:street",

        "addr:place",

        "addr:suburb",

        "addr:village",

        "addr:town",

        "addr:city",

        "addr:county",

        "addr:state"

    ];


    const result=[];


    for(
        const field
        of fields
    ){

        const value=
            tags[field];


        if(
            value &&
            !result.includes(value)
        ){

            result.push(value);

        }

    }


    return result.length
        ?
        result.join(", ")
        :
        "Alamat belum tersedia";

}


/* =====================================================
   DEDUPLICATE
===================================================== */

function deduplicate(
    places
){

    const result=[];

    const seen=
        new Map();


    for(
        const place
        of places
    ){

        const key=
            (
                place.name
                .toLowerCase()
                .replace(
                    /\s+/g,
                    " "
                )
                .trim()
            );


        if(
            !seen.has(key)
        ){

            seen.set(
                key,
                place
            );

            result.push(
                place
            );

            continue;

        }


        const previous=
            seen.get(key);


        const distance=
            distanceMeters(
                previous.lat,
                previous.lon,
                place.lat,
                place.lon
            );


        /*
           Kalau nama sama dan
           lokasinya sangat dekat,
           anggap duplikat.
        */

        if(
            distance > 30
        ){

            result.push(
                place
            );

        }

    }


    return result;

}


/* =====================================================
   DISTANCE
===================================================== */

function distanceMeters(
    lat1,
    lon1,
    lat2,
    lon2
){

    const R=6371000;


    const dLat=
        (
            lat2-lat1
        )*
        Math.PI/180;


    const dLon=
        (
            lon2-lon1
        )*
        Math.PI/180;


    const a=
        Math.sin(dLat/2)**
        2 +

        Math.cos(
            lat1*
            Math.PI/
            180
        )*

        Math.cos(
            lat2*
            Math.PI/
            180
        )*

        Math.sin(dLon/2)**
        2;


    return(
        R*
        2*
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1-a)
        )
    );

}


/* =====================================================
   CLEAN
===================================================== */

function clean(
    value
){

    return String(value)
        .replace(
            /\s+/g,
            " "
        )
        .trim();

}


/* =====================================================
   JSON
===================================================== */

function json(
    data,
    statusCode=200,
    headers={}
){

    return{

        statusCode,

        headers:{
            "Content-Type":
            "application/json",

            "Access-Control-Allow-Origin":
            "*",

            ...headers

        },

        body:
        JSON.stringify(
            data
        )

    };

          }
