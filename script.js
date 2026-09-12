/* =====================================================
   NANGKRINGACEH
   FRONTEND
   DATA: Netlify Function -> OpenStreetMap / Overpass
===================================================== */

const map = L.map("map").setView([4.6951,96.7494],8);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
  maxZoom:19,
  attribution:"© OpenStreetMap"
}).addTo(map);

let allPlaces=[];
let markers=[];
let userMarker=null;
let userLocation=null;
let activeFilter="all";
let loading=false;

const searchEl=document.getElementById("search");
const placesEl=document.getElementById("places");
const statusEl=document.getElementById("status");
const countEl=document.getElementById("count");

function setStatus(text,type=""){
  statusEl.className="status "+type;
  statusEl.innerHTML=text;
}

function escapeHtml(text){
  return String(text||"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}

function getIcon(type){
  if(type==="coffee") return "☕";
  if(type==="cafe") return "☕";
  if(type==="restaurant") return "🍜";
  if(type==="fast_food") return "🍔";
  if(type==="bar") return "🍹";
  if(type==="tourism") return "🌴";
  return "📍";
}

function getTypeLabel(type){
  if(type==="coffee") return "Coffee";
  if(type==="cafe") return "Cafe";
  if(type==="restaurant") return "Restoran";
  if(type==="fast_food") return "Fast Food";
  if(type==="bar") return "Bar";
  if(type==="tourism") return "Wisata";
  return "Tempat";
}

function distanceKm(lat1,lon1,lat2,lon2){
  const R=6371;
  const dLat=(lat2-lat1)*Math.PI/180;
  const dLon=(lon2-lon1)*Math.PI/180;
  const a=
    Math.sin(dLat/2)**2+
    Math.cos(lat1*Math.PI/180)*
    Math.cos(lat2*Math.PI/180)*
    Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function formatDistance(km){
  if(km<1) return Math.round(km*1000)+" m";
  return km.toFixed(1)+" km";
}

async function loadAcehPlaces(){
  if(loading) return;

  loading=true;
  setStatus("🔄 Mengambil data tempat di Aceh...");

  try{
    const response=await fetch("/.netlify/functions/places",{
      method:"GET",
      cache:"no-store"
    });

    if(!response.ok){
      throw new Error("HTTP "+response.status);
    }

    const data=await response.json();

    if(!data || !Array.isArray(data.places)){
      throw new Error("Format data server tidak valid");
    }

    allPlaces=data.places;

    countEl.textContent=allPlaces.length.toLocaleString("id-ID")+" tempat";

    setStatus(
      "✅ "+allPlaces.length.toLocaleString("id-ID")+
      " tempat ditemukan dari OpenStreetMap",
      "success"
    );

    renderPlaces();
    updateMarkers();

  }catch(error){
    console.error(error);

    setStatus(`
      ❌ <b>Data tempat gagal dimuat.</b><br>
      Server data belum bisa dihubungi.<br>
      <small>Detail: ${escapeHtml(error.message)}</small><br>
      <button class="retry-btn" onclick="loadAcehPlaces()">🔄 Coba Lagi</button>
    `,"error");

    placesEl.innerHTML=`
      <div class="empty">
        ⚠️ Data tempat belum berhasil dimuat.<br><br>
        Tekan "Coba Lagi".
      </div>
    `;
  }finally{
    loading=false;
  }
}

function getFilteredPlaces(){
  const keyword=searchEl.value.toLowerCase().trim();

  return allPlaces.filter(place=>{
    const filterOk=
      activeFilter==="all" ||
      place.category===activeFilter;

    const searchable=(
      place.name+" "+
      (place.address||"")+" "+
      (place.city||"")+" "+
      place.category
    ).toLowerCase();

    const searchOk=
      !keyword || searchable.includes(keyword);

    return filterOk && searchOk;
  });
}

function renderPlaces(){
  const list=getFilteredPlaces();

  if(userLocation){
    list.forEach(place=>{
      place.distance=distanceKm(
        userLocation.lat,
        userLocation.lon,
        place.lat,
        place.lon
      );
    });

    list.sort((a,b)=>
      (a.distance??999999)-
      (b.distance??999999)
    );
  }

  countEl.textContent=
    list.length.toLocaleString("id-ID")+" tempat";

  if(!list.length){
    placesEl.innerHTML=`
      <div class="empty">
        😕 Tempat tidak ditemukan.
      </div>
    `;
    updateMarkers();
    return;
  }

  placesEl.innerHTML="";

  list.forEach(place=>{
    const address=
      place.address ||
      place.city ||
      "Aceh";

    const card=document.createElement("div");
    card.className="card";

    card.innerHTML=`
      <div class="card-image">
        ${getIcon(place.category)}
        <div class="category-badge">
          ${escapeHtml(getTypeLabel(place.category))}
        </div>
      </div>

      <div class="card-body">
        <div class="card-title">
          ${escapeHtml(place.name)}
        </div>

        <div class="card-location">
          📍 ${escapeHtml(address)}
        </div>

        <div class="card-bottom">
          <span class="distance">
            ${
              place.distance!==undefined
              ? formatDistance(place.distance)
              : getTypeLabel(place.category)
            }
          </span>

          <button class="open-btn">
            Lihat →
          </button>
        </div>
      </div>
    `;

    card.addEventListener("click",()=>{
      map.setView([place.lat,place.lon],17,{animate:true});

      const marker=markers.find(m=>{
        const p=m.getLatLng();
        return Math.abs(p.lat-place.lat)<0.00001 &&
               Math.abs(p.lng-place.lon)<0.00001;
      });

      if(marker) marker.openPopup();
    });

    placesEl.appendChild(card);
  });

  updateMarkers();
}

function updateMarkers(){
  clearMarkers();

  const list=getFilteredPlaces();

  list.forEach(place=>{
    const icon=L.divIcon({
      className:"",
      html:`<div class="place-marker">${getIcon(place.category)}</div>`,
      iconSize:[34,34],
      iconAnchor:[17,17],
      popupAnchor:[0,-17]
    });

    const marker=L.marker([place.lat,place.lon],{icon});

    const mapsUrl=
      "https://www.google.com/maps/search/?api=1&query="+
      encodeURIComponent(place.lat+","+place.lon);

    marker.bindPopup(`
      <div>
        <div class="popup-title">
          ${escapeHtml(place.name)}
        </div>

        <div class="popup-info">
          ${getIcon(place.category)}
          ${escapeHtml(getTypeLabel(place.category))}
          <br>
          📍 ${escapeHtml(place.address||"Aceh")}
        </div>

        <a class="popup-link"
           href="${mapsUrl}"
           target="_blank"
           rel="noopener">
          Buka Google Maps →
        </a>
      </div>
    `);

    marker.addTo(map);
    markers.push(marker);
  });
}

function clearMarkers(){
  markers.forEach(marker=>map.removeLayer(marker));
  markers=[];
}

document.querySelectorAll(".filter").forEach(button=>{
  button.addEventListener("click",()=>{
    document.querySelectorAll(".filter")
      .forEach(b=>b.classList.remove("active"));

    button.classList.add("active");
    activeFilter=button.dataset.type;

    renderPlaces();
  });
});

searchEl.addEventListener("input",renderPlaces);

function findUser(){
  if(!navigator.geolocation){
    alert("Browser tidak mendukung lokasi.");
    return;
  }

  setStatus("📍 Mencari lokasi kamu...");

  navigator.geolocation.getCurrentPosition(
    position=>{
      userLocation={
        lat:position.coords.latitude,
        lon:position.coords.longitude
      };

      if(userMarker) map.removeLayer(userMarker);

      const icon=L.divIcon({
        className:"",
        html:'<div class="user-marker"></div>',
        iconSize:[18,18],
        iconAnchor:[9,9]
      });

      userMarker=L.marker(
        [userLocation.lat,userLocation.lon],
        {icon}
      ).addTo(map);

      userMarker.bindPopup("📍 Lokasi kamu");

      map.setView(
        [userLocation.lat,userLocation.lon],
        14
      );

      renderPlaces();

      setStatus(
        "📍 Tempat diurutkan berdasarkan jarak dari kamu",
        "success"
      );
    },
    error=>{
      console.error(error);
      alert(
        "Lokasi tidak dapat diakses. Pastikan izin lokasi browser aktif."
      );
      setStatus("⚠️ Lokasi tidak dapat diakses.");
    },
    {
      enableHighAccuracy:true,
      timeout:10000,
      maximumAge:30000
    }
  );
}

document
  .getElementById("locationBtn")
  .addEventListener("click",findUser);

loadAcehPlaces();

setInterval(()=>{
  loadAcehPlaces();
},15*60*1000);
