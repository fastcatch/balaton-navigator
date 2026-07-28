# Balaton Navigátor

Vitorlázási útvonaltervező és élő navigáció a Balatonra, iPhone-ra. Telepíthető
webalkalmazás (PWA) — nincs App Store, nincs regisztráció, nincs felhő. Minden
adat a telefonon marad.

---

## Telepítés iPhone-ra

1. Nyisd meg a linket **Safariban** (nem Chrome-ban — csak a Safari tud
   kezdőképernyőre telepíteni iOS-en).
2. Koppints a **Megosztás** gombra (□↑) a képernyő alján.
3. Válaszd a **„Hozzáadás a kezdőképernyőhöz”** parancsot.
4. Indítsd a kezdőképernyőn megjelenő ikonról. Innentől teljes képernyős appként fut.

Első indításkor engedélyezd a **helymeghatározást**. Az iránytűt külön kell
engedélyezni, egy gombnyomásra — enélkül is minden működik, csak a térképi
látóirány marad el (a kúp, a látóvonal és a mögötte lévő fokszám).

A navigációs sáv **fordulásjelzője nem az iránytűből jön**, hanem a GPS-ből
számolt haladási irányból, így iránytű nélkül is megvan — mozgás viszont kell
hozzá.

> A kezdőképernyőre telepítés nem csak kényelmi kérdés: az így telepített appok
> adatait a Safari tartósabban őrzi meg, mint egy sima böngészőfülét.

---

## Használat

| Amit szeretnél | Hogyan |
|---|---|
| Waypoint felvétele térképről | **+ Waypoint** gomb, majd koppints a térképre. A gomb bekapcsolva marad, így többet is elhelyezhetsz egymás után. |
| Waypoint felvétele koordinátával | **Útvonalak** → *Koordináta megadása kézzel*. Tizedesvessző is jó. |
| Sorrend módosítása | **Útvonalak** → ▲ / ▼ gombok. |
| Átnevezés | Koppints a waypoint nevére a listában, vagy a térképen a waypointra. |
| Cél kijelölése kézzel | Koppints a waypointra a **térképen** → *Kijelölés célnak*. |
| Vissza a saját pozícióhoz | **◎ Közép** gomb (akkor jelenik meg, ha elhúztad a térképet). |
| Track rögzítése | **● Rögzít** gomb. Újra megnyomva leáll és elmentődik. |
| Track visszanézése / exportálása | **Track-ek** → koppints rá, vagy ⤓ a GPX exporthoz. |

A **+ Waypoint** gombot szándékosan külön be kell kapcsolni: navigálás közben
egy véletlen koppintás így nem told hozzá új pontot az útvonalhoz.

Az app automatikusan a következő waypointra vált, ha a beállított sugáron
(alapból 30 m) belülre érsz — de csak akkor, ha a GPS elég pontos hozzá.
Pontatlan jelnél nem vált, mert egy ±200 m-es helymeghatározás egyszerre több
waypointon is „belül” lenne.

Nincs mentés gomb. Minden változás azonnal mentődik.

### A két képernyő

Vízszintes húzással — vagy a térkép tetején lévő két pöttyre koppintva — válthatsz
a két képernyő között. A pöttyök mindkét lapon látszanak, így mindig tudod, hol jársz.

- **Térkép** — a chart, alatta a navigációs sáv: irányszög, hátralévő táv, becsült
  idő és a fordulásjelző.
- **Adatok** — teljes képernyős műszerlap, nagy számokkal. Azokat a mutatókat hozza,
  amiket a hajó saját műszerei vagy elrejtenek, vagy GPS híján meg sem tudnak adni.

| Rövidítés | Mit jelent |
|---|---|
| **SOG** | *Speed over ground* — tényleges sebesség a föld felszínéhez képest. |
| **VMC** | *Velocity made good on course* — ebből mennyi visz ténylegesen a cél felé. Minél jobban elfordulsz a céltól, annál kisebb; ha távolodsz, negatív. |
| **COG** | *Course over ground* — amerre a hajó ténylegesen halad. |
| **XTE** | *Cross-track error* — mennyivel vagy oldalra a tervezett vonaltól. A nyíl arra mutat, **amerre vissza kell térni**, nem arra, amerre elsodródtál. |

A SOG, a VMC és a COG egymást követő GPS-pozíciókból számolódik, ezért **mozgás
kell hozzájuk**; állva vagy nagyon lassan em dash (—) áll a helyükön. Sosem nulla:
a nulla mérésnek látszana, a gondolatjel nem.

Az XTE ezen kívül **csak a második szakasztól** létezik, mert az első bója mögött
nincs olyan pont, amihez a vonalat mérni lehetne. Ilyenkor is em dash áll ott.

