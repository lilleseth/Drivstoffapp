# Drivstoffapp

Oversikt over drivstoffutgifter for flere biler. Finnes i to varianter:

- **Web-app** (`docs/`) – fungerer på iPhone uten Mac. Data lagres i ditt eget GitHub-repo. Se under.
- **Native iPhone-app** (`Drivstoffapp/`, SwiftUI) – krever Mac med Xcode. Se «iPhone-app (Xcode)».

## Web-app

Åpnes i Safari og legges til på Hjem-skjermen («Del» → «Legg til på Hjem-skjerm»), så oppfører den seg som en app.

**Lagring:** Alt lagres i et GitHub-repo du velger, under en profil:

```
profiler/<profil>/data.json                       biler og fyllinger
profiler/<profil>/kvitteringer/<år>/<dato>-<id>.pdf  kvitteringer
```

Hver endring blir en commit, så hele historikken tas vare på. Endringer gjort uten dekning lagres på telefonen
og lastes opp automatisk når du er på nett igjen. Bruker du appen på flere enheter, slås endringene sammen.

**Første gang:**
1. Lag et **privat** repo til dataene, f.eks. `drivstoff-data`.
2. Lag en [fine-grained token](https://github.com/settings/personal-access-tokens/new) med tilgang kun til
   data-repoet og *Contents: Read and write*.
3. Åpne appen, skriv inn repo, profilnavn og token. Tokenet lagres bare på enheten.

**Skanning:** Ta bilde av kvitteringen (eller velg et bilde/PDF). Tekstgjenkjenning (Tesseract.js) kjører i nettleseren
og fyller ut liter, beløp, drivstoff, dato og stasjon. Første gang lastes ca. 10 MB språkdata ned. Bildet lagres som PDF.
Hold kvitteringen flatt og rett, med godt lys, for best resultat.

**Km-stand er valgfri.** Mangler den (eller er satt til 0/1), estimeres kjørelengde og km-stand ut fra forbruket:
målt forbruk fra fyllingene som har km-stand, eller *forventet forbruk* (l/mil) som du kan legge inn på bilen.
Estimerte verdier vises med «≈».

**Personvern:** Koden i dette repoet kan være offentlig – den inneholder ingen personopplysninger.
Alle dine data ligger i ditt eget *private* data-repo.
- Appen kontakter bare seg selv og `api.github.com`. Ingen analyse, sporing, annonser eller CDN-er
  (håndheves med Content-Security-Policy). Tekstgjenkjenning og språkdata ligger i `docs/vendor/` og kjører lokalt
  på telefonen – kvitteringsbilder sendes ikke til noen tjeneste.
- Bilder lagres på nytt som PDF, så EXIF-data (bl.a. GPS-posisjon) fra kamerabildet blir ikke med.
- GitHub-tokenet lagres bare i nettleseren på enheten din og sendes kun til GitHub. Bruk en fine-grained token som kun
  gjelder data-repoet, med kortest mulig utløpstid du er komfortabel med. «Logg ut» fjerner det fra enheten.
- Siden er merket `noindex` og sender ingen referrer.
- Advarsel vises hvis du prøver å koble til et offentlig data-repo.

**Publisering:** Mappen `docs/` er en statisk nettside uten byggesteg, f.eks. via GitHub Pages
(*Settings → Pages → Deploy from a branch → main / docs*).

**Utvikling:** `npm test` kjører testene for kvitteringstolking, statistikk og sammenslåing.
`npm start` starter en lokal server på http://localhost:8000.

## iPhone-app (Xcode)

iPhone-app (SwiftUI + SwiftData) for å holde oversikt over drivstoffutgifter for flere biler.

## Funksjoner

- **Biler**: legg inn biler med navn, registreringsnummer og standard drivstoff (bensin/diesel).
- **Fyllinger**: dato, antall liter, totalpris, kilometerstand, bil (nedtrekksmeny), drivstofftype, stasjon og notat.
  Literpris beregnes automatisk fra totalpris ÷ liter.
- **Skann kvittering**: Apples dokumentskanner finner kvitteringen, retter opp perspektivet og
  tekstgjenkjenning (Vision, kjører lokalt på telefonen) fyller ut liter, beløp, drivstofftype, dato og stasjon.
  Du kan også velge et bilde fra Bilder. Alle felt kan rettes før lagring.
- **Kvittering som PDF**: kvitteringen lagres som PDF på fyllingen og kan vises og deles/eksporteres (Filer, e-post, AirDrop).
- **Manuell registrering**: alt kan fylles inn for hånd uten kvittering.
- **Statistikk**: totalkostnad, liter, snitt literpris, forbruk (liter per mil), kostnad per km og månedsgraf per bil.
- Advarsel hvis kilometerstanden er lavere enn ved forrige fylling.

## Kom i gang

Krever en Mac med **Xcode 16** eller nyere. Appen krever **iOS 17**.

1. Åpne `Drivstoffapp.xcodeproj` i Xcode.
2. Velg target **Drivstoffapp → Signing & Capabilities** og velg ditt Team (en gratis Apple-ID holder for egen telefon).
   Endre ev. *Bundle Identifier* hvis `no.lilleseth.Drivstoffapp` er opptatt.
3. Koble til iPhonen og trykk ▶︎ (Run). Første gang må du godkjenne utvikleren på telefonen under
   *Innstillinger → Generelt → VPN og enhetsadministrasjon*.

Skanneren krever ekte kamera – i simulatoren kan du bruke «Velg bilde av kvittering» i stedet.

Kjør enhetstestene med ⌘U.

## Struktur

```
Drivstoffapp/
  Models/      Car, FillUp (SwiftData), FuelType, Statistics
  Receipt/     DocumentScannerView (VisionKit), TextRecognizer (Vision OCR),
               ReceiptParser (tolker norske kvitteringer), PDFBuilder
  Views/       Fyllinger, registreringsskjema, biler, statistikk, PDF-visning
  Util/        Formatering og tall-tolking (komma/punktum)
DrivstoffappTests/  Tester for kvitteringsparser, talltolking og statistikk
```

## Om kvitteringstolkingen

`ReceiptParser` ser etter typiske mønstre på norske kvitteringer (Circle K, Uno-X, Esso, Shell, YX, St1 m.fl.), f.eks.
`42,31 l x 21,49 kr/l`, `Liter: 35,50`, `Pris pr. liter`, `Total`/`Sum`/`Å betale`/`Beløp`, og datoer som
`05.10.2026 14:32` eller `2026-08-15`. Den kryssjekker liter × literpris mot totalbeløpet og regner ut
manglende verdier. Kilometerstand står ikke på kvitteringer og må alltid fylles inn manuelt.

Treffer den feil på en kvittering: åpne «Gjenkjent tekst» i skjemaet, og legg teksten til som en ny test i
`DrivstoffappTests/ReceiptParserTests.swift`.