---

## Amit tudni érdemes

### Hosszú túra rögzítése

**Az iOS felfüggeszti a böngésző-alapú appokat, amint lezár a képernyő.**
Ilyenkor a GPS-rögzítés megáll — ez a platform korlátja, nem az appé; a
háttérben futó helymeghatározás natív appnak van fenntartva.

Amit tehetsz:

- Az app rögzítés közben **ébren tartja a képernyőt** (kikapcsolható a
  beállításokban).
- Hagyd a telefont **töltőn**, és ne nyomd meg a lezárás gombot.
- Ha mégis megszakad, az app **nem köti össze** a szakadás két végét: külön
  vonalként rajzolja ki őket, hogy ne látszódjon megtett útnak az, ami nem az.

### Internet nélkül

Ami **működik** kapcsolat nélkül: a saját pozíció, az irányszög, a távolság,
a waypoint-kezelés és a track rögzítése. Ezek mind helyben számolódnak.

Ami **nem**: új, még soha nem látott területek térképcsempéi. Ezek helyén
sraffozott szürke mező jelenik meg. Amit egyszer már megnéztél (például
induláskor a parton), az offline is megjelenik.

Ezért érdemes indulás előtt, wifin végigböngészni a tervezett útvonalat.

> Nincs és nem is lesz „töltsd le a Balatont offline-ra” gomb: az sértené az
> OpenStreetMap csempehasználati szabályzatát. Az app csak azt tárolja el,
> amit ténylegesen megjelenített.

### Fordulásjelző

A navigációs sáv alsó fele azt mutatja, **mennyit kell fordulni** ahhoz, hogy a
következő bója felé haladj:

- **Chevronok** — merre. Egy, kettő vagy három, aszerint, hogy mekkora az eltérés.
  Felfelé mutató nyíl (⬆) azt jelenti, hogy jó irányban vagy.
- **Előjeles fokszám** — mennyit. A `+` jobbra, a `−` balra fordulást jelent.
  Az előjel nem díszítés: `+12°` egy *korrekció*, a fölötte lévő `012°` viszont
  egy *irány*, és előjel nélkül a kettő egyformán néz ki.
- **Szalag** — ugyanez folytonosan, ±45°-ig; azon túl kiüt a szélére.

Ez **nem az iránytűből** jön, hanem a GPS-ből számolt haladási irányból: abból,
amerre a hajó *ténylegesen megy*, nem abból, amerre a telefon néz. Ezért mindegy,
hogyan tartod a telefont — és ezért kell hozzá mozgás. Álló helyzetben vagy túl
lassan a helyén rövid szöveg mondja meg, miért nincs.

A **Haladási irány simítása** beállítás (alapból 5 mp) azt szabja meg, mennyi
GPS-előzményből átlagolódik az irány. Kisebb érték élénkebb, de nyugtalanabb;
fordulás közben a kijelzés elhalványul, amíg az új irány be nem áll.

### Iránytű és nézőirány

Az irányszám (pl. `171°`) mindig **valós északhoz** viszonyított, és GPS-ből
számolódik. Iránytű nélkül a számok ugyanolyan pontosak.

Ha az iránytű engedélyezve van, három dolgot kapsz még — mindhárom a
**térképen**, és mindhárom arról szól, merre *nézel*, nem arról, merre *mész*:

- **Látómező-kúp a saját pozíción** — merre nézel éppen.
- **Szaggatott vonal a képernyő széléig** — mi van előtted a távolban.
  A vonal mindig kifut a látható térkép szélén túlra, így nagyításnál is
  megmutatja, mire nézel.
- **Fokszám a pozíciójel mögött** — maga a látóirány, fokban.

A fokszám azért kerül *mögé*, mert előre a látóvonalat nézed: bármi, ami a
vonalon ül, épp azt takarja, amire nézel. A hajó mögé egy halványabb
vonaldarab fut ki, és a szám annak a végén lóg — vagyis ugyanannak a
tengelynek a felirata, nem külön irány. Hogy merre van előre, azt továbbra is
egyedül a kúp mondja meg.

A szám **valós északhoz** viszonyít, ahogy a sáv **Irányszög** értéke is, így a
kettő közvetlenül összevethető: a látóirány azt mondja, merre nézel, az
irányszög azt, merre van a következő bója.

A kúp, a vonal és a fokszám **csak akkor jelenik meg, ha van valódi
iránymérés**. Ha az iránytű nem elérhető, a saját pozíció sima pont marad — az
app nem mutat olyan irányt, amit nem mért meg.

Álló helyzetben az iránytű az irányadó. Ha nincs iránytű, az app a GPS-ből
számolt haladási irányt használja, ami viszont csak mozgás közben létezik.

**Mágneses elhajlás:** a telefon iránytűje a *mágneses* északhoz viszonyít, a
koordinátákból számolt irányszög viszont a *valós* északhoz. A Balatonnál ez
kb. 5° eltérés, amit az app automatikusan korrigál — így az iránytű, a kúp és
a látóvonal ugyanabban a rendszerben van, mint a kijelzett fokszám. Az érték
évente kb. 0,1°-ot vándorol; néhány évente érdemes frissíteni
(`BALATON_DECLINATION_DEG` a `js/compass.js` fájlban).

---

## Fejlesztés

Nincs build lépés és nincs egyetlen npm függőség sem. A `js/core/` modulok
semmit nem importálnak a böngészőből, ezért közvetlenül futnak Node alatt —
emiatt tesztelhető a navigációs logika böngésző nélkül.

```bash
npm test      # unit tesztek (node --test), ~215 teszt
npm run serve # http://localhost:8000
npm run icons # ikonok újragenerálása
```

A `localhost` és a HTTPS az egyetlen két origin, ahol a helymeghatározás és a
service worker működik — fájlból megnyitva (`file://`) az app nem fut.

### Beépített útvonalak

A `data/seed-routes.json` fájlban lévő útvonalak minden eszközre automatikusan
felkerülnek — nem kell kézzel bevinni őket. Új verseny hozzáadása: vedd fel egy
új elemként, commitold, és a következő megnyitáskor mindenkinél megjelenik.

```json
{
  "seedId": "feherszalag-2026",
  "version": 1,
  "name": "Fehérszalag 2026",
  "waypoints": [
    { "name": "Rajt", "lat": 46.9483, "lon": 17.8948 }
  ]
}
```

Szabályok:

- **`seedId` állandó.** Ez köti össze a fájlt a telefonon már meglévő
  útvonallal. Soha ne írd át és ne használd újra.
- **`version` emelése** frissíti az útvonalat a telefonokon — ha a pálya
  változik a verseny előtt, így jut el mindenkihez.
- **A felhasználó módosításai erősebbek.** Ha valaki hozzányúlt a saját
  példányához, azt a verziófrissítés nem írja felül.
- **A törlés végleges.** Ha valaki törli a beépített útvonalat, nem kapja
  vissza a következő indításkor.
- Ha nincs más kiválasztott útvonal, az app az elsőként érkező beépítettet
  teszi aktívvá — így verseny reggelén azonnal használható.

A fájl tartalmát a `npm test` ellenőrzi: koordináták a Balaton befoglaló
dobozán belül, egyedi `seedId`-k, nincs nulla hosszú szakasz.

### Felépítés

```
js/core/     Tiszta logika: geometria, navigáció, track, GPX, modell, seed.
             Nincs benne DOM, böngésző API vagy I/O. Ez van tesztelve.
data/        Beépített útvonalak (seed-routes.json).
js/          Adapterek: IndexedDB, geolocation, iránytű, Leaflet, rögzítés.
js/ui/       Megjelenítés.
js/main.js   Összekötés — az állapot itt él, egy irányba folyik az adat.
sw.js        Offline app shell + csempe-cache (olvasd el a fejlécét,
             mielőtt hozzányúlnál a csempekezeléshez).
```

### Telepítés webre

Statikus fájlok, bármilyen HTTPS-t adó tárhelyre kirakhatók. GitHub Pages-re:
`Settings → Pages → Deploy from a branch → main / (root)`. Minden útvonal
relatív, így az alkönyvtáras URL (`felhasznalo.github.io/repo/`) is működik.

Új verzió kiadásakor **emeld meg a `SHELL_VERSION` konstanst a `sw.js`
elején**, különben a régi, gyorsítótárazott változat marad a telefonokon — és
a fejlesztői gépen is, ahol ez úgy jelentkezik, hogy a frissítés egyszerűen
nincs ott. A `TILE_VERSION`-höz ne nyúlj: az a csempe-cache-t dobja el, amit
csak a tó újraböngészésével lehet visszatölteni.

---

## Térképadatok

Alaptérkép © [OpenStreetMap](https://www.openstreetmap.org/copyright)
közreműködők · Hajózási jelzések © [OpenSeaMap](https://www.openseamap.org/)

---

## Ez nem navigációs eszköz

Kedvtelési célú alkalmazás. Nem helyettesíti a hivatalos térképet, a
tájékozódást és a józan ítélőképességet. A GPS pontatlan lehet, a telefon
lemerülhet, és a Balaton sekély vizei és zátonyai nem szerepelnek benne.
Használd felelősséggel.
